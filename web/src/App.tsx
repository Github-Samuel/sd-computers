import { useCallback, useEffect, useState } from 'react';
import type { HackRun, OpenPayload } from './types';
import { useNuiEvent } from './hooks/useNuiEvent';
import { fetchNui, isEnvBrowser } from './nui/bridge';
import { mockPayloadFor } from './nui/mock/payload';
import type { OsStyle } from './types';
import { mockRpc } from './nui/mock';
import { setLocale, useI18n } from './i18n';
import { useOS } from './store/os';
import { emit } from './lib/bus';
import { t } from './i18n';
import { messagePreview } from './apps/messages/format';
import type { IncomingPush } from './apps/messages/types';
import { devMirror, mirrorControl, mirrorStop, type MirrorControl } from './mirror';
import Computer from './os/Computer';
import LibHack from './os/LibHack';
import Paper, { type PaperPage } from './os/Paper';
import { mockPage } from './nui/mock/print';
import { useExtEvents } from './apps/ext/events';

/** computers:mail:received (built-in Mail) - also what a phone mail push is reshaped into. */
interface MailPush {
  mailbox: string;
  message: { id: number | string; senderName: string; senderEmail: string; subject: string; preview: string };
}

/** sd-phone's MailMessage, as its client event carries it (only the fields used here). */
interface PhoneMail {
  id: string;
  accountId?: string;
  from?: { name?: string; email?: string };
  subject?: string;
  body?: string;
}

/** Tell the Mail app, and toast on the desktop (clicking opens that message). */
function notifyMail(d: MailPush): void {
  emit('mail:received', d);
  const os = useOS.getState();
  if (os.phase !== 'desktop') return;
  os.toast({
    app: 'mail',
    title: d.message.senderName,
    body: d.message.subject || d.message.preview,
    onClick: () => useOS.getState().openApp('mail', { mailbox: d.mailbox, messageId: d.message.id }),
  });
}

/**
 * The OS page (os.html), a frame of the resource's NUI page (src/host), which passes these on.
 * Messages from client Lua:
 *   computers:open           boot the OS with session.open's payload
 *   computers:close          fade out and tear down
 *   computers:mail:received  toast + tell the Mail app (lib/bus 'mail:received')
 *   computers:phone:mail     sd-phone pushed a phone mail (only used while Mail runs on the phone)
 *   computers:phone:message  sd-phone pushed a text (only used when the Messages app is installed)
 *   computers:phone:seen     sd-phone: a 1:1 peer read my texts (lib/bus 'messages:seen')
 *   computers:mirror         somebody nearby is looking at this computer's screen: record for them (src/mirror)
 *   computers:lib:open       StartHack export: a standalone hack.exe window, no desktop needed
 *   computers:paper:open     a printout was used: the page, held up over the game (src/os/Paper.tsx)
 *   computers:app:*          custom apps: the desktop's lists, badges, open/close, notifications (src/apps/ext/events.ts);
 *                            computers:app:message goes to the app's own window (src/apps/ext/index.tsx)
 * Browser dev (`npm run dev`): opens itself with the mock payload. URL hashes: #desktop skips
 * boot+lock, #lib opens a standalone hack, #paper a printed page (?kind=text|document|contract|long|mail|statement|logs|faded),
 * #<app> (e.g. #mail) also opens that app.
 * ?style=retro / ?style=mac picks the computer's look. ?frame=x,y,w,h (fractions of the window)
 * lays it out as it sits on a prop's screen. /screen.html?mode=live in a second tab shows what this
 * one's prop would.
 */
