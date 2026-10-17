import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronUp, Search, Wifi, Volume2, BatteryFull } from 'lucide-react';
import { useOS, selectActiveId, TASKBAR_H, type Win, type WinApp } from '@/store/os';
import type { AppId } from '@/types';
import { fmtShortDate, fmtTime, useNow } from '@/lib/format';
import { t } from '@/i18n';
import { useExitFx } from '@/hooks/useExitFx';
import { AppIcon, OsLogo } from './icons';
import AppBadge from './AppBadge';

interface Item {
  key: string;
  app: WinApp;
  label: string;
  win?: Win;
  pinned: boolean;
}

/**
 * Centered taskbar: Start, Search, pinned + running apps (indicator pill: short grey
 * when running, long accent when focused), then the tray (quick settings, clock) and the
 * show-desktop sliver on the far right. Buttons of unpinned apps open the row up as they arrive and
 * close it behind them when their window goes.
 */
export default function Taskbar() {
  const payload = useOS(s => s.payload)!;
  const windows = useOS(s => s.windows);
  const activeId = useOS(selectActiveId);
  const start = useOS(s => s.start);
  const flyout = useOS(s => s.flyout);
  const { setStart, setFlyout, openApp, focus, restore, minimize } = useOS.getState();
  const now = useNow(5000);
  // Buttons that mount after the taskbar itself are the ones that animate in.
  const settled = useRef(false);
  useEffect(() => {
    settled.current = true;
  }, []);

  const labelOf = (app: AppId) => payload.computer.apps.find(a => a.id === app)?.label ?? app;
  const items: Item[] = payload.computer.pinned.map(app => ({ key: app, app, label: labelOf(app), win: windows.find(w => w.id === app), pinned: true }));
  for (const w of windows) {
    if (!items.some(i => i.key === w.id)) items.push({ key: w.id, app: w.app, label: w.title, win: w, pinned: false });
  }

  const click = (it: Item) => {
    setStart(false);
    if (!it.win) {
      openApp(it.app as AppId);
      return;
    }
    if (it.win.min) restore(it.win.id);
    else if (activeId === it.win.id) minimize(it.win.id);
    else focus(it.win.id);
  };

  const showDesktop = () => {
    for (const w of useOS.getState().windows) if (!w.min && !w.exit) minimize(w.id);
  };

  return (
    <div
      className="task-rise absolute left-0 right-0 bottom-0 acrylic-bar border-t border-stroke flex items-center"
      style={{ height: TASKBAR_H, zIndex: 9000 }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="flex-1" />
      <div className="flex items-center gap-1">
        <TaskButton active={start} label={t('ui.taskbar.start')} onClick={() => setStart(!start)}>
          <OsLogo size={24} />
        </TaskButton>
        <TaskButton label={t('ui.taskbar.search')} onClick={() => setStart(true)}>
          <Search size={20} className="text-t1" />
        </TaskButton>
        {items.map(it => {
          const running = !!it.win;
          const isActive = running && activeId === it.win!.id;
          return (
            <TaskButton key={it.key} label={it.label} onClick={() => click(it)} active={isActive} fresh={settled.current}>
              <AppIcon app={it.app} size={24} />
              <AppBadge app={it.app} />
              <span
                className="absolute bottom-[3px] left-1/2 -translate-x-1/2 h-[3px] rounded-full transition-all duration-200"
                style={{ width: running ? (isActive ? 16 : 6) : 0, opacity: running ? 1 : 0, background: isActive ? 'var(--accent-fill)' : 'var(--text-3)' }}
              />
            </TaskButton>
          );
        })}
      </div>
      <div className="flex-1 flex items-center justify-end h-full pr-0">
        <button type="button" className="w-8 h-10 flex items-center justify-center rounded-ctl hover:bg-subtle text-t1"><ChevronUp size={16} /></button>
        <button
          type="button"
          onClick={() => setFlyout(flyout === 'quick' ? null : 'quick')}
          className={`h-10 px-2.5 flex items-center gap-2.5 rounded-ctl hover:bg-subtle text-t1 ${flyout === 'quick' ? 'bg-subtle' : ''}`}
        >
          <Wifi size={16} />
          <Volume2 size={16} />
          <BatteryFull size={16} />
        </button>
        <button
          type="button"
          onClick={() => setFlyout(flyout === 'calendar' ? null : 'calendar')}
          className={`h-10 px-2.5 ml-0.5 flex flex-col items-end justify-center rounded-ctl hover:bg-subtle text-t1 text-caption leading-[16px] ${flyout === 'calendar' ? 'bg-subtle' : ''}`}
        >
          <span>{fmtTime(now, payload.desktop.clock24)}</span>
          <span>{fmtShortDate(now)}</span>
        </button>
        <button type="button" title={t('ui.taskbar.show_desktop')} onClick={showDesktop} className="w-3 h-full ml-1.5 border-l border-stroke hover:bg-subtle" />
      </div>
    </div>
  );
}

function TaskButton({ children, label, onClick, active, fresh }: { children: ReactNode; label: string; onClick: () => void; active?: boolean; fresh?: boolean }) {
  const [enter] = useState(fresh);
  const ref = useExitFx<HTMLButtonElement>('task-out');
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      onClick={onClick}
      className={`relative w-10 h-10 flex items-center justify-center rounded-ctl hover:bg-subtle active:scale-90 ${active ? 'bg-subtle' : ''} ${enter ? 'task-in' : ''}`}
    >
      {children}
    </button>
  );
}
