import { useOS } from '@/store/os';
import { emit } from '@/lib/bus';
import { useNuiEvent } from '@/hooks/useNuiEvent';
import { isExt, type AppDef, type AppId, type ExtAppId } from '@/types';

// What the server sends about custom apps, as client/computers/apps.lua relays it (the messages
// for one app's page are heard by that app's window itself, src/apps/ext/index.tsx):
//   computers:app:apps    { apps, pinned, desktopIcons, badges }  an app came, went or changed
//   computers:app:badge   { app, count }                         the count on its icon
//   computers:app:open    { app, props? }                        open its window (OpenApp)
//   computers:app:close   { app }                                close it (CloseApp)
//   computers:app:notify  { app, title, body?, data? }           a notification (NotifyApp)

/** Notifications clicked while their app's window was not open: handed to the page once it is. */
const clicked = new Map<string, unknown[]>();

/** The notifications clicked for an app before its page was there to hear them (taken, not copied). */
export function takeClicks(app: string): unknown[] {
  const list = clicked.get(app) ?? [];
  clicked.delete(app);
  return list;
}

/**
 * A notification on the desktop from a custom app. Clicking it brings the app up and hands `data`
 * to the page (computer.onNotificationClick): straight away when its window is open, else as soon
 * as the page has started.
 */
export function notifyFrom(app: ExtAppId, title: string, body?: string, data?: unknown): void {
  const os = useOS.getState();
  if (os.phase !== 'desktop') return;
  os.toast({
    app,
    title,
    body,
    onClick: () => {
      const open = useOS.getState().windows.some(w => w.id === app && !w.exit);
      if (open) emit(`ext:click:${app}`, data);
      else clicked.set(app, [...(clicked.get(app) ?? []), data]);
      useOS.getState().openApp(app);
    },
  });
}

/** The desktop's lists, as client Lua relays them (the badges ride along). */
interface Lists {
  apps: AppDef[];
  pinned: AppId[];
  desktopIcons: AppId[];
  badges?: Record<string, number>;
}

/** Hear the server about custom apps. Mounted once, by the OS page (App.tsx). */
export function useExtEvents(): void {
  useNuiEvent<Lists>('computers:app:apps', d => {
    if (d && Array.isArray(d.apps)) useOS.getState().setApps(d);
  });

  useNuiEvent<{ app: string; count: number }>('computers:app:badge', d => {
    if (d && typeof d.app === 'string') useOS.getState().setBadge(d.app, Number(d.count) || 0);
  });

  useNuiEvent<{ app: string; props?: Record<string, unknown> | null }>('computers:app:open', d => {
    const os = useOS.getState();
    if (!d || !isExt(d.app) || os.phase !== 'desktop') return;
    os.openApp(d.app, d.props && typeof d.props === 'object' ? { launch: d.props } : undefined);
  });

  useNuiEvent<{ app: string }>('computers:app:close', d => {
    if (d && isExt(d.app)) useOS.getState().close(d.app);
  });

  useNuiEvent<{ app: string; title: string; body?: string; data?: unknown }>('computers:app:notify', d => {
    if (d && isExt(d.app) && typeof d.title === 'string') notifyFrom(d.app, d.title, d.body, d.data);
  });
}
