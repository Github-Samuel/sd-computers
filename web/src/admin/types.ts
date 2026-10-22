export const TABS = ['overview', 'computers', 'cameras', 'printers', 'automatic', 'props', 'styles'] as const;
export type Tab = (typeof TABS)[number];

// Where a computer comes from: placed from this panel (kept in the database, everything about it
// can be changed here), picked from this panel ('world': the same, but its prop is one the game
// already had there), a fixed location in configs/shared/computers.lua, a model computer from
// that file (every prop of those models in the world - it has no one place), or one another
// resource added with the AddComputer export ('script': that resource's to change, not the panel's).
export type Source = 'placed' | 'world' | 'config' | 'model' | 'script';

// A computer as the server describes it (server/admin/panel.lua > snapshot).
export interface Computer {
  key: string; // its id everywhere: logs, sessions ('placed_3', 'mrpd_frontdesk')
  order: number;
  id?: number; // placed: its row id
  source: Source;
  label: string;
  hostname: string;
  style: string; // the style it opens in
  styleSet: boolean; // false = it follows the default style
  prop?: string; // placed / picked / script: the model it is (a script's may have none: a target box)
  resource?: string; // script: the resource that added it
  models?: string[]; // model computers: the models that are it
  off?: boolean; // model computers: no prop is it right now (switched off in the Automatic tab)
  removed?: boolean; // config locations: taken away in this panel (still in the file; it can be put back)
  x?: number;
  y?: number;
  z?: number;
  heading?: number;
  groups?: Record<string, number> | null; // job lock: name -> minimum grade
  boss?: string | null; // Business Manager: a job name, or '*' = the signed-in player's own job
  pin: boolean; // has a PIN (configs/server/security.lua); the PIN itself never leaves the server
  users: string[]; // who is sitting at it right now
}

// A security camera as the server describes it (server/computers/cameras.lua > snapshot): one put up
// from this panel (kept in the database, everything about it can be changed here), or one from
// configs/shared/cameras.lua (which can only be taken away here, and put back).
export interface Camera {
  key: string; // its id everywhere: what the app asks for, what the System Logs name
  id?: number; // placed: its row id
  source: 'placed' | 'config';
  label: string;
  area?: string | null; // the heading the app lists it under
  x: number;
  y: number;
  z: number;
  pitch: number; // the way it looks, degrees: up and down
  yaw: number; // and round (the game's heading: -180 to 180)
  fov: number; // how wide it sees, degrees
  groups?: Record<string, number> | null; // who may watch it: job or gang name -> minimum grade (none = anyone)
  computers?: string[] | null; // config only: the computer ids it can be watched from (none = any)
  removed?: boolean; // config: taken away in this panel (still in the file; it can be put back)
}

// The Cameras tab: every camera, and whether players get the Security Cameras app at all.
export interface Cameras {
  enabled: boolean; // Enabled in configs/shared/cameras.lua
  max: number; // most that can be put up from the panel
  list: Camera[];
}

// A printer as the server describes it (server/computers/printers.lua > snapshot): a prop stood
// from this panel, or one the game already had there, picked from it.
export interface Printer {
  id: number; // its row id: what a print names, and what the tray is kept under
  label: string;
  prop: string; // the model it is
  world?: boolean; // picked: a prop the game has there already (it cannot be moved or swapped)
  x: number;
  y: number;
  z: number;
  heading: number;
  waiting: number; // copies in its tray right now
}

// A prop a printer can be placed as (configs/shared/printers.lua > Props).
export interface PrinterProp {
  model: string;
  label: string;
  image?: string; // a picture of its own (a URL); otherwise props/<model>.jpg, and an icon when there is none
}

// The Printers tab: every printer, and what the config says about printing.
export interface Printers {
  enabled: boolean; // Enabled in configs/shared/printers.lua
  max: number; // most that can be made from the panel
  range: number; // metres from a computer a printer can stand and still be printed to from it
  item: string; // the inventory item a printout is
  itemMissing?: boolean; // the inventory has no such item yet: nobody can be handed a page
  props: PrinterProp[];
  list: Printer[];
}

// A prop a computer can be placed as (configs/shared/admin.lua > Props).
export interface Prop {
  model: string;
  label: string;
  kind?: 'monitor' | 'tower' | 'laptop';
  image?: string; // a picture of its own (a URL); otherwise props/<model>.jpg, and its icon when there is none
  custom?: boolean; // added from the panel (kept in the database), not from the config
}

// An OS look (configs/shared/desktop.lua > Styles).
export interface OsStyle {
  key: string;
  name: string;
  build: string;
  wallpaper?: string;
  accent?: string;
  theme: 'dark' | 'light';
  wallpapers: string[];
  default: boolean;
}

// A job the framework has, for the Business Manager picker (server/computers/employees.lua > jobs).
export interface Job {
  name: string; // as the framework spells it ('police')
  label: string;
  boss: boolean; // one of its grades is a boss: without one nobody would ever get the app
}

// One prop of a model computer (server/computers/auto.lua).
export interface AutoModel {
  model: string;
  on: boolean; // every prop of this model in the world is this computer
  own: boolean; // configs/shared/computers.lua lists it for this computer (the rest are spare props it can take on)
  taken?: string | null; // spare: the other model computer that has it
  style?: string | null; // a style of its own (otherwise it opens in its computer's)
}

// A model computer from configs/shared/computers.lua, as the Automatic tab has it.
export interface AutoComputer {
  key: string;
  label: string;
  enabled: boolean;
  style?: string | null; // the style the panel gave it (otherwise the config's, else the default)
  base?: string | null; // the style configs/shared/computers.lua gives it
  models: AutoModel[];
}

export interface Auto {
  enabled: boolean; // whether any prop in the world is a computer without being placed or picked
  computers: AutoComputer[];
}

export interface Snapshot {
  canEdit: boolean;
  computers: Computer[];
  cameras: Cameras;
  printers: Printers;
  props: Prop[];
  auto: Auto;
  // Which props have a screen, by model: 'config' = configs/shared/screens.lua has one for it,
  // 'custom' = an admin drew it with the screen tool (that wins). A prop that is not here has none:
  // it is still a computer, opening fullscreen.
  screens: Record<string, 'config' | 'custom'>;
  styles: OsStyle[];
  jobs: Job[]; // by label; empty where the Business Manager is not supported
  // Whether a computer can be given the Business Manager at all: not on a framework it does not
  // support, nor while configs/shared/boss.lua has it switched off.
  boss: { available: boolean; reason?: 'framework' | 'disabled' | null };
  defaultStyle: string;
  rules: { boot: boolean; reach: number; maxLabel: number };
  refreshMs: number;
}

// What came of a tool that ran with the panel hidden: the gizmo, the picker, the screen tool or the camera tool.
export interface Placed {
  what: 'computer' | 'screen' | 'camera' | 'printer';
  action: 'placed' | 'moved' | 'picked' | 'saved';
  success: boolean;
  cancelled?: boolean;
  message?: string | null;
}

export interface Reply<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
}