export default function App() {
  useI18n();
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [lib, setLib] = useState<HackRun | null>(null);
  const [paper, setPaper] = useState<PaperPage | null>(null);

  const open = useCallback((p: OpenPayload) => {
    useOS.getState().bootWith(p);
    setClosing(false);
    setVisible(true);
  }, []);

  const close = useCallback(() => {
    mirrorStop();
    setClosing(true);
    window.setTimeout(() => {
      setVisible(false);
      setClosing(false);
      useOS.getState().reset();
    }, 250);
  }, []);

  useNuiEvent<OpenPayload>('computers:open', open);
  useNuiEvent('computers:close', close);

  useNuiEvent<MailPush>('computers:mail:received', d => {
    if (d) notifyMail(d);
  });

  // Optional sd-phone link: sd-phone's own pushes, forwarded by client/computers/nui.lua.
  useNuiEvent<PhoneMail>('computers:phone:mail', m => {
    if (!m || !useOS.getState().payload?.mail.phone) return;
    const from = m.from ?? {};
    notifyMail({
      mailbox: String(m.accountId ?? '').toLowerCase(),
      message: {
        id: m.id,
        senderName: from.name || from.email || '',
        senderEmail: from.email ?? '',
        subject: m.subject ?? '',
        preview: String(m.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
      },
    });
  });

  useNuiEvent<IncomingPush>('computers:phone:message', c => {
    const os = useOS.getState();
    if (!c || !os.payload?.computer.apps.some(a => a.id === 'messages')) return;
    emit('messages:incoming', c);
    if (os.phase !== 'desktop') return;
    const msg = Array.isArray(c.messages) ? c.messages[0] : undefined;
    const sender = Array.isArray(c.participants) ? c.participants.find(p => p.phone === msg?.from) ?? c.participants[0] : undefined;
    const name = sender?.name || msg?.from || '';
    os.toast({
      app: 'messages',
      title: c.groupName || name || t('ui.messages.new_message'),
      body: msg ? (c.groupName && name ? `${name}: ${messagePreview(msg)}` : messagePreview(msg)) : '',
      onClick: () => useOS.getState().openApp('messages', { conversation: c.id }),
    });
  });

  useNuiEvent<{ conversation: string; seenAt: number }>('computers:phone:seen', d => {
    if (d && useOS.getState().payload?.computer.apps.some(a => a.id === 'messages')) emit('messages:seen', d);
  });

  useExtEvents();

  useNuiEvent<HackRun>('computers:lib:open', run => setLib(run));
  useNuiEvent<PaperPage>('computers:paper:open', page => page && setPaper(page));
  useNuiEvent('computers:paper:close', () => setPaper(null));

  useNuiEvent<MirrorControl>('computers:mirror', d => {
    if (d) mirrorControl(d);
  });

  useEffect(() => {
    void fetchNui<{ strings: Record<string, unknown> }>('computers:ui:locale').then(r => {
      if (r?.strings) setLocale(r.strings);
    });
  }, []);

  // Browser dev entry points.
  useEffect(() => {
    if (!isEnvBrowser()) return;
    devMirror();
    const hash = window.location.hash.replace('#', '');
    const query = new URLSearchParams(window.location.search);
    const wanted = query.get('style');
    const style: OsStyle = wanted === 'retro' || wanted === 'mac' ? wanted : 'modern';
    const mockPayload = mockPayloadFor(style);
    // (on a prop's screen the prop is the monitor: retro leaves its own chassis off, as Lua asks it to)
    if (query.has('frame')) mockPayload.desktop.monitor = false;
    if (hash === 'paper') {
      setPaper(mockPage(query.get('kind'), query.get('font') as never));
      return;
    }
    if (hash === 'lib') {
      void mockRpc<HackRun>('hack:start', { game: 'pipe', difficulty: 'easy' }).then(r => r.data && setLib({ ...r.data, title: 'Vault Door Panel' }));
      return;
    }
    open(mockPayload);
    if (hash) {
      const os = useOS.getState();
      os.setPhase('desktop');
      if (hash !== 'desktop') window.setTimeout(() => os.openApp(hash as never), 50);
    }
    // Reopen after "shutting down" so the browser session never ends up on a blank page.
    const reopen = () => window.setTimeout(() => open(mockPayload), 1200);
    window.addEventListener('message', e => {
      if ((e.data as { action?: string })?.action === 'computers:close') reopen();
    });
  }, [open]);

  // Tell the page holding this one (src/host) whether anything is up: it gives the frame the mouse
  // and the keyboard only then.
  const active = visible || lib !== null || paper !== null;
  useEffect(() => {
    if (window.parent !== window) window.parent.postMessage({ source: 'sd-computers-os', active }, '*');
  }, [active]);

  return (
    <>
      {visible && (
        <div className={`absolute inset-0 ${closing ? 'fade-out' : 'fade-in'}`}>
          <Computer />
        </div>
      )}
      {lib && <LibHack run={lib} onClose={() => setLib(null)} />}
      {paper && <Paper page={paper} onClose={() => setPaper(null)} onPage={setPaper} />}
    </>
  );
}
