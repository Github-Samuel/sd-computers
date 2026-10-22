import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Send, Trash2 } from 'lucide-react';
import { rpc } from '@/nui/rpc';
import { useOS } from '@/store/os';
import { t } from '@/i18n';
import { fmtTime } from '@/lib/format';
import { Button, IconButton, InfoBar, Select, Spinner, TextArea, TextInput } from '@/ui/controls';
import RecipientField from './RecipientField';
import { ToolButton, ToolSeparator } from './parts';
import { afterSend, askConfirm, closeCompose, loadList, sync, useMail } from './store';
import type { ComposeInit, MailId, SendData } from './types';
import { isValidAddress, normalizeAddress, splitAddresses, uniq } from './util';

const AUTOSAVE_MS = 1500;

type SaveState = { state: 'idle' | 'saving' | 'saved' | 'error'; at?: number };

/**
 * The new-Outlook inline composer (replaces the reading pane). Drafts autosave ~1.5s after the last
 * edit via mail:draft; the returned id is reused for every later save and handed to mail:send, which
 * removes the draft. Every server call goes through one queue so a save can never race a send.
 * Closing it any other way than Send/Discard (opening another message, switching to a draft, closing
 * the window) flushes unsaved edits to Drafts.
 */
export default function Composer({ init, width, onBack }: { init: ComposeInit; width: number; onBack?: () => void }) {
  const accounts = useMail(s => s.accounts);
  const domain = useMail(s => s.domain);
  const limits = useOS(s => s.payload?.mail);
  const clock24 = useOS(s => !!s.payload?.desktop.clock24);
  const maxRecipients = limits?.maxRecipients ?? 20;
  const maxSubject = limits?.maxSubject ?? 200;
  const maxBody = limits?.maxBody ?? 10000;

  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState<string[]>(init.to);
  const [pending, setPending] = useState('');
  const [subject, setSubject] = useState(init.subject);
  const [body, setBody] = useState(init.body);
  const [version, setVersion] = useState(0);
  const [save, setSave] = useState<SaveState>({ state: 'idle' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitHit, setLimitHit] = useState(false);

  const toRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const live = useRef({ from, to, pending, subject, body });
  live.current = { from, to, pending, subject, body };
  const versionRef = useRef(version);
  versionRef.current = version;
  const savedVersion = useRef(0);
  const draftId = useRef<MailId | undefined>(init.draftId);
  /** Sent or discarded: nothing may be saved any more. */
  const done = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const enqueue = <T,>(fn: () => Promise<T>): Promise<T> => {
    const p = queue.current.then(fn, fn);
    queue.current = p.catch(() => undefined);
    return p;
  };

  const touch = () => setVersion(v => v + 1);

  /**
   * Recipients worth saving in a draft: committed chips only (a half-typed address isn't one yet),
   * and only valid ones - the server drops the whole list if any entry is malformed.
   */
  const draftRecipients = (s: typeof live.current): string[] => s.to.filter(isValidAddress).slice(0, maxRecipients);

  const saveNow = (): Promise<void> =>
    enqueue(async () => {
      if (done.current) return;
      const v = versionRef.current;
      const s = live.current;
      const recipients = draftRecipients(s);
      const empty = recipients.length === 0 && !s.subject.trim() && !s.body.trim();
      if (empty && draftId.current === undefined) {
        savedVersion.current = v;
        return;
      }
      setSave({ state: 'saving' });
      const payload: Record<string, unknown> = { from: s.from, to: recipients, subject: s.subject, body: s.body };
      if (draftId.current !== undefined) payload.draftId = draftId.current;
      const r = await rpc<{ id: MailId }>('mail:draft', payload);
      if (!r.ok || !r.data) {
        setSave({ state: 'error' });
        return;
      }
      // Built-in Mail ids are numbers, the phone's are strings - keep it as given.
      const id = r.data.id;
      const created = id !== draftId.current;
      draftId.current = id;
      savedVersion.current = v;
      setSave({ state: 'saved', at: Date.now() });
      // A new draft changes the Drafts count; an update only matters if Drafts is on screen.
      if (created) sync();
      else if (useMail.getState().folder === 'drafts') void loadList({ silent: true });
    });

  // Autosave after a pause in editing.
  useEffect(() => {
    if (version === savedVersion.current) return;
    const h = window.setTimeout(() => void saveNow(), AUTOSAVE_MS);
    return () => window.clearTimeout(h);
  }, [version]);

  // Unmounted without Send/Discard: keep the work as a draft.
  useEffect(
    () => () => {
      if (!done.current && versionRef.current !== savedVersion.current) void saveNow();
    },
    [],
  );

  // Initial focus: To for new/forward, the top of the body for replies and drafts.
  useEffect(() => {
    const h = window.setTimeout(() => {
      if (init.focus === 'to') {
        toRef.current?.focus();
        return;
      }
      const b = bodyRef.current;
      if (!b) return;
      b.focus();
      b.setSelectionRange(0, 0);
      b.scrollTop = 0;
    }, 40);
    return () => window.clearTimeout(h);
  }, [init.focus]);

  const changeFrom = (next: string) => {
    if (next === from) return;
    // A draft lives in its sender's mailbox: move it by deleting the old copy; the next save
    // creates it under the new address.
    const old = from;
    const id = draftId.current;
    if (id !== undefined) {
      draftId.current = undefined;
      void enqueue(() => rpc('mail:delete', { email: old, id }));
    }
    setFrom(next);
    touch();
  };

  /** Fold the half-typed address into the chips; returns the final recipient list. */
  const commitPending = (): string[] => {
    const extra = splitAddresses(pending).map(a => normalizeAddress(a, domain)).filter(Boolean);
    if (extra.length === 0) return to;
    const list = uniq([...to, ...extra]);
    setTo(list);
    setPending('');
    touch();
    return list;
  };

  const send = async () => {
    if (sending || done.current) return;
    const list = commitPending();
    if (list.length === 0) return setError(t('ui.mail.err_no_recipients'));
    const bad = list.filter(a => !isValidAddress(a));
    if (bad.length) return setError(t('ui.mail.err_invalid', bad.join(', ')));
    if (list.length > maxRecipients) return setError(t('ui.mail.err_too_many', maxRecipients));
    if (!subject.trim() && !body.trim()) return setError(t('ui.mail.err_empty'));
    setSending(true);
    setError(null);
    const r = await enqueue(() => {
      const payload: Record<string, unknown> = { from, to: list, subject, body };
      if (draftId.current !== undefined) payload.draftId = draftId.current;
      return rpc<SendData>('mail:send', payload);
    });
    if (!r.ok || !r.data) {
      setSending(false);
      setError(r.error ?? t('ui.common.error'));
      return;
    }
    done.current = true;
    afterSend(r.data);
  };

  const discard = () => {
    const s = live.current;
    const run = async () => {
      done.current = true;
      closeCompose();
      await queue.current;
      if (draftId.current !== undefined) {
        await rpc('mail:delete', { email: s.from, id: draftId.current });
        sync();
      }
    };
    if (versionRef.current !== 0 || draftId.current !== undefined) {
      askConfirm({ title: t('ui.mail.discard_title'), body: t('ui.mail.discard_body'), confirm: t('ui.mail.discard'), run });
    } else {
      void run();
    }
  };

  const status =
    save.state === 'saving'
      ? t('ui.mail.saving')
      : save.state === 'saved' && save.at
        ? t('ui.mail.draft_saved', fmtTime(new Date(save.at), clock24))
        : save.state === 'error'
          ? t('ui.mail.draft_error')
          : '';

  const fromAccount = accounts.find(a => a.email === from);

  return (
    <div
      className="h-full flex flex-col min-h-0 page-in"
      onKeyDown={e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          void send();
        }
      }}
    >
      <div className="h-12 shrink-0 flex items-center gap-1 px-2 border-b border-stroke">
        {onBack && (
          <>
            <IconButton title={t('ui.mail.back')} onClick={onBack} className="shrink-0">
              <ArrowLeft size={16} />
            </IconButton>
            <ToolSeparator />
          </>
        )}
        <Button
          variant="accent"
          icon={sending ? <Spinner size={14} className="!text-accent-on" /> : <Send size={16} />}
          onClick={() => void send()}
          disabled={sending}
          title={t('ui.mail.send_hint')}
          className="shrink-0 min-w-[88px]"
        >
          {t('ui.mail.send')}
        </Button>
        <ToolButton icon={<Trash2 size={16} />} label={t('ui.mail.discard')} onClick={discard} showLabel={width >= 420} disabled={sending} />
        <div className="flex-1" />
        <span className={`text-caption truncate pr-2 ${save.state === 'error' ? 'text-critical' : 'text-t2'}`}>{status}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto os-scroll p-3 flex flex-col gap-3">
        {error && (
          <InfoBar severity="error" onClose={() => setError(null)}>
            {error}
          </InfoBar>
        )}
        <div className="flex-1 flex flex-col min-h-[340px] rounded-win bg-card border border-stroke shadow-card">
          <FieldRow label={t('ui.mail.from_label')}>
            <Select value={from} onChange={e => changeFrom(e.target.value)} disabled={sending || accounts.length < 2} title={fromAccount?.email}>
              {accounts.map(a => (
                <option key={a.email} value={a.email}>
                  {a.name} &lt;{a.email}&gt;
                </option>
              ))}
              {!fromAccount && <option value={from}>{from}</option>}
            </Select>
          </FieldRow>
          <FieldRow label={t('ui.mail.to_label_field')}>
            <RecipientField
              value={to}
              onChange={v => {
                setTo(v);
                setLimitHit(false);
                touch();
              }}
              pending={pending}
              onPending={v => {
                setPending(v);
                touch();
              }}
              max={maxRecipients}
              domain={domain}
              inputRef={toRef}
              onLimit={() => setLimitHit(true)}
              disabled={sending}
            />
            {limitHit && <div className="mt-1 text-caption text-critical">{t('ui.mail.err_too_many', maxRecipients)}</div>}
          </FieldRow>
          <FieldRow label={t('ui.mail.subject_label')}>
            <TextInput
              value={subject}
              maxLength={maxSubject}
              disabled={sending}
              onChange={e => {
                setSubject(e.target.value);
                touch();
              }}
              placeholder={t('ui.mail.subject_placeholder')}
            />
          </FieldRow>
          <div className="flex-1 flex flex-col px-4 pt-3 pb-4">
            <TextArea
              ref={bodyRef}
              value={body}
              maxLength={maxBody}
              disabled={sending}
              spellCheck
              onChange={e => {
                setBody(e.target.value);
                touch();
              }}
              placeholder={t('ui.mail.body_placeholder')}
              className="flex-1 min-h-[180px] leading-[22px]"
            />
            {body.length > maxBody * 0.9 && <div className="mt-1 text-caption text-t2 text-right tabular-nums">{t('ui.mail.chars_left', Math.max(0, maxBody - body.length))}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 pt-3">
      <span className="w-[60px] shrink-0 h-8 flex items-center text-body text-t2">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
