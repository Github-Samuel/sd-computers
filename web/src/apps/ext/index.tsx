import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS, selectActiveId, setCloseGuard, type Win } from '@/store/os';
import { isExt, type ExtAppId, type AppId } from '@/types';
import { rpc } from '@/nui/rpc';
import { fetchNui } from '@/nui/bridge';
import { t } from '@/i18n';
import { useNuiEvent } from '@/hooks/useNuiEvent';
import { useBus } from '@/lib/bus';
import { askPrint, PrintSlot } from '@/os/print/PrintDialog';
import { sfx } from '@/os/sfx';
import { retroSfx } from '@/os/retro/sounds';
import { PhotoPicker } from '../photos/Picker';
import type { AppProps } from '../registry';
import ExtIcon from './ExtIcon';
import { AlertBox, ColorBox, ConfirmBox, MenuBox, PromptBox, type AlertOpts, type ConfirmOpts, type MenuItemOpts, type PromptOpts } from './Dialogs';
import { notifyFrom, takeClicks } from './events';
import { METHODS, SDK_VERSION, isFromPage, type InitData, type PageEvent, type PageSettings, type ToPage, type WindowState } from './protocol';

// A custom app's window: the page its resource registered, in a frame, with the SDK put into it
// (public/sdk/sdcomputers.js). Everything the page asks of the OS arrives here as a message and is
// answered here: a call to its server goes through the same rpc as every app's, behind the same
// session gate; a dialog is the OS's own, drawn over the page; a print goes through the OS's print
// dialog to a printer in the room. The page's own buttons and data are its own business - the OS
// only ever frames it.
//
// Three things the frame changes for the shell:
//  - A frame swallows clicks, so the shell would never hear the one that should bring this window
//    forward: while it is behind another, a clear sheet over the page takes that first click.
//  - Keys pressed in the page stay in the page. The SDK passes on an Escape the page did not use
//    (so it still stands the player up), and says when a field in the page is being typed in (so
//    Escape asks twice, as it does over the OS's own fields - src/os/Computer.tsx).
//  - The copy of the screen other players see (src/mirror) takes the page in when the frame is
//    marked data-mirror-frame: the app did not ask to be left out (`mirror = false`), and the page
//    can be read from here (one from another origin - a site, a dev server - cannot). Otherwise
//    they see the app's icon and name where its page is, marked data-mirror-placeholder (hidden
//    here, shown by the replay - src/screen/live.ts).

/** Where the SDK is served from: beside os.html (web/build/sdk in the game, public/sdk in a browser). */
const SDK_URL = new URL('sdk/sdcomputers.js', document.baseURI).href;

/** Messages kept for the page while its SDK has not started yet. */
const OUTBOX_MAX = 64;

/**
 * The origin of an app's page, which what is posted to it and what is heard from it are pinned to:
 * a page that navigates somewhere else in its frame (a link, a redirect) is told nothing more, and
 * cannot speak for the app.
 */
const originOf = (ui: string | null | undefined): string | null => {
  if (!ui) return null;
  try {
    return new URL(ui, document.baseURI).origin;
  } catch {
    return null;
  }
};

/** The OS's colours a page is handed, by the name it gets them under (--sdc-<name>). */
const COLOUR_VARS: Record<string, string> = {
  background: '--win-bg',
  surface: '--layer',
  card: '--card',
  text: '--text-1',
  'text-secondary': '--text-2',
  'text-tertiary': '--text-3',
  border: '--stroke',
  'border-strong': '--stroke-strong',
  accent: '--accent',
  'accent-fill': '--accent-fill',
  'accent-text': '--accent-text',
  'on-accent': '--accent-on',
  success: '--success',
  caution: '--caution',
  critical: '--critical',
};

