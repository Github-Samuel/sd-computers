import { Fragment, useEffect, useRef, useState } from 'react';
import { useOS, type Win, type WinApp } from '@/store/os';
import type { AppId } from '@/types';
import { t } from '@/i18n';
import { MacIcon, MiniWindow } from './MacIcon';
import { MenuPanel, useDismiss, type MenuEntry } from './Menu';
import { DOCK_BOTTOM, DOCK_ICON, DOCK_PAD, DOCK_SLAB, setDockElement } from './layout';
import AppBadge from '../AppBadge';

/** Peak magnification and how far (px from the cursor) it reaches. */
const MAG = 1.55;
const RANGE = 170;

interface Entry {
  key: string;
  app: WinApp;
  label: string;
  win?: Win;
  /** 'min' = a minimized window's thumbnail on the right of the separator. */
  kind: 'app' | 'min';
}

/**
 * The dock: a floating translucent slab at the bottom centre. Pinned apps, then any other running
 * window (hack windows included), a separator, then minimized windows. Icons magnify around the
 * cursor (written straight to the DOM per animation frame, no React state per move), show their
 * label above, a dot under running apps, and bounce on launch.
 */
export default function Dock() {
  const payload = useOS(s => s.payload)!;
  const windows = useOS(s => s.windows);
  const dark = useOS(s => s.settings.theme === 'dark');
  const [bounce, setBounce] = useState<Record<string, number>>({});
  const [hover, setHover] = useState(false);
  const [menu, setMenu] = useState<{ entry: Entry; x: number; bottom: number } | null>(null);
  const slabRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const mouse = useRef<number | null>(null);
  const raf = useRef(0);
  const timers = useRef<number[]>([]);

  useDismiss(menu !== null, () => setMenu(null), menuRef);

  useEffect(() => {
    setDockElement(slabRef.current);
    return () => {
      setDockElement(null);
      cancelAnimationFrame(raf.current);
      timers.current.forEach(h => window.clearTimeout(h));
    };
  }, []);

  const apps = payload.computer.apps;
  const labelOf = (app: AppId) => apps.find(a => a.id === app)?.label ?? app;
  const main: Entry[] = payload.computer.pinned
    .filter(app => apps.some(a => a.id === app))
    .map(app => ({ key: app, app, label: labelOf(app), win: windows.find(w => w.id === app), kind: 'app' }));
  for (const w of windows) {
    if (!main.some(e => e.key === w.id)) main.push({ key: w.id, app: w.app, label: w.title, win: w, kind: 'app' });
  }
  const minimized: Entry[] = windows.filter(w => w.min).map(w => ({ key: `min:${w.id}`, app: w.app, label: w.title, win: w, kind: 'min' }));

  // ── magnification ────────────────────────────────────────────────────────────────────
  const apply = () => {
    raf.current = 0;
    const mx = mouse.current;
    const list = Array.from(nodes.current.values());
    // Read every rect first, then write, so the browser lays out once per frame.
    const centers = list.map(el => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2;
    });
    list.forEach((el, i) => {
      let s = 1;
      if (mx !== null) {
        const d = Math.abs(mx - centers[i]);
        if (d < RANGE) s = 1 + (MAG - 1) * ((Math.cos((d / RANGE) * Math.PI) + 1) / 2);
      }
      el.style.setProperty('--s', s.toFixed(3));
    });
  };
  const schedule = () => {
    if (!raf.current) raf.current = requestAnimationFrame(apply);
  };

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const startBounce = (key: string) => {
    const stamp = Date.now();
    setBounce(b => ({ ...b, [key]: stamp }));
    later(() => setBounce(b => {
      if (b[key] !== stamp) return b;
      const next = { ...b };
      delete next[key];
      return next;
    }), 1100);
  };

  const activate = (e: Entry) => {
    const s = useOS.getState();
    setMenu(null);
    s.setStart(false);
    if (!e.win) {
      s.openApp(e.app as AppId);
      startBounce(e.key);
      return;
    }
    if (e.win.min || e.win.exit === 'min') s.restore(e.win.id);
    else s.focus(e.win.id);
  };

  const menuFor = (e: Entry): MenuEntry[] => {
    const s = useOS.getState();
    if (!e.win) return [{ label: t('ui.mac.dock_open'), onSelect: () => activate(e) }];
    const w = e.win;
    return [
      w.min ? { label: t('ui.mac.dock_show'), onSelect: () => s.restore(w.id) } : { label: t('ui.mac.dock_hide'), onSelect: () => s.minimize(w.id) },
      { sep: true },
      { label: t('ui.mac.dock_quit'), onSelect: () => s.close(w.id) },
    ];
  };

  const item = (e: Entry) => {
    const running = e.kind === 'app' && !!e.win;
    return (
      <div
        key={e.key}
        ref={el => {
          if (el) nodes.current.set(e.key, el);
          else nodes.current.delete(e.key);
        }}
        className="mac-dock-item"
        data-sfx="press"
        onClick={() => activate(e)}
        onContextMenu={ev => {
          ev.preventDefault();
          ev.stopPropagation();
          const r = ev.currentTarget.getBoundingClientRect();
          setMenu({ entry: e, x: r.left + r.width / 2, bottom: window.innerHeight - r.top + 10 });
        }}
      >
        {!menu && <span className="mac-dock-tip">{e.label}</span>}
        <span key={bounce[e.key] ?? 0} className={`mac-dock-tile ${bounce[e.key] ? 'is-bouncing' : ''}`}>
          {e.kind === 'min' ? <MiniWindow app={e.app} dark={dark} /> : <MacIcon app={e.app} />}
        </span>
        {e.kind === 'app' && <AppBadge app={e.app} />}
        {running && <span className="mac-dock-dot" />}
      </div>
    );
  };

  return (
    <>
      <div className="absolute left-0 right-0 flex justify-center pointer-events-none" style={{ bottom: DOCK_BOTTOM, zIndex: 40 }}>
        <div
          ref={slabRef}
          className={`mac-dock pointer-events-auto ${hover ? 'is-hover' : ''}`}
          style={{ height: DOCK_SLAB, padding: DOCK_PAD, ['--mac-dock-icon' as string]: `${DOCK_ICON}px` }}
          onMouseDown={e => e.stopPropagation()}
          onMouseMove={e => {
            mouse.current = e.clientX;
            if (!hover) setHover(true);
            schedule();
          }}
          onMouseLeave={() => {
            mouse.current = null;
            setHover(false);
            schedule();
          }}
        >
          {main.map(item)}
          {minimized.length > 0 && (
            <Fragment>
              <span className="mac-dock-sep" />
              {minimized.map(item)}
            </Fragment>
          )}
        </div>
      </div>
      {menu && (
        <div className="absolute -translate-x-1/2" style={{ left: menu.x, bottom: menu.bottom, zIndex: 70 }}>
          <MenuPanel menuRef={menuRef} items={menuFor(menu.entry)} onClose={() => setMenu(null)} className="min-w-[160px] mac-pop-up" />
        </div>
      )}
    </>
  );
}
