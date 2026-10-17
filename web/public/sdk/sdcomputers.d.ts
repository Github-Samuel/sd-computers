/**
 * Types for the sd-computers custom app SDK (sdcomputers.js), for a page that runs in an app
 * window on SD OS. Copy this file next to your page's source for completion and type checking.
 *
 * The desktop puts the SDK into the page after it has loaded, so `computer` does not exist while
 * the page's own scripts are first running. Wait for it:
 *
 *     function whenComputer() {
 *       return new Promise(resolve => {
 *         if (window.computer && window.computer.isReady) return resolve(window.computer);
 *         window.addEventListener('computer:ready', e => resolve(e.detail), { once: true });
 *       });
 *     }
 *     whenComputer().then(start);
 *
 * Or load it yourself first with
 * `<script src="https://cfx-nui-sd-computers/web/build/sdk/sdcomputers.js"></script>` and use
 * `computer.ready().then(start)`.
 */

export {};

declare global {
  interface ComputerColors {
    background?: string;
    surface?: string;
    card?: string;
    text?: string;
    'text-secondary'?: string;
    'text-tertiary'?: string;
    border?: string;
    'border-strong'?: string;
    accent?: string;
    'accent-fill'?: string;
    'accent-text'?: string;
    'on-accent'?: string;
    success?: string;
    caution?: string;
    critical?: string;
  }

  /** The look the page is shown in. Also on the page's root: --sdc-<colour>, --sdc-font, data-theme, data-style. */
  interface ComputerSettings {
    theme: 'dark' | 'light';
    style: 'modern' | 'retro' | 'mac';
    accent: string;
    clock24: boolean;
    colors: ComputerColors;
    font: string;
  }

  interface ComputerWindowState {
    focused: boolean;
    minimized: boolean;
    maximized: boolean;
    width: number;
    height: number;
    title: string;
  }

  interface ComputerDialogOptions {
    title?: string;
    message?: string;
    okLabel?: string;
  }

  interface ComputerConfirmOptions extends ComputerDialogOptions {
    confirmLabel?: string;
    cancelLabel?: string;
    /** the confirming button is a destructive one */
    danger?: boolean;
  }

  interface ComputerPromptOptions extends ComputerConfirmOptions {
    placeholder?: string;
    value?: string;
    /** masked here and on the prop's screen other players see */
    password?: boolean;
    maxLength?: number;
  }

  interface ComputerMenuItem {
    id?: string;
    label?: string;
    danger?: boolean;
    disabled?: boolean;
    separator?: boolean;
    /** run when this item is picked (the promise also resolves with its id) */
    onClick?: () => void;
  }

  interface ComputerPrintJob {
    /** what the print dialog calls it */
    title?: string;
    /** handed to your server's `print(src, data, ctx)`, which builds the page */
    data?: unknown;
    /** without a `print` on your server: a plain typed page of this text */
    text?: string;
  }

  interface ComputerStorageOptions {
    /** 'character' (default): follows the character to every computer. 'computer': this machine, for everyone who uses it. */
    scope?: 'character' | 'computer';
  }

  interface ComputerApi {
    /** true while the page is in an app window (false in a plain browser tab: render mock data). */
    readonly inComputer: boolean;
    readonly isReady: boolean;
    /** Resolves once the desktop has said who and where the page is. */
    ready(cb?: (computer: ComputerApi) => void): Promise<ComputerApi>;
    /** Bumped whenever this API changes. */
    readonly version: number;
    /** Whether a call works here (an older desktop lacks it; no Photos on this computer; printing off). */
    supports(name: string): boolean;

    readonly app: { id: string; label: string; resource: string; version: string | null; developer: string | null } | null;
    readonly machine: { id: string; label: string; hostname: string; ip: string; style: string; os: string; build: string } | null;
    readonly user: { name: string; initials: string; job: string } | null;
    readonly settings: ComputerSettings | null;
    /** what the app was opened with (OpenApp's props, or another app's computer.openApp) */
    readonly launch: unknown;

    /** POST to one of your resource's RegisterNUICallback handlers. Resolves undefined on any failure. */
    fetchNui<T = unknown>(event: string, data?: unknown): Promise<T | undefined>;
    /** As fetchNui, but rejects instead. */
    fetchNuiStrict<T = unknown>(event: string, data?: unknown): Promise<T>;

    /**
     * Call one of the endpoints your server registered with the app (`endpoints = { name = function(src, data, ctx) }`).
     * Only ever runs for a player signed in at a computer with your app on it. Rejects with the
     * endpoint's error message (`return false, 'message'`) or the computer's.
     */
    callServer<T = unknown>(endpoint: string, data?: unknown): Promise<T>;
    /** Hear what Lua sends (SendAppMessage, client or server). '*' hears every action: (action, data). */
    onMessage(action: string, cb: (data: any) => void): () => void;
    onMessage(action: '*', cb: (action: string, data: any) => void): () => void;

    /** A notification on the desktop, with your app's icon and name. Clicking it brings the app up. */
    notify(n: { title: string; body?: string; data?: unknown }): Promise<boolean>;
    /** A notification of yours was clicked: its `data`. */
    onNotificationClick(cb: (data: any) => void): () => void;
    /** The count on your app's icon (0 clears). Kept for this player, so it is there at the next computer. */
    setBadge(count: number): Promise<number>;

    dialog: {
      alert(opts: ComputerDialogOptions | string): Promise<true>;
      confirm(opts: ComputerConfirmOptions | string): Promise<boolean>;
      /** The text typed, or null when cancelled. */
      prompt(opts: ComputerPromptOptions | string): Promise<string | null>;
    };
    /** A context menu at a point of the page (or at a mouse event). Resolves the picked item's id, or null. */
    menu(at: MouseEvent | { clientX: number; clientY: number }, items: ComputerMenuItem[]): Promise<string | null>;
    menu(opts: { x: number; y: number; items: ComputerMenuItem[] }): Promise<string | null>;
    /** A picture out of the character's Photos (or one added by its link). null when cancelled. */
    pickPhoto(): Promise<{ url: string; id: string } | null>;
    /** '#rrggbb', or null when cancelled. */
    pickColor(initial?: string): Promise<string | null>;
    /** The print dialog: a printer in reach, and copies. Resolves true once it went to a printer. */
    print(job: ComputerPrintJob): Promise<boolean>;
    /** Open another app: one of the desktop's ('mail' { to, subject }, 'browser' { address }, 'messages' { number } ...) or another custom app by its id. */
    openApp(id: string, props?: unknown): Promise<true>;

    storage: {
      /** The value, or `fallback` when there is none. */
      get<T = unknown>(key: string, fallback?: T, opts?: ComputerStorageOptions): Promise<T>;
      /** false when refused (over the app's limit, too many writes) - it never throws. */
      set(key: string, value: unknown, opts?: ComputerStorageOptions): Promise<boolean>;
      remove(key: string, opts?: ComputerStorageOptions): Promise<boolean>;
      keys(opts?: ComputerStorageOptions): Promise<string[]>;
      clear(opts?: ComputerStorageOptions): Promise<true>;
    };

    /** One of the desktop's sounds, in the look's own voice. */
    sound(name: 'notify' | 'error' | 'click'): Promise<true>;
    /** A line in this computer's Event Viewer, under your app's name. */
    log(message: string, level?: 'information' | 'warning' | 'error', data?: Record<string, unknown>): Promise<true>;

    onSettings(cb: (settings: ComputerSettings) => void): () => void;
    /** The app was brought up again with new launch props. */
    onLaunch(cb: (props: unknown) => void): () => void;

    window: {
      setTitle(title: string): Promise<true>;
      close(): Promise<true>;
      minimize(): Promise<true>;
      maximize(): Promise<true>;
      restore(): Promise<true>;
      focus(): Promise<true>;
      /** Ask the player before the window closes (or they stand up): a message, true for the default one, false/null to stop asking. */
      preventClose(message?: string | boolean | null): Promise<true>;
      state(): ComputerWindowState | null;
      /** Focus, minimise, maximise, resize, retitle: the new state. */
      on(cb: (state: ComputerWindowState) => void): () => void;
    };
  }

  interface Window {
    computer?: ComputerApi;
    /** Set by the SDK when the page has no fetchNui of its own. */
    fetchNui?: ComputerApi['fetchNui'];
  }

  interface WindowEventMap {
    'computer:ready': CustomEvent<ComputerApi>;
  }

  const computer: ComputerApi;
}
