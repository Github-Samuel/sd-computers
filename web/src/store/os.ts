import { create } from 'zustand';
import type { AppId, OpenPayload, Theme } from '@/types';
import { rpc } from '@/nui/rpc';

/**
 * The whole OS in one store: the boot payload, which screen we're on (boot -> lock -> welcome ->
 * desktop -> shutdown), personalisation, the window manager, the shell's flyouts and the toast
 * queue. Windows live here (not in a component hook) so any app can open/focus another app's
 * window - e.g. a new-mail toast opening Mail.
 */

export type Phase = 'off' | 'boot' | 'lock' | 'welcome' | 'desktop' | 'shutdown';
/** What a window can be: an installed app, a hack run (Command Prompt opens those) or one of the games (the Games shelf opens those). */
export type WinApp = AppId | 'hack' | 'mines' | 'solitaire' | 'snake';

export interface Win {
  id: string;
  app: WinApp;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  min: boolean;
  max: boolean;
  z: number;
  /** Pending exit animation: the frame stays mounted while it plays, then finalize() tears down. */
  exit?: 'close' | 'min';
  /** Free-form props for the app component (hack windows carry their run here). */
  props?: Record<string, unknown>;
  resizable: boolean;
}

export interface Toast {
  id: number;
  app: WinApp | 'system';
  title: string;
  body?: string;
  onClick?: () => void;
}

export interface Settings {
  theme: Theme;
  wallpaper: string;
  accent: string;
}

export interface WindowSpec {
  id: string;
  app: WinApp;
  title: string;
  w: number;
  h: number;
  props?: Record<string, unknown>;
  resizable?: boolean;
}

interface OSState {
  payload: OpenPayload | null;
  phase: Phase;
  settings: Settings;
  windows: Win[];
  start: boolean;
  flyout: 'calendar' | 'quick' | null;
  toasts: Toast[];
  recent: { app: AppId; at: number }[];
  /** The counts on custom apps' icons (taskbar, dock, desktop), by desktop id. */
  badges: Record<string, number>;

  bootWith: (p: OpenPayload) => void;
  setPhase: (p: Phase) => void;
  reset: () => void;
  setApps: (lists: Pick<OpenPayload['computer'], 'apps' | 'pinned' | 'desktopIcons' | 'badges'>) => void;
  setBadge: (app: string, count: number) => void;
  updateSettings: (patch: Partial<Settings>, persist?: boolean) => void;

  openApp: (app: AppId, props?: Record<string, unknown>) => void;
  openWindow: (spec: WindowSpec) => void;
  focus: (id: string) => void;
  close: (id: string) => void;
  minimize: (id: string) => void;
  finalize: (id: string) => void;
  restore: (id: string) => void;
  toggleMax: (id: string) => void;
  move: (id: string, x: number, y: number) => void;
  resize: (id: string, x: number, y: number, w: number, h: number) => void;
  closeAll: () => void;
  setProps: (id: string, props: Record<string, unknown>) => void;
  retitle: (id: string, title: string) => void;

  setStart: (open: boolean) => void;
  setFlyout: (f: 'calendar' | 'quick' | null) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
}

/** Taskbar height - the desktop's usable area stops above it. */
export const TASKBAR_H = 48;

let boundsProvider: (() => { w: number; h: number }) | null = null;

/**
 * Let a shell report its own desktop area (retro: the CRT tube; mac: between menu bar and dock).
 * Window placement, clamping and dragging all use it. null = the default below.
 */
export const setBoundsProvider = (fn: (() => { w: number; h: number }) | null): void => {
  boundsProvider = fn;
};

/** The area windows live in: the shell's provider, else viewport minus the modern taskbar. */
export const desktopBounds = (): { w: number; h: number } =>
  boundsProvider ? boundsProvider() : { w: window.innerWidth, h: window.innerHeight - TASKBAR_H };

let zCounter = 10;
let spawnCount = 0;
let toastSeq = 0;

/** Window id -> "may this window close?" check (Notepad's unsaved-changes prompt). */
const closeGuards = new Map<string, () => boolean>();

