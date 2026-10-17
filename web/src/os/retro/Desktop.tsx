// The signed-in retro desktop - a 1991-style replacement shell (ported from frp_mdt's Shell): a slim
// menu bar across the top (the SD mark's system menu, File, Window, Help, clock), launch icons
// directly on the dithered wallpaper, floating bevelled windows, minimized windows as icons along the
// bottom-left, toasts as little message boxes, and a status bar along the bottom.
//
// The area between the bars is the desktop container: it registers its size with the store
// (setBoundsProvider) so window placement, dragging and clamping all stay inside the tube.
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useOS, selectActiveId, setBoundsProvider, type Win } from '@/store/os';
import type { AppId } from '@/types';
import { appFor } from '@/apps/registry';
import { t } from '@/i18n';
import { fmtShortDate, fmtTime, useNow } from '@/lib/format';
import { Wallpaper } from '../Wallpaper';
import { lockSession } from '../session';
import RetroWindow from './WindowFrame';
import { MenuBar, type MenuDef, type MenuEntry } from './Menu';
import MessageBox from './MessageBox';
import Toasts from './Toasts';
import { IconStop, PixelAppIcon, PixelMark } from './glyphs';
import { retroSfx } from './sounds';

const EXE: Record<string, string> = {
  mail: 'MAIL.EXE',
  logs: 'EVENTLOG.EXE',
  cmd: 'PROMPT.EXE',
  boss: 'BUSINESS.EXE',
  notepad: 'NOTEPAD.EXE',
  calculator: 'CALC.EXE',
  messages: 'MESSAGES.EXE',
  notes: 'NOTES.EXE',
  settings: 'SETTINGS.EXE',
  hack: 'HACK.EXE',
  mines: 'MINES.EXE',
  solitaire: 'SOL.EXE',
  snake: 'SNAKE.EXE',
};

/** The program's 8.3 file name, as the status bar and Run... know it. */
const exeName =(id: string): string => EXE[id] ?? `${id.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase()}.EXE`;

type DialogState = null | { kind: 'about' } | { kind: 'run' } | { kind: 'keys' } | { kind: 'error'; text: string };

/** Desk size (the container between the bars). */
const deskSize = (el: HTMLElement | null) => ({ w: el?.clientWidth ?? 800, h: el?.clientHeight ?? 560 });

