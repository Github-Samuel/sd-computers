// Contracts with the Lua side. Every shape here mirrors a table built in server/computers/*.lua -
// change one, change both.

/**
 * 'messages', 'notes' and 'contacts' are the phone apps: only installed while sd-phone is
 * linked (server/computers/phone.lua) and, where it asks for the code, once the character has linked
 * their phone to the machine in 'phonelink' - the app that is there whenever sd-phone is. 'boss',
 * 'board' and 'cameras' are installed per player: for a boss, for someone with a job, and for
 * someone allowed to watch at least one camera. 'photos' is on every computer that has not opted out.
 */
export type AppId =
  | 'mail'
  | 'logs'
  | 'cmd'
  | 'boss'
  | 'notepad'
  | 'calculator'
  | 'settings'
  | 'messages'
  | 'notes'
  | 'files'
  | 'cameras'
  | 'board'
  | 'bank'
  | 'photos'
  | 'contacts'
  | 'phonelink'
  | 'browser'
  | 'games'
  | ExtAppId;

/**
 * A custom app another resource registered (exports['sd-computers']:AddCustomApp, server/computers/apps.lua):
 * its id on the desktop is 'ext:' + the id it was registered under. Its window is src/apps/ext.
 */
export type ExtAppId = `ext:${string}`;

/** Whether a desktop id is a custom app's. */
export const isExt = (app: string): app is ExtAppId => app.startsWith('ext:');

/** What the desktop knows about a custom app (server/computers/apps.lua apps.entry). */
export interface ExtAppDef {
  /** the id it was registered under (without 'ext:') */
  id: string;
  /** the resource that registered it */
  resource: string;
  /** the page: https://cfx-nui-<resource>/..., or an http(s) address */
  ui?: string | null;
  icon?: string | null;
  /** '#rrggbb', for the tile behind a missing icon and the mac look's squircle */
  color?: string | null;
  description?: string | null;
  developer?: string | null;
  version?: string | null;
  /** false = players watching this computer's screen see the app's icon and name, not its page */
  mirror?: boolean;
}

export interface AppDef {
  id: AppId;
  label: string;
  w: number;
  h: number;
  /** false = the window keeps its size (custom apps can ask for that) */
  resizable?: boolean;
  /** only on a custom app */
  ext?: ExtAppDef;
}

export interface WallpaperDef {
  id: string;
  label: string;
}

export type Theme = 'dark' | 'light';

/** The computer's look (configs/shared/desktop.lua Styles): same apps, different shell. */
export type OsStyle = 'modern' | 'retro' | 'mac';

export interface UserSettings {
  theme?: Theme;
  wallpaper?: string;
  accent?: string;
}

export interface GameMeta {
  program: string;
  label: string;
}

/** session.open's payload (server/computers/session.lua). */
export interface OpenPayload {
  /**
   * Added by client Lua when the camera is up at the prop (client/computers/view.lua): the part of
   * the display the prop's screen covers, as fractions of it. The page holding the OS reads it
   * (src/host); the OS itself just fills whatever window it is given.
   */
  view?: { x: number; y: number; w: number; h: number };
  computer: {
    id: string;
    label: string;
    hostname: string;
    ip: string;
    instance: string;
    style: OsStyle;
    requiresPin: boolean;
    lockedFor: number;
    apps: AppDef[];
    pinned: AppId[];
    desktopIcons: AppId[];
    /** the counts on custom apps' icons, by desktop id (kept per player on the server) */
    badges?: Record<string, number>;
  };
  user: { name: string; initials: string; job: string };
  desktop: {
    style: OsStyle;
    osName: string;
    osBuild: string;
    boot: boolean;
    clock24: boolean;
    wallpapers: WallpaperDef[];
    accents: string[];
    defaultWallpaper: string;
    defaultTheme: Theme;
    /** retro: draw the desktop inside the CRT monitor chassis */
    monitor: boolean;
    /** the style's synthesized sounds (os/sfx.ts for modern and mac, os/retro/sounds.ts) */
    sounds: boolean;
    /** whether anything prints (configs/shared/printers.lua > Enabled): the apps offer Print only then */
    printing?: boolean;
  };
  settings: UserSettings;
  hacks: {
    practice: boolean;
    defaultDifficulty: Difficulty;
    games: Record<string, GameMeta>;
  };
  mail: {
    domain: string;
    maxRecipients: number;
    maxSubject: number;
    maxBody: number;
    minPassword: number;
    maxDisplayName: number;
    /** true = Mail runs on sd-phone's mail (its accounts, Spam folder, string ids, phone pushes) */
    phone?: boolean;
  };
}

/** Every rpc reply: { ok, data?, error? } (server/computers/rpc.lua). */
export interface RpcResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

/** A started hack run (hacks.lua begin()). */
export interface HackRun {
  token: number;
  game: string;
  difficulty: Difficulty;
  program: string;
  label: string;
  params: Record<string, number>;
  steps: number;
  minSeconds: number;
  challenge?: unknown;
  /** breach runs: which step of how many */
  step?: number;
  total?: number;
  /** library runs: optional window title from the calling resource */
  title?: string;
}