/**
 * Register (or clear, with null) a close guard for a window. When the user closes the window, the
 * guard runs first; returning false vetoes the close - the app then shows its own prompt and calls
 * close() again once it's resolved. Sign out / shut down tear windows down without asking, like
 * Windows does on a forced logoff.
 */
export const setCloseGuard = (id: string, guard: (() => boolean) | null): void => {
  if (guard) closeGuards.set(id, guard);
  else closeGuards.delete(id);
};

const defaults = (p: OpenPayload | null): Settings => ({
  theme: p?.settings.theme ?? p?.desktop.defaultTheme ?? 'dark',
  wallpaper: p?.settings.wallpaper ?? p?.desktop.defaultWallpaper ?? 'petals-dark',
  accent: p?.settings.accent ?? p?.desktop.accents[0] ?? '#4cc2ff',
});

/** Where a new window lands: cascaded from the top-left third, clamped inside the desktop. */
const place = (w: number, h: number): { x: number; y: number; w: number; h: number } => {
  const b = desktopBounds();
  const n = spawnCount++ % 7;
  const ww = Math.min(w, b.w - 24);
  const hh = Math.min(h, b.h - 24);
  const baseX = Math.round((b.w - ww) / 2) - 120 + n * 30;
  const baseY = Math.round((b.h - hh) / 2) - 60 + n * 30;
  return {
    x: Math.max(8, Math.min(baseX, b.w - ww - 8)),
    y: Math.max(8, Math.min(baseY, b.h - hh - 8)),
    w: ww,
    h: hh,
  };
};