type Modal =
  | { kind: 'alert'; opts: AlertOpts; done: (v: unknown) => void }
  | { kind: 'confirm'; opts: ConfirmOpts; done: (v: unknown) => void }
  | { kind: 'prompt'; opts: PromptOpts; done: (v: unknown) => void }
  | { kind: 'color'; initial?: string; done: (v: unknown) => void }
  | { kind: 'menu'; x: number; y: number; items: MenuItemOpts[]; done: (v: unknown) => void }
  | { kind: 'photo'; done: (v: unknown) => void }
  | { kind: 'leave'; message: string; done: (v: unknown) => void };

/** A dialog as it is asked for: everything but the answer. */
type ModalAsk = Modal extends infer M ? (M extends Modal ? Omit<M, 'done'> : never) : never;

/** A call the page made that this window cannot answer: its message goes back to the page as the error. */
class Refusal extends Error {}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const obj = <T extends object>(v: unknown): T => (v && typeof v === 'object' ? (v as T) : ({} as T));

export default function ExtApp({ win }: AppProps) {
  const app = win.app as ExtAppId;
  const def = useOS(s => s.payload?.computer.apps.find(a => a.id === app));
  const ext = def?.ext;
  const origin = useMemo(() => originOf(ext?.ui), [ext?.ui]);
  const originRef = useRef(origin);
  originRef.current = origin;
  const active = useOS(selectActiveId) === win.id;
  const settings = useOS(s => s.settings);
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  /** The page in the frame can be read, so the copy of the screen can show it. */
  const [readable, setReadable] = useState(false);
  const [modal, setModal] = useState<Modal | null>(null);
  const modalRef = useRef<Modal | null>(null);
  modalRef.current = modal;

  const ready = useRef(false);
  /** The document in the frame, as its SDK named itself in its hello. */
  const doc = useRef<string | null>(null);
  const outbox = useRef<ToPage[]>([]);
  const leaveMessage = useRef<string | null>(null);
  /** A print dialog is up for the page (it is drawn by PrintSlot, not as one of the dialogs here). */
  const printing = useRef(false);
  const winRef = useRef<Win>(win);
  winRef.current = win;
  const activeRef = useRef(active);
  activeRef.current = active;

  // ── To the page ──────────────────────────────────────────────────────────────────────────

  const post = useCallback((msg: ToPage, now = false) => {
    if (!now && !ready.current) {
      if (outbox.current.length < OUTBOX_MAX) outbox.current.push(msg);
      return;
    }
    const target = originRef.current;
    if (target) frameRef.current?.contentWindow?.postMessage(msg, target);
  }, []);

  const event = useCallback((name: PageEvent, data?: unknown) => post({ sdc: 1, type: 'event', name, data }), [post]);

  const pageSettings = useCallback((): PageSettings => {
    const os = useOS.getState();
    const css = rootRef.current ? getComputedStyle(rootRef.current) : null;
    const colors: Record<string, string> = {};
    for (const [name, v] of Object.entries(COLOUR_VARS)) {
      const value = css?.getPropertyValue(v).trim();
      if (value) colors[name] = value;
    }
    return {
      theme: os.settings.theme,
      style: os.payload?.computer.style ?? 'modern',
      accent: os.settings.accent,
      clock24: os.payload?.desktop.clock24 === true,
      colors,
      font: css?.fontFamily ?? '',
    };
  }, []);

  const windowState = useCallback((): WindowState => {
    const w = winRef.current;
    const body = rootRef.current;
    return {
      focused: activeRef.current,
      minimized: w.min,
      maximized: w.max,
      width: body?.clientWidth ?? w.w,
      height: body?.clientHeight ?? w.h,
      title: w.title,
    };
  }, []);

  // ── Dialogs ──────────────────────────────────────────────────────────────────────────────

  /** Put a dialog up and wait for its answer. One at a time: a second while one is up is refused. */
  const ask = useCallback(<T,>(m: ModalAsk): Promise<T> => {
    if (modalRef.current || printing.current) return Promise.reject(new Refusal(t('ui.ext.busy')));
    return new Promise<T>(resolve => {
      let settled = false;
      const done = (v: unknown) => {
        if (settled) return;
        settled = true;
        setModal(null);
        resolve(v as T);
      };
      const next = { ...m, done } as Modal;
      modalRef.current = next;
      setModal(next);
    });
  }, []);

  // Closing the window (or standing up) while the page has asked for that to be checked first.
  useEffect(() => {
    setCloseGuard(win.id, () => {
      const message = leaveMessage.current;
      if (message === null) return true;
      if (!modalRef.current) {
        void ask<boolean>({ kind: 'leave', message }).then(yes => {
          if (!yes) return;
          leaveMessage.current = null;
          useOS.getState().close(win.id);
        });
      }
      return false;
    });
    return () => setCloseGuard(win.id, null);
  }, [win.id, ask]);

  // ── What the page asks for ───────────────────────────────────────────────────────────────

  const handle = useCallback(
    async (method: string, args: unknown[]): Promise<unknown> => {
      const os = useOS.getState();
      const id = ext?.id ?? app.slice(4);
      const [a, b, c] = args;
      switch (method) {
        case 'callServer': {
          if (typeof a !== 'string' || a === '') throw new Refusal(t('ui.ext.bad_call'));
          const r = await rpc('app:call', { app: id, endpoint: a, data: b ?? null });
          if (!r.ok) throw new Refusal(r.error ?? t('ui.common.error'));
          return r.data ?? null;
        }
        case 'notify': {
          const n = obj<{ title?: unknown; body?: unknown; data?: unknown }>(a);
          const title = str(n.title, 80);
          if (!title) throw new Refusal(t('ui.ext.bad_call'));
          notifyFrom(app, title, str(n.body, 240) || undefined, n.data);
          return true;
        }
        case 'setBadge': {
          const count = Math.max(0, Math.min(9999, Math.floor(Number(a) || 0)));
          os.setBadge(app, count);
          void rpc('app:badge', { app: id, count });
          return count;
        }
        case 'dialog.alert':
          await ask<void>({ kind: 'alert', opts: obj<AlertOpts>(a) });
          return true;
        case 'dialog.confirm':
          return ask<boolean>({ kind: 'confirm', opts: obj<ConfirmOpts>(a) });
        case 'dialog.prompt':
          return ask<string | null>({ kind: 'prompt', opts: obj<PromptOpts>(a) });
        case 'menu': {
          const m = obj<{ x?: unknown; y?: unknown; items?: unknown }>(a);
          const items = Array.isArray(m.items) ? (m.items.slice(0, 40) as MenuItemOpts[]).map(obj<MenuItemOpts>) : [];
          if (items.length === 0) throw new Refusal(t('ui.ext.bad_call'));
          return ask<string | null>({ kind: 'menu', x: Math.max(0, Number(m.x) || 0), y: Math.max(0, Number(m.y) || 0), items });
        }
        case 'pickColor':
          return ask<string | null>({ kind: 'color', initial: typeof a === 'string' ? a : undefined });
        case 'pickPhoto':
          if (!os.payload?.computer.apps.some(x => x.id === 'photos')) throw new Refusal(t('ui.ext.unavailable'));
          return ask<{ url: string; id: string } | null>({ kind: 'photo' });
        case 'print': {
          if (os.payload?.desktop.printing === false) throw new Refusal(t('ui.ext.unavailable'));
          const job = obj<{ title?: unknown; data?: unknown; text?: unknown }>(a);
          if (modalRef.current || printing.current) throw new Refusal(t('ui.ext.busy'));
          const title = str(job.title, 120) || def?.label || id;
          printing.current = true;
          return new Promise<boolean>(resolve => {
            let settled = false;
            askPrint(app, {
              source: 'app',
              title,
              data: { app: id, title, data: job.data ?? null, text: typeof job.text === 'string' ? job.text : null },
              onDone: sent => {
                if (settled) return;
                settled = true;
                printing.current = false;
                resolve(sent);
              },
            });
          });
        }
        case 'openApp': {
          if (typeof a !== 'string' || a === '') throw new Refusal(t('ui.ext.bad_call'));
          const apps = os.payload?.computer.apps ?? [];
          const target = apps.find(x => x.id === a && !isExt(x.id)) ?? apps.find(x => x.id === `ext:${a}` || (isExt(x.id) && x.id === a));
          if (!target) throw new Refusal(t('ui.ext.not_installed'));
          const props = b && typeof b === 'object' ? (b as Record<string, unknown>) : undefined;
          os.openApp(target.id as AppId, isExt(target.id) ? (props ? { launch: props } : undefined) : props);
          return true;
        }
        case 'storage.get': {
          const r = await rpc<{ value?: string | null }>('app:storage', { app: id, op: 'get', key: a, scope: b ?? null });
          if (!r.ok) throw new Refusal(r.error ?? t('ui.common.error'));
          return r.data?.value ?? null;
        }
        case 'storage.set': {
          const r = await rpc('app:storage', { app: id, op: 'set', key: a, value: typeof b === 'string' ? b : null, scope: c ?? null });
          if (!r.ok) throw new Refusal(r.error ?? t('ui.common.error'));
          return true;
        }
        case 'storage.keys': {
          const r = await rpc<{ keys?: string[] }>('app:storage', { app: id, op: 'keys', scope: a ?? null });
          if (!r.ok) throw new Refusal(r.error ?? t('ui.common.error'));
          return Array.isArray(r.data?.keys) ? r.data.keys : [];
        }
        case 'storage.clear': {
          const r = await rpc('app:storage', { app: id, op: 'clear', scope: a ?? null });
          if (!r.ok) throw new Refusal(r.error ?? t('ui.common.error'));
          return true;
        }
        case 'sound': {
          const retro = os.payload?.computer.style === 'retro';
          if (a === 'notify') (retro ? retroSfx.notify : sfx.notify)();
          else if (a === 'error') (retro ? retroSfx.deny : sfx.error)();
          else if (a === 'click') (retro ? retroSfx.click : sfx.click)();
          else throw new Refusal(t('ui.ext.bad_call'));
          return true;
        }
        case 'log': {
          const l = obj<{ message?: unknown; level?: unknown; data?: unknown }>(a);
          const r = await rpc('app:log', { app: id, message: str(l.message, 512), level: l.level, data: l.data });
          if (!r.ok) throw new Refusal(r.error ?? t('ui.common.error'));
          return true;
        }
        case 'settings':
          return pageSettings();
        case 'window.setTitle':
          os.retitle(win.id, str(a, 80) || def?.label || id);
          return true;
        case 'window.close':
          os.close(win.id);
          return true;
        case 'window.minimize':
          os.minimize(win.id);
          return true;
        case 'window.maximize':
          if (!winRef.current.max && winRef.current.resizable) os.toggleMax(win.id);
          return true;
        case 'window.restore':
          if (winRef.current.min) os.restore(win.id);
          else if (winRef.current.max) os.toggleMax(win.id);
          return true;
        case 'window.focus':
          if (winRef.current.min) os.restore(win.id);
          else os.focus(win.id);
          return true;
        case 'window.preventClose':
          leaveMessage.current = typeof a === 'string' && a !== '' ? a.slice(0, 300) : a === true ? t('ui.ext.leave_body') : null;
          return true;
        case 'window.state':
          return windowState();
        default:
          throw new Refusal(t('ui.ext.unknown_call', method));
      }
    },
    [app, ext?.id, def?.label, win.id, ask, pageSettings, windowState],
  );

  const init = useCallback((): InitData => {
    const p = useOS.getState().payload;
    const unavailable: string[] = [];
    if (!p?.computer.apps.some(x => x.id === 'photos')) unavailable.push('pickPhoto');
    if (p?.desktop.printing === false) unavailable.push('print');
    return {
      version: SDK_VERSION,
      methods: METHODS,
      unavailable,
      app: { id: ext?.id ?? app.slice(4), label: def?.label ?? app, resource: ext?.resource ?? '', version: ext?.version ?? null, developer: ext?.developer ?? null },
      machine: {
        id: p?.computer.id ?? '',
        label: p?.computer.label ?? '',
        hostname: p?.computer.hostname ?? '',
        ip: p?.computer.ip ?? '',
        style: p?.computer.style ?? 'modern',
        os: p?.desktop.osName ?? '',
        build: p?.desktop.osBuild ?? '',
      },
      user: { name: p?.user.name ?? '', initials: p?.user.initials ?? '', job: p?.user.job ?? '' },
      settings: pageSettings(),
      launch: winRef.current.props?.launch ?? null,
      window: windowState(),
    };
  }, [app, ext, def?.label, pageSettings, windowState]);

  // ── From the page ────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || e.source !== frame.contentWindow || e.origin !== originRef.current || !isFromPage(e.data)) return;
      const m = e.data;
      switch (m.type) {
        case 'hello': {
          if (m.doc !== doc.current) {
            // A new document in the frame (the page loaded again, or went to another of its pages):
            // what the last one had asked for goes with it.
            doc.current = m.doc;
            modalRef.current?.done(null);
            leaveMessage.current = null;
            frame.dataset.typing = '';
          }
          post({ sdc: 1, type: 'init', data: init() }, true);
          ready.current = true;
          const queued = outbox.current;
          outbox.current = [];
          for (const q of queued) post(q, true);
          for (const data of takeClicks(app)) event('notification', data);
          return;
        }
        case 'call': {
          const { id, doc: from } = m;
          handle(m.method, Array.isArray(m.args) ? m.args : []).then(
            value => post({ sdc: 1, type: 'reply', doc: from, id, ok: true, value: value ?? null }, true),
            (err: unknown) => {
              if (!(err instanceof Refusal)) console.error(`[sd-computers] ${app} ${m.method} failed`, err);
              post({ sdc: 1, type: 'reply', doc: from, id, ok: false, error: err instanceof Error ? err.message : t('ui.common.error') }, true);
            },
          );
          return;
        }
        case 'typing':
          frame.dataset.typing = m.on ? '1' : '';
          return;
        case 'key':
          if (m.key === 'F4' && m.alt) useOS.getState().close(win.id);
          else if (m.key === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', ctrlKey: m.ctrl, altKey: m.alt, shiftKey: m.shift, cancelable: true }));
          return;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [app, win.id, handle, init, post, event]);

  // ── Telling the page what changed ────────────────────────────────────────────────────────

  useNuiEvent<{ app: string; action: string; data?: unknown }>('computers:app:message', d => {
    if (d && d.app === app && typeof d.action === 'string') event('message', { action: d.action, data: d.data ?? null });
  });

  useBus(`ext:click:${app}`, data => event('notification', data));

  // (after the look has had a frame to put its colours on, so they are the new ones)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (ready.current) event('settings', pageSettings());
    });
    return () => cancelAnimationFrame(raf);
  }, [settings.theme, settings.accent, event, pageSettings]);

  const launch = win.props?.launch;
  const lastLaunch = useRef(launch);
  useEffect(() => {
    if (launch === lastLaunch.current) return;
    lastLaunch.current = launch;
    event('launch', launch ?? null);
  }, [launch, event]);

  const shape = `${active}|${win.min}|${win.max}|${win.w}|${win.h}|${win.title}`;
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (ready.current) event('window', windowState());
    });
    return () => cancelAnimationFrame(raf);
  }, [shape, event, windowState]);

  // The window opening and closing: the app's onOpen / onClose on its server, and the events
  // other resources on this client hear (client/computers/apps.lua).
  useEffect(() => {
    const id = ext?.id ?? app.slice(4);
    void rpc('app:window', { app: id, open: true });
    void fetchNui('computers:app:window', { app: id, open: true });
    return () => {
      void rpc('app:window', { app: id, open: false });
      void fetchNui('computers:app:window', { app: id, open: false });
    };
  }, [app, ext?.id]);

  // The page loaded: the SDK goes into it, unless it brought its own. A page from another origin
  // cannot be reached into - it starts the SDK itself, with a script tag of its own (and has said
  // hello before this runs: its readiness stands).
  const onLoad = useCallback(() => {
    const frame = frameRef.current;
    setLoaded(true);
    if (!frame) return;
    try {
      const w = frame.contentWindow as (Window & { computer?: unknown }) | null;
      const page = frame.contentDocument;
      setReadable(page !== null);
      if (!w || !page || w.computer) return;
      // (a new document, still to start its SDK: what is sent meanwhile waits for its hello)
      ready.current = false;
      const script = page.createElement('script');
      script.src = SDK_URL;
      (page.head ?? page.documentElement).appendChild(script);
    } catch {
      /* another origin */
      setReadable(false);
    }
  }, []);

  if (!def || !ext) return null;

  const share = ext.mirror !== false;

  const splash = (
    <div className="flex flex-col items-center justify-center gap-3">
      <ExtIcon app={app} size={64} look="modern" />
      <div className="text-subtitle font-semibold text-t1">{def.label}</div>
    </div>
  );

  return (
    <div ref={rootRef} className="ext-app relative h-full w-full overflow-hidden bg-win">
      {ext.ui ? (
        <>
          <iframe
            ref={frameRef}
            src={ext.ui}
            title={def.label}
            onLoad={onLoad}
            allow="autoplay; clipboard-read; clipboard-write"
            data-mirror-frame={share ? '' : undefined}
            className={`${share ? '' : 'mirror-block '}absolute inset-0 block h-full w-full border-0`}
            style={{ opacity: loaded ? 1 : 0, transition: 'opacity 160ms ease-out' }}
          />
          <div className="absolute inset-0 flex items-center justify-center bg-win pointer-events-none" style={{ opacity: loaded ? 0 : 1, transition: 'opacity 200ms ease-out' }}>
            {splash}
          </div>
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center p-8">
          {splash}
          <div className="text-body text-t2 max-w-[340px]">{t('ui.ext.no_ui')}</div>
        </div>
      )}

      {/* What the players watching this computer's screen see where a page they cannot see is (src/screen/live.ts). */}
      {!(share && readable) && (
        <div data-mirror-placeholder className="ext-mirror absolute inset-0 z-[5] flex items-center justify-center bg-win" style={{ visibility: 'hidden' }} aria-hidden>
          {splash}
        </div>
      )}

      {!active && <div className="absolute inset-0 z-10" />}

      {modal?.kind === 'alert' && <AlertBox opts={modal.opts} onDone={() => modal.done(true)} />}
      {modal?.kind === 'confirm' && <ConfirmBox opts={modal.opts} onDone={modal.done} />}
      {modal?.kind === 'prompt' && <PromptBox opts={modal.opts} onDone={modal.done} />}
      {modal?.kind === 'color' && <ColorBox initial={modal.initial} onDone={modal.done} />}
      {modal?.kind === 'menu' && <MenuBox x={modal.x} y={modal.y} items={modal.items} onDone={modal.done} />}
      {modal?.kind === 'photo' && <PhotoPicker onPick={p => modal.done({ url: p.url, id: p.id })} onClose={() => modal.done(null)} />}
      {modal?.kind === 'leave' && (
        <ConfirmBox
          opts={{ title: t('ui.ext.leave_title', def.label), message: modal.message, confirmLabel: t('ui.ext.leave_confirm'), danger: true }}
          onDone={modal.done}
        />
      )}
      <PrintSlot app={app} />
    </div>
  );
}
