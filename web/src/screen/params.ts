import type { OsStyle, Theme } from '@/types';

// What client Lua asked this page to be (client/screens/dui.lua builds the address).

const q = new URLSearchParams(window.location.search);

const text = (key: string, fallback: string): string => q.get(key) || fallback;
const size = (key: string, fallback: number): number => {
  const n = Number(q.get(key));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const STYLES: OsStyle[] = ['modern', 'retro', 'mac'];
const WALLPAPER: Record<OsStyle, string> = { modern: 'petals-dark', retro: 'retro-teal', mac: 'harbor-dunes' };

const style = (STYLES as string[]).includes(q.get('style') ?? '') ? (q.get('style') as OsStyle) : 'modern';

/** The game serves a resource's pages from https://cfx-nui-<resource>/; anywhere else this is a browser tab. */
const NUI_HOST = /^cfx-nui-/;
export const inGame = NUI_HOST.test(window.location.hostname);
/** The resource this page belongs to: its NUI callbacks live at https://<resource>/<callback>. */
export const resource = window.location.hostname.replace(NUI_HOST, '');

export const params = {
  /** 'idle' = the lock face; 'live' = a session's copy (the lock face until it arrives). */
  mode: q.get('mode') === 'live' ? ('live' as const) : ('idle' as const),
  style,
  theme: (q.get('theme') === 'light' ? 'light' : 'dark') as Theme,
  wallpaper: text('wallpaper', WALLPAPER[style]),
  accent: text('accent', '#4cc2ff'),
  clock24: q.get('clock24') === '1',
  /** The part of the texture this screen is drawn from, from its top left (px). */
  vw: size('vw', window.innerWidth),
  vh: size('vh', window.innerHeight),
  /** The number this page names itself with when it reports in. */
  id: size('id', 0),
  /** Hosts a wallpaper image may come from, space-separated. */
  imageHosts: text('img', ''),
  /** Where the custom apps' pages and icons are served from (images, fonts and stylesheets in them), space-separated. */
  appHosts: text('apps', ''),
};

/** POST to one of the resource's NUI callbacks (a no-op outside the game). */
export function post(callback: string, data?: unknown): Promise<unknown> {
  if (!inGame) return Promise.resolve(null);
  return fetch(`https://${resource}/${callback}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(data ?? {}),
  })
    .then(r => r.json() as Promise<unknown>)
    .catch(() => null);
}
