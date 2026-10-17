import { useEffect, useState, type ReactNode } from 'react';
import { Paintbrush, RefreshCw, SquareTerminal, Monitor } from 'lucide-react';
import { useOS, selectActiveId } from '@/store/os';
import type { AppId } from '@/types';
import { t } from '@/i18n';
import { appFor } from '@/apps/registry';
import { useExitFx } from '@/hooks/useExitFx';
import { Wallpaper } from './Wallpaper';
import { AppIcon } from './icons';
import WindowFrame from './WindowFrame';
import Taskbar from './Taskbar';
import StartMenu from './StartMenu';
import { CalendarFlyout, QuickSettings, Toasts } from './Flyouts';
import AppBadge from './AppBadge';

/**
 * The signed-in desktop: wallpaper, the icon grid (column-major from the top-left, double-click to
 * open), every window, the taskbar and its popups (Start, calendar, quick settings), toasts and the
 * right-click context menu. Clicking empty desktop dismisses whatever popup is open.
 */
export default function Desktop() {
  const payload = useOS(s => s.payload)!;
  const settings = useOS(s => s.settings);
  const windows = useOS(s => s.windows);
  const activeId = useOS(selectActiveId);
  const start = useOS(s => s.start);
  const flyout = useOS(s => s.flyout);
  const { openApp, setStart, setFlyout } = useOS.getState();
  const [selected, setSelected] = useState<AppId | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [iconGen, setIconGen] = useState(0);
  const menuRef = useExitFx('pop-out');
  const wallRef = useExitFx('wall-out', 560);

  // Keep every window's title bar reachable if the viewport shrinks (resolution change, windowed game).
  useEffect(() => {
    const clamp = () => {
      const { windows: ws, resize } = useOS.getState();
      const bw = window.innerWidth;
      const bh = window.innerHeight - 48;
      for (const w of ws) {
        const nw = Math.min(w.w, bw - 16);
        const nh = Math.min(w.h, bh - 16);
        const nx = Math.max(8 - nw + 120, Math.min(w.x, bw - 120));
        const ny = Math.max(0, Math.min(w.y, bh - 32));
        if (nx !== w.x || ny !== w.y || nw !== w.w || nh !== w.h) resize(w.id, nx, ny, nw, nh);
      }
    };
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, []);

  const dismiss = () => {
    setMenu(null);
    if (start) setStart(false);
    if (flyout) setFlyout(null);
  };

  const icons = payload.computer.desktopIcons
    .map(id => payload.computer.apps.find(a => a.id === id))
    .filter((a): a is NonNullable<typeof a> => !!a);
  const has = (id: AppId) => payload.computer.apps.some(a => a.id === id);

  return (
    <div className="absolute inset-0 overflow-hidden" onMouseDown={dismiss}>
      <div className="desk-wall absolute inset-0">
        {/* Re-keyed per look: the old wallpaper's ghost fades away over the new one. */}
        <div key={`${settings.wallpaper}|${settings.accent}`} ref={wallRef} className="absolute inset-0">
          <Wallpaper id={settings.wallpaper} accent={settings.accent} />
        </div>
      </div>

      <div
        className="absolute inset-0 bottom-12"
        onMouseDown={() => setSelected(null)}
        onContextMenu={e => {
          e.preventDefault();
          setMenu({ x: Math.min(e.clientX, window.innerWidth - 260), y: Math.min(e.clientY, window.innerHeight - 220) });
        }}
      >
        {/* Re-keyed after a Refresh, so the icons deal themselves back in. */}
        <div key={iconGen} className={`stagger absolute left-1 top-1 bottom-1 flex flex-col flex-wrap content-start transition-opacity duration-150 ${refreshing ? 'opacity-0' : 'opacity-100'}`}>
          {icons.map(a => (
            <button
              key={a.id}
              type="button"
              onMouseDown={e => {
                e.stopPropagation();
                dismiss();
                setSelected(a.id);
              }}
              onDoubleClick={() => openApp(a.id)}
              onKeyDown={e => {
                if (e.key === 'Enter') openApp(a.id);
              }}
              className={`w-[78px] h-[92px] m-0.5 flex flex-col items-center justify-start gap-1 pt-2 rounded-[4px] border ${
                selected === a.id ? 'bg-white/20 border-white/30' : 'border-transparent hover:bg-white/10'
              }`}
            >
              <span className="relative">
                <AppIcon app={a.id} size={42} />
                <AppBadge app={a.id} className="!-top-1 !-right-1.5" />
              </span>
              <span className="text-[12px] leading-[15px] text-white text-center px-0.5 line-clamp-2" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.8)' }}>
                {a.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {windows.map(w => {
        const App = appFor(w.app);
        return (
          <WindowFrame key={w.id} win={w} active={activeId === w.id}>
            <App win={w} />
          </WindowFrame>
        );
      })}

      <Taskbar />
      {start && <StartMenu />}
      {flyout === 'calendar' && <CalendarFlyout />}
      {flyout === 'quick' && <QuickSettings />}
      <Toasts />

      {menu && (
        <div
          key={`${menu.x},${menu.y}`}
          ref={menuRef}
          className="absolute w-60 acrylic rounded-win shadow-flyout py-1 pop-in origin-top-left"
          style={{ left: menu.x, top: menu.y, zIndex: 9300 }}
          onMouseDown={e => e.stopPropagation()}
        >
          <MenuItem
            icon={<RefreshCw size={16} />}
            label={t('ui.desktop.refresh')}
            onClick={() => {
              setMenu(null);
              setRefreshing(true);
              window.setTimeout(() => {
                setRefreshing(false);
                setIconGen(g => g + 1);
              }, 180);
            }}
          />
          {has('settings') && (
            <>
              <div className="h-px bg-stroke my-1 mx-2" />
              <MenuItem icon={<Monitor size={16} />} label={t('ui.desktop.display')} onClick={() => { setMenu(null); openApp('settings', { page: 'system' }); }} />
              <MenuItem icon={<Paintbrush size={16} />} label={t('ui.desktop.personalize')} onClick={() => { setMenu(null); openApp('settings', { page: 'personalization' }); }} />
            </>
          )}
          {has('cmd') && (
            <>
              <div className="h-px bg-stroke my-1 mx-2" />
              <MenuItem icon={<SquareTerminal size={16} />} label={t('ui.desktop.terminal')} onClick={() => { setMenu(null); openApp('cmd'); }} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-[calc(100%-8px)] mx-1 flex items-center gap-3 h-8 px-3 rounded-ctl text-body text-t1 hover:bg-subtle">
      <span className="text-t1">{icon}</span>
      {label}
    </button>
  );
}