export const useOS = create<OSState>((set, get) => ({
  payload: null,
  phase: 'off',
  settings: defaults(null),
  windows: [],
  start: false,
  flyout: null,
  toasts: [],
  recent: [],
  badges: {},

  bootWith: p => {
    spawnCount = 0;
    closeGuards.clear();
    set({
      payload: p,
      phase: p.desktop.boot ? 'boot' : 'lock',
      settings: defaults(p),
      windows: [],
      start: false,
      flyout: null,
      toasts: [],
      badges: p.computer.badges ?? {},
    });
  },

  setPhase: phase => set({ phase, start: false, flyout: null }),

  reset: () => {
    closeGuards.clear();
    boundsProvider = null;
    set({ payload: null, phase: 'off', windows: [], start: false, flyout: null, toasts: [], badges: {} });
  },

  // The server has reworked which apps this session has (a phone was linked to the machine, or
  // taken off it): the desktop redraws from the new lists, and the windows of apps that are gone
  // close without asking.
  setApps: lists =>
    set(s => {
      if (!s.payload) return s;
      const has = new Set<string>(lists.apps.map(a => a.id));
      // (a hack window is Command Prompt's run and stays; a game is the Games shelf's, and goes with it)
      const owner = (app: WinApp): string => (app === 'mines' || app === 'solitaire' || app === 'snake' ? 'games' : app);
      const gone = s.windows.filter(w => w.app !== 'hack' && !has.has(owner(w.app)));
      for (const w of gone) closeGuards.delete(w.id);
      return {
        payload: { ...s.payload, computer: { ...s.payload.computer, apps: lists.apps, pinned: lists.pinned, desktopIcons: lists.desktopIcons } },
        windows: gone.length > 0 ? s.windows.filter(w => !gone.includes(w)) : s.windows,
        recent: s.recent.filter(r => has.has(r.app)),
        badges: lists.badges ?? s.badges,
      };
    }),

  setBadge: (app, count) =>
    set(s => {
      const badges = { ...s.badges };
      if (count > 0) badges[app] = count;
      else delete badges[app];
      return { badges };
    }),

  updateSettings: (patch, persist = true) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    if (persist) void rpc('profile:save', { settings: patch });
  },

  openApp: (app, props) => {
    const p = get().payload;
    const def = p?.computer.apps.find(a => a.id === app);
    if (!def) return;
    const existing = get().windows.find(w => w.id === app);
    set(s => ({ start: false, recent: [{ app, at: Date.now() }, ...s.recent.filter(r => r.app !== app)].slice(0, 6) }));
    if (existing) {
      set(s => ({
        windows: s.windows.map(w => (w.id === app ? { ...w, min: false, exit: undefined, z: ++zCounter, props: props ?? w.props } : w)),
      }));
      return;
    }
    const rect = place(def.w, def.h);
    set(s => ({
      windows: [...s.windows, { id: app, app, title: def.label, ...rect, min: false, max: false, z: ++zCounter, props, resizable: def.resizable !== false }],
    }));
    void rpc('shell:launch', { app });
  },

  openWindow: spec => {
    const existing = get().windows.find(w => w.id === spec.id);
    if (existing) {
      get().restore(spec.id);
      return;
    }
    const rect = place(spec.w, spec.h);
    set(s => ({
      start: false,
      windows: [
        ...s.windows,
        { id: spec.id, app: spec.app, title: spec.title, ...rect, min: false, max: false, z: ++zCounter, props: spec.props, resizable: spec.resizable ?? true },
      ],
    }));
  },

  focus: id => {
    const top = get().windows.reduce((m, w) => Math.max(m, w.z), 0);
    const win = get().windows.find(w => w.id === id);
    if (!win || (win.z === top && !win.min)) return;
    set(s => ({ windows: s.windows.map(w => (w.id === id ? { ...w, z: ++zCounter } : w)) }));
  },

  close: id => {
    const guard = closeGuards.get(id);
    if (guard && !guard()) return;
    set(s => ({ windows: s.windows.map(w => (w.id === id ? { ...w, exit: 'close' } : w)) }));
  },

  minimize: id => set(s => ({ windows: s.windows.map(w => (w.id === id ? { ...w, exit: 'min' } : w)) })),

  finalize: id =>
    set(s => {
      const w = s.windows.find(x => x.id === id);
      if (!w || !w.exit) return s;
      if (w.exit === 'close') {
        closeGuards.delete(id);
        return { windows: s.windows.filter(x => x.id !== id) };
      }
      return { windows: s.windows.map(x => (x.id === id ? { ...x, min: true, exit: undefined } : x)) };
    }),

  restore: id =>
    set(s => ({ windows: s.windows.map(w => (w.id === id ? { ...w, min: false, exit: undefined, z: ++zCounter } : w)) })),

  toggleMax: id =>
    set(s => ({ windows: s.windows.map(w => (w.id === id ? { ...w, max: !w.max, min: false, z: ++zCounter } : w)) })),

  move: (id, x, y) => set(s => ({ windows: s.windows.map(w => (w.id === id ? { ...w, x, y } : w)) })),

  resize: (id, x, y, w, h) => set(s => ({ windows: s.windows.map(win => (win.id === id ? { ...win, x, y, w, h } : win)) })),

  closeAll: () => {
    closeGuards.clear();
    set({ windows: [] });
  },

  setProps: (id, props) => set(s => ({ windows: s.windows.map(w => (w.id === id ? { ...w, props: { ...w.props, ...props } } : w)) })),

  retitle: (id, title) => set(s => ({ windows: s.windows.map(w => (w.id === id && w.title !== title ? { ...w, title } : w)) })),

  setStart: open => set({ start: open, flyout: null }),

  setFlyout: f => set({ flyout: f, start: false }),

  toast: t => {
    const id = ++toastSeq;
    set(s => ({ toasts: [...s.toasts, { ...t, id }].slice(-4) }));
    window.setTimeout(() => get().dismissToast(id), 6500);
  },

  dismissToast: id => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));

/**
 * Ask every window whether the computer may be left, the way closing the window would ask it. The
 * first one that says no (it has unsaved changes, and is now showing its own prompt about them) is
 * brought forward and its id returned. null = nothing is in the way.
 */
export const leaveBlockedBy = (): string | null => {
  const os = useOS.getState();
  for (const w of os.windows) {
    const guard = closeGuards.get(w.id);
    if (guard && !guard()) {
      os.restore(w.id);
      return w.id;
    }
  }
  return null;
};

/** The id of the focused window: the visible one with the highest z (null = desktop focused). */
export const selectActiveId = (s: { windows: Win[] }): string | null => {
  let best: Win | null = null;
  for (const w of s.windows) {
    if (w.min || w.exit) continue;
    if (!best || w.z > best.z) best = w;
  }
  return best ? best.id : null;
};
