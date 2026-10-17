// What a custom app's page and its window say to each other. The page runs the SDK
// (public/sdk/sdcomputers.js - its types are public/sdk/sdcomputers.d.ts, the same shapes as here
// seen from the page's side); the window is src/apps/ext/index.tsx. They talk with postMessage
// only, so it works whichever origin the page is served from, and every message carries
// `sdc: 1` so neither side mistakes one of the page's own for one of these.

/** Bumped whenever the API the page sees changes (computer.version). */
export const SDK_VERSION = 1;

/** Every call the page can make (computer.supports(name) answers from this list). */
export const METHODS = [
  'callServer',
  'notify',
  'setBadge',
  'dialog.alert',
  'dialog.confirm',
  'dialog.prompt',
  'menu',
  'pickPhoto',
  'pickColor',
  'print',
  'openApp',
  'storage.get',
  'storage.set',
  'storage.keys',
  'storage.clear',
  'sound',
  'log',
  'settings',
  'window.setTitle',
  'window.close',
  'window.minimize',
  'window.maximize',
  'window.restore',
  'window.focus',
  'window.preventClose',
  'window.state',
] as const;

export type Method = (typeof METHODS)[number];

/**
 * The page -> the window. `doc` is a random id the SDK picks as it starts, once per document: a
 * page that reloads or navigates in its frame says hello again with a new one, and a reply carries
 * the `doc` of the call it answers, so a late answer never settles a call of the next document.
 */
export type FromPage =
  | { sdc: 1; type: 'hello'; doc: string }
  | { sdc: 1; type: 'call'; doc: string; id: number; method: string; args: unknown[] }
  | { sdc: 1; type: 'typing'; on: boolean }
  | { sdc: 1; type: 'key'; key: string; ctrl: boolean; alt: boolean; shift: boolean };

/** The window -> the page. */
export type ToPage =
  | { sdc: 1; type: 'init'; data: InitData }
  | { sdc: 1; type: 'reply'; doc: string; id: number; ok: boolean; value?: unknown; error?: string }
  | { sdc: 1; type: 'event'; name: PageEvent; data?: unknown };

export type PageEvent = 'message' | 'settings' | 'launch' | 'window' | 'notification';

/** The look the page is shown in, for an app that wants to match it. */
export interface PageSettings {
  theme: 'dark' | 'light';
  style: 'modern' | 'retro' | 'mac';
  accent: string;
  clock24: boolean;
  /** the OS's own colours and type, as CSS values (also set as --sdc-* on the page's root) */
  colors: Record<string, string>;
  font: string;
}

export interface WindowState {
  focused: boolean;
  minimized: boolean;
  maximized: boolean;
  width: number;
  height: number;
  title: string;
}

/** Everything the page is told as the SDK starts. */
export interface InitData {
  version: number;
  methods: readonly string[];
  /** methods this computer cannot do right now (no Photos here, printing switched off) */
  unavailable: string[];
  app: { id: string; label: string; resource: string; version: string | null; developer: string | null };
  machine: { id: string; label: string; hostname: string; ip: string; style: string; os: string; build: string };
  user: { name: string; initials: string; job: string };
  settings: PageSettings;
  launch: unknown;
  window: WindowState;
}

export const isFromPage = (d: unknown): d is FromPage =>
  !!d && typeof d === 'object' && (d as { sdc?: unknown }).sdc === 1 && typeof (d as { type?: unknown }).type === 'string';