export default function Desktop() {
  const payload = useOS(s => s.payload)!;
  const settings = useOS(s => s.settings);
  const start = useOS(s => s.start);
  const anyWindows = useOS(s => s.windows.some(w => !w.exit));
  const { openApp, setStart, setPhase, closeAll } = useOS.getState();
  const deskRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const [selIcon, setSelIcon] = useState<AppId | null>(null);
  const [launching, setLaunching] = useState<AppId | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const launchTimer = useRef(0);

  // The tube's desk is where windows live.
  useLayoutEffect(() => {
    setBoundsProvider(() => deskSize(deskRef.current));
    return () => setBoundsProvider(null);
  }, []);

  // Keep every title bar reachable when the desk changes size (and fix up anything placed before
  // the provider existed).
  useEffect(() => {
    const el = deskRef.current;
    if (!el) return;
    const clamp = () => {
      const { w: bw, h: bh } = deskSize(el);
      const { windows, resize } = useOS.getState();
      for (const w of windows) {
        const nw = Math.max(Math.min(w.w, bw - 8), Math.min(280, bw));
        const nh = Math.max(Math.min(w.h, bh - 8), Math.min(180, bh));
        const nx = Math.max(-nw + 60, Math.min(w.x, bw - 60));
        const ny = Math.max(0, Math.min(w.y, bh - 22));
        if (nx !== w.x || ny !== w.y || nw !== w.w || nh !== w.h) resize(w.id, nx, ny, nw, nh);
      }
    };
    const ro = new ResizeObserver(clamp);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => window.clearTimeout(launchTimer.current), []);

  // The bar's menus ride the store's generic "launcher open" flag: Ctrl+Escape opens the system
  // menu, Escape / setPhase close whatever is open.
  const openMenu = (i: number | null) => {
    setMenu(i);
    if ((i !== null) !== useOS.getState().start) setStart(i !== null);
  };
  useEffect(() => {
    if (!start) setMenu(null);
    else setMenu(m => (m === null ? 0 : m));
  }, [start]);

  const apps = payload.computer.apps;
  const has = (id: AppId) => apps.some(a => a.id === id);
  const osName = payload.desktop.osName;

  const launch = (id: AppId) => {
    if (!has(id)) return;
    setSelIcon(id);
    const running = useOS.getState().windows.find(w => w.id === id);
    if (running) {
      if (running.min) retroSfx.maximize();
      openApp(id);
      return;
    }
    if (launching) return;
    // The period acknowledgement: the icon blinks, the drive chatters, the status bar says so.
    setLaunching(id);
    setHint(t('ui.retro.hint_loading', exeName(id)));
    retroSfx.launch();
    launchTimer.current = window.setTimeout(() => {
      setLaunching(null);
      setHint(null);
      openApp(id);
    }, 320);
  };

  const lock = () => {
    lockSession();
    setPhase('lock');
  };
  const signOut = () => {
    lockSession();
    closeAll();
    setPhase('lock');
  };

  const arrange = (kind: 'cascade' | 'tile') => {
    const s = useOS.getState();
    const vis = s.windows.filter(w => !w.min && !w.exit).sort((a, b) => a.z - b.z);
    if (!vis.length) return;
    const { w: bw, h: bh } = deskSize(deskRef.current);
    const cols = Math.ceil(Math.sqrt(vis.length));
    const rows = Math.ceil(vis.length / cols);
    vis.forEach((w, i) => {
      if (w.max) s.toggleMax(w.id);
      let x: number;
      let y: number;
      let ww: number;
      let hh: number;
      if (kind === 'cascade') {
        const step = (i % 8) * 22;
        ww = Math.floor(bw * 0.62);
        hh = Math.floor(bh * 0.66);
        x = 8 + step;
        y = 8 + step;
      } else {
        const cw = Math.floor(bw / cols);
        const ch = Math.floor(bh / rows);
        x = (i % cols) * cw;
        y = Math.floor(i / cols) * ch;
        ww = cw;
        hh = ch;
      }
      if (!w.resizable) {
        ww = w.w;
        hh = w.h;
      }
      s.resize(w.id, x, y, ww, hh);
      if (kind === 'cascade') s.focus(w.id);
    });
    retroSfx.maximize();
  };

  const minimizeAll = () => {
    for (const w of useOS.getState().windows) if (!w.min && !w.exit) useOS.getState().minimize(w.id);
  };

  // Shell accelerators: Shift+F4 tile, Shift+F5 cascade.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || (e.key !== 'F4' && e.key !== 'F5')) return;
      e.preventDefault();
      arrange(e.key === 'F4' ? 'tile' : 'cascade');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const about = () => setDialog({ kind: 'about' });

  const menus: MenuDef[] = [
    {
      key: 'system',
      label: t('ui.retro.menu_system'),
      title: <PixelMark size={16} />,
      entries: [
        { label: t('ui.retro.menu_about', osName), action: about },
        ...(has('settings') ? [{ label: t('ui.retro.menu_settings'), action: () => launch('settings') }] : []),
        'sep',
        { label: t('ui.retro.menu_lock'), action: lock },
        { label: t('ui.retro.menu_signout'), action: signOut },
        'sep',
        { label: t('ui.retro.menu_shutdown'), action: () => setPhase('shutdown') },
      ],
    },
    {
      key: 'file',
      label: t('ui.retro.menu_file'),
      title: t('ui.retro.menu_file'),
      entries: [
        ...apps.map(a => ({ label: t('ui.retro.menu_open', a.label), action: () => launch(a.id) })),
        'sep',
        { label: t('ui.retro.menu_run'), action: () => setDialog({ kind: 'run' }) },
      ],
    },
    {
      key: 'window',
      label: t('ui.retro.menu_window'),
      title: t('ui.retro.menu_window'),
      entries: windowMenu(anyWindows, () => arrange('cascade'), () => arrange('tile'), minimizeAll),
    },
    {
      key: 'help',
      label: t('ui.retro.menu_help'),
      title: t('ui.retro.menu_help'),
      entries: [{ label: t('ui.retro.menu_keys'), action: () => setDialog({ kind: 'keys' }) }, 'sep', { label: t('ui.retro.menu_about', osName), action: about }],
    },
  ];

  const icons = payload.computer.desktopIcons
    .map(id => apps.find(a => a.id === id))
    .filter((a): a is NonNullable<typeof a> => !!a);

  const closeDialog = () => setDialog(null);

  return (
    <div className="rt-desktop" style={launching ? { cursor: 'wait' } : undefined}>
      <MenuBar menus={menus} open={menu} setOpen={openMenu} trailing={<MenuClock clock24={payload.desktop.clock24} />} />

      <div ref={deskRef} className="rt-desk" onPointerDown={() => setSelIcon(null)}>
        <Wallpaper id={settings.wallpaper} accent={settings.accent} />

        <div className="rt-icons">
          {icons.map(a => (
            <button
              key={a.id}
              type="button"
              className={`rt-icon${selIcon === a.id ? ' is-sel' : ''}${launching === a.id ? ' is-launching' : ''}`}
              title={exeName(a.id)}
              onPointerDown={e => {
                e.stopPropagation();
                setSelIcon(a.id);
              }}
              onDoubleClick={() => launch(a.id)}
              onKeyDown={e => {
                if (e.key === 'Enter') launch(a.id);
              }}
            >
              <span className="rt-icon-img">
                <PixelAppIcon app={a.id} size={32} />
              </span>
              <span className="rt-icon-lbl">{a.label}</span>
            </button>
          ))}
        </div>

        <WindowLayer />
        <Toasts />

        {dialog?.kind === 'about' && <AboutBox onClose={closeDialog} />}
        {dialog?.kind === 'keys' && <KeysBox onClose={closeDialog} />}
        {dialog?.kind === 'run' && (
          <RunBox
            onClose={closeDialog}
            onRun={cmd => {
              const q = cmd.trim().toLowerCase();
              if (!q) return;
              const hit = apps.find(a => {
                const exe = exeName(a.id).toLowerCase();
                return exe === q || exe.replace(/\.exe$/, '') === q || a.id === q || a.label.toLowerCase() === q;
              });
              if (!hit) {
                retroSfx.deny();
                setDialog({ kind: 'error', text: t('ui.retro.run_not_found', cmd.trim()) });
                return;
              }
              closeDialog();
              launch(hit.id);
            }}
          />
        )}
        {dialog?.kind === 'error' && (
          <MessageBox title={osName} icon={<IconStop size={32} />} onClose={closeDialog} width={360} buttons={[{ label: t('ui.common.ok'), primary: true, onClick: closeDialog }]}>
            <p className="rt-p">{dialog.text}</p>
          </MessageBox>
        )}
      </div>

      <StatusBar hint={hint} />
    </div>
  );
}

/** Window menu: Cascade / Tile / Minimize all, then every window (checked = the active one). */
function windowMenu(any: boolean, cascade: () => void, tile: () => void, minimizeAll: () => void): MenuEntry[] {
  const s = useOS.getState();
  const activeId = selectActiveId(s);
  const list = s.windows.filter(w => !w.exit);
  const entries: MenuEntry[] = [
    { label: t('ui.retro.menu_cascade'), accel: 'Shift+F5', disabled: !any, action: cascade },
    { label: t('ui.retro.menu_tile'), accel: 'Shift+F4', disabled: !any, action: tile },
    { label: t('ui.retro.menu_minimize_all'), disabled: !list.some(w => !w.min), action: minimizeAll },
  ];
  if (list.length) {
    entries.push('sep');
    list.forEach((w, i) =>
      entries.push({
        label: (
          <>
            <u>{i + 1}</u> {w.title}
          </>
        ),
        checked: w.id === activeId,
        action: () => {
          if (w.min) {
            retroSfx.maximize();
            s.restore(w.id);
          } else s.focus(w.id);
        },
      }),
    );
  }
  return entries;
}

/**
 * Every window through the retro frame, plus the minimized ones as icons along the bottom-left.
 * Its own component (memo, no props) so the shell's menus/hints never re-render the apps.
 */
const WindowLayer = memo(function WindowLayer() {
  const windows = useOS(s => s.windows);
  const activeId = useOS(selectActiveId);
  const { restore } = useOS.getState();

  // A click (and a blip) for every window that appears - not for ones already open when the
  // desktop mounted (signing back in).
  const known = useRef<Set<string>>(new Set(windows.map(w => w.id)));
  useEffect(() => {
    let fresh = false;
    for (const w of windows)
      if (!known.current.has(w.id)) {
        known.current.add(w.id);
        fresh = true;
      }
    known.current.forEach(id => {
      if (!windows.some(w => w.id === id)) known.current.delete(id);
    });
    if (fresh) retroSfx.open();
  }, [windows]);

  const minimized = windows.filter(w => w.min && !w.exit);

  return (
    <>
      {minimized.length > 0 && (
        <div className="rt-minrow">
          {minimized.map(w => (
            <MinIcon
              key={w.id}
              win={w}
              onRestore={() => {
                retroSfx.maximize();
                restore(w.id);
              }}
            />
          ))}
        </div>
      )}
      {windows.map(w => {
        const App = appFor(w.app);
        return (
          <RetroWindow key={w.id} win={w} active={activeId === w.id}>
            <App win={w} />
          </RetroWindow>
        );
      })}
    </>
  );
});

function MinIcon({ win, onRestore }: { win: Win; onRestore: () => void }) {
  return (
    <button
      type="button"
      className="rt-icon rt-min-icon"
      title={win.title}
      onPointerDown={e => e.stopPropagation()}
      onClick={onRestore}
      onKeyDown={e => {
        if (e.key === 'Enter') onRestore();
      }}
    >
      <span className="rt-icon-img">
        <PixelAppIcon app={win.app} size={32} />
      </span>
      <span className="rt-icon-lbl">{win.title}</span>
    </button>
  );
}

function MenuClock({ clock24 }: { clock24: boolean }) {
  const now = useNow(5000);
  return <span className="rt-menubar-clock">{fmtTime(now, clock24)}</span>;
}

function StatusBar({ hint }: { hint: string | null }) {
  const payload = useOS(s => s.payload)!;
  const now = useNow(5000);
  return (
    <div className="rt-statusbar">
      <div className="rt-cell">{payload.user.name}</div>
      <div className="rt-cell">{payload.computer.hostname}</div>
      <div className="rt-cell is-grow">{hint ?? t('ui.retro.status_ready')}</div>
      <div className="rt-cell">
        {fmtShortDate(now)}&nbsp;&nbsp;{fmtTime(now, payload.desktop.clock24)}
      </div>
    </div>
  );
}

function AboutBox({ onClose }: { onClose: () => void }) {
  const payload = useOS(s => s.payload)!;
  const open = useOS(s => s.windows.filter(w => !w.exit).length);
  const d = payload.desktop;
  const c = payload.computer;
  const free = Math.max(12, 86 - open * 7);
  return (
    <MessageBox title={t('ui.retro.about_title', d.osName)} icon={<PixelMark size={48} />} onClose={onClose} width={430} buttons={[{ label: t('ui.common.ok'), primary: true, onClick: onClose }]}>
      <p className="rt-p rt-strong">{d.osName}</p>
      <p className="rt-p">{t('ui.retro.about_version', d.osBuild)}</p>
      <p className="rt-p">{t('ui.retro.about_copyright', new Date().getFullYear())}</p>
      <p className="rt-p rt-gap">{t('ui.retro.about_licensed')}</p>
      <p className="rt-p rt-strong">
        {payload.user.name}
        {payload.user.job ? ` · ${payload.user.job}` : ''}
      </p>
      <p className="rt-p">{c.label}</p>
      <hr className="rt-hr" />
      <p className="rt-p rt-mono">{t('ui.retro.about_host', c.hostname, c.ip)}</p>
      <p className="rt-p rt-mono">{t('ui.retro.about_memory', '3,712')}</p>
      <p className="rt-p rt-mono">{t('ui.retro.about_resources', free)}</p>
    </MessageBox>
  );
}

function KeysBox({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Ctrl+Esc', t('ui.retro.keys_menu')],
    ['Alt+F4', t('ui.retro.keys_close')],
    ['Shift+F5', t('ui.retro.keys_cascade')],
    ['Shift+F4', t('ui.retro.keys_tile')],
    ['Esc', t('ui.retro.keys_escape')],
  ];
  return (
    <MessageBox title={t('ui.retro.keys_title')} onClose={onClose} width={400} buttons={[{ label: t('ui.common.ok'), primary: true, onClick: onClose }]}>
      <div className="rt-keys">
        {rows.map(([k, v]) => (
          <KeyRow key={k} k={k}>
            {v}
          </KeyRow>
        ))}
      </div>
    </MessageBox>
  );
}

const KeyRow = ({ k, children }: { k: string; children: ReactNode }) => (
  <>
    <span className="rt-mono">{k}</span>
    <span>{children}</span>
  </>
);

function RunBox({ onClose, onRun }: { onClose: () => void; onRun: (cmd: string) => void }) {
  const osName = useOS(s => s.payload!.desktop.osName);
  const [cmd, setCmd] = useState('');
  return (
    <MessageBox
      title={t('ui.retro.run_title')}
      onClose={onClose}
      width={400}
      buttons={[
        { label: t('ui.common.ok'), primary: true, disabled: !cmd.trim(), onClick: () => onRun(cmd) },
        { label: t('ui.common.cancel'), onClick: onClose },
      ]}
    >
      <p className="rt-p">{t('ui.retro.run_body', osName)}</p>
      <div className="rt-form">
        <label className="rt-label" htmlFor="rt-run-cmd">
          {t('ui.retro.run_label')}
        </label>
        <input
          id="rt-run-cmd"
          className="rt-field rt-mono-field"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          value={cmd}
          onChange={e => setCmd(e.target.value.slice(0, 64))}
          onKeyDown={e => {
            if (e.key.length === 1) retroSfx.key();
          }}
        />
      </div>
    </MessageBox>
  );
}
