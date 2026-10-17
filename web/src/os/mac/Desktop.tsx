import { useEffect, useRef, useState } from 'react';
import { useOS, selectActiveId, setBoundsProvider } from '@/store/os';
import type { AppId } from '@/types';
import { t } from '@/i18n';
import { appFor } from '@/apps/registry';
import { Wallpaper } from '../Wallpaper';
import { macAccentVars } from './accent';
import { MacIcon } from './MacIcon';
import { MenuPanel, useDismiss, type MenuEntry } from './Menu';
import MacWindow from './MacWindow';
import MenuBar from './MenuBar';
import Dock from './Dock';
import SearchOverlay from './Search';
import Notifications from './Notifications';
import { DOCK_RESERVE, MENU_H, TITLE_H } from './layout';
import AppBadge from '../AppBadge';

/**
 * The signed-in Harbor desktop: wallpaper, the icon column down the right edge, every window in
 * the Harbor frame (between the menu bar and the dock), the menu bar, the dock, Search,
 * notification banners and the desktop's right-click menu.
 */
export default function Desktop() {
  const payload = useOS(s => s.payload)!;
  const settings = useOS(s => s.settings);
  const windows = useOS(s => s.windows);
  const activeId = useOS(selectActiveId);
  const start = useOS(s => s.start);
  const [selected, setSelected] = useState<AppId | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menu !== null, () => setMenu(null), menuRef);

  // Windows live between the menu bar and the dock: tell the store, so placement / clamping /
  // dragging use that area.
  useEffect(() => {
    setBoundsProvider(() => {
      const el = areaRef.current;
      const w = el ? el.clientWidth : window.innerWidth;
      const h = el ? el.clientHeight : window.innerHeight - MENU_H;
      return { w, h: Math.max(200, h - DOCK_RESERVE) };
    });
    return () => setBoundsProvider(null);
  }, []);

  // Keep every title bar reachable if the viewport shrinks (resolution change, windowed game).
  useEffect(() => {
    const clamp = () => {
      const el = areaRef.current;
      if (!el) return;
      const { windows: ws, resize } = useOS.getState();
      const bw = el.clientWidth;
      const bh = el.clientHeight - DOCK_RESERVE;
      for (const w of ws) {
        const nw = Math.min(w.w, bw - 16);
        const nh = Math.min(w.h, bh - 16);
        const nx = Math.max(8 - nw + 120, Math.min(w.x, bw - 120));
        const ny = Math.max(0, Math.min(w.y, bh - TITLE_H));
        if (nx !== w.x || ny !== w.y || nw !== w.w || nh !== w.h) resize(w.id, nx, ny, nw, nh);
      }
    };
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, []);

  // Ctrl+Space toggles Search (Ctrl+Escape does too - Computer.tsx flips the same flag).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && (e.code === 'Space' || e.key === ' ')) {
        e.preventDefault();
        const s = useOS.getState();
        s.setStart(!s.start);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const dismiss = () => {
    setMenu(null);
    if (useOS.getState().start) useOS.getState().setStart(false);
  };

  const { openApp } = useOS.getState();
  const apps = payload.computer.apps;
  const has = (id: AppId) => apps.some(a => a.id === id);
  const icons = payload.computer.desktopIcons
    .map(id => apps.find(a => a.id === id))
    .filter((a): a is NonNullable<typeof a> => !!a);

  const desktopMenu: MenuEntry[] = [
    { label: t('ui.mac.desk_wallpaper'), onSelect: () => openApp('settings', { page: 'personalization' }), disabled: !has('settings') },
    ...(has('cmd') ? ([{ sep: true }, { label: t('ui.mac.desk_terminal'), onSelect: () => openApp('cmd') }] as MenuEntry[]) : []),
  ];

  return (
    <div
      className="mac-desktop absolute inset-0 overflow-hidden"
      style={macAccentVars(settings.accent, settings.theme)}
      onMouseDown={dismiss}
    >
      <Wallpaper id={settings.wallpaper} accent={settings.accent} />

      <div
        ref={areaRef}
        className="absolute left-0 right-0 bottom-0"
        style={{ top: MENU_H }}
        onMouseDown={() => setSelected(null)}
        onContextMenu={e => {
          e.preventDefault();
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          setMenu({ x: Math.min(e.clientX, vw - 240), y: Math.min(e.clientY, vh - 120) });
        }}
      >
        {/* Desktop icons: a column down the right edge, wrapping leftwards. */}
        <div className="absolute inset-x-0 top-2 flex flex-col flex-wrap-reverse content-start items-center pr-2 pointer-events-none" style={{ bottom: DOCK_RESERVE + 4 }}>
          {icons.map(a => (
            <button
              key={a.id}
              type="button"
              className={`mac-desk-icon pointer-events-auto ${selected === a.id ? 'is-selected' : ''}`}
              onMouseDown={e => {
                e.stopPropagation();
                dismiss();
                setSelected(a.id);
              }}
              onDoubleClick={() => openApp(a.id)}
              onKeyDown={e => {
                if (e.key === 'Enter') openApp(a.id);
              }}
            >
              <span className="mac-desk-tile relative">
                <MacIcon app={a.id} size={56} />
                <AppBadge app={a.id} />
              </span>
              <span className="mac-desk-label">{a.label}</span>
            </button>
          ))}
        </div>

        {/* Windows get their own stacking context so their ever-growing z never climbs over the bars. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ isolation: 'isolate', zIndex: 1 }}
          onContextMenu={e => e.stopPropagation()}
        >
          {windows.map(w => {
            const App = appFor(w.app);
            return (
              <MacWindow key={w.id} win={w} active={activeId === w.id}>
                <App win={w} />
              </MacWindow>
            );
          })}
        </div>
      </div>

      <MenuBar />
      <Dock />
      <Notifications />
      {start && <SearchOverlay />}

      {menu && (
        <MenuPanel
          menuRef={menuRef}
          items={desktopMenu}
          onClose={() => setMenu(null)}
          className="absolute min-w-[220px]"
          style={{ left: menu.x, top: menu.y, zIndex: 70 }}
        />
      )}
    </div>
  );
}
