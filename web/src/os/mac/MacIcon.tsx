import { useId, type CSSProperties } from 'react';
import type { WinApp } from '@/store/os';
import { isExt } from '@/types';
import ExtIcon from '@/apps/ext/ExtIcon';
import { AppIcon } from '../icons';

// Harbor's icon language: every app sits on a rounded "squircle" tile with its own gradient, the
// shared AppIcon art centred on it. Original artwork; the tiles are just colour fields.

const TILES: Record<Exclude<WinApp, `ext:${string}`> | 'system', [string, string]> = {
  mail: ['#ffffff', '#d7e7ff'],
  logs: ['#4a5568', '#1c2330'],
  cmd: ['#f6f6f8', '#c9cad2'],
  boss: ['#2e4a7d', '#111f3d'],
  notepad: ['#fffdf6', '#efe2c1'],
  calculator: ['#ffab52', '#f2621a'],
  settings: ['#eef0f3', '#b4bac5'],
  messages: ['#ffffff', '#dff5e3'],
  notes: ['#fffaf0', '#f3e6c4'],
  files: ['#eaf5ff', '#a7d0fb'],
  cameras: ['#2f6f7c', '#0d2c38'],
  board: ['#7f97b8', '#374b70'],
  bank: ['#ffe58f', '#f2b01e'],
  photos: ['#ff9d6c', '#e5407e'],
  contacts: ['#fff8f4', '#ffd7cf'],
  phonelink: ['#ffffff', '#cfe6ff'],
  browser: ['#ffffff', '#cdeefb'],
  games: ['#3b2a70', '#160e36'],
  mines: ['#3a4149', '#15181c'],
  solitaire: ['#1d7a4c', '#0c452a'],
  snake: ['#241743', '#07040f'],
  hack: ['#1b3315', '#050b04'],
  system: ['#6cb6ff', '#1d63d8'],
};

/**
 * An app tile. `size` fixes it in px; without it the tile fills its parent (the dock drives that
 * size live while magnifying). The art is sized in CSS (70% of the tile) so it scales with it.
 */
export function MacIcon({ app, size, className, style }: { app: WinApp | 'system'; size?: number; className?: string; style?: CSSProperties }) {
  // (a custom app's own picture is the whole tile, as an app's icon is)
  if (isExt(app)) {
    return (
      <span className={`mac-icon ${className ?? ''}`} style={{ width: size ?? '100%', height: size ?? '100%', ...style }}>
        <ExtIcon app={app} size="100%" look="tile" />
      </span>
    );
  }
  const [a, b] = TILES[app] ?? TILES.system;
  return (
    <span
      className={`mac-icon ${className ?? ''}`}
      style={{ width: size ?? '100%', height: size ?? '100%', background: `linear-gradient(165deg, ${a}, ${b})`, ...style }}
    >
      <AppIcon app={app} size={48} />
    </span>
  );
}

/**
 * The SD OS mark as a single-colour glyph (menu bar, boot screen): the mark's rounded tile in
 * currentColor with its orbit ring and satellite knocked out.
 */
export function MarkMono({ size = 16, className }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden>
      <defs>
        <mask id={`${id}m`}>
          <rect width="48" height="48" fill="#ffffff" />
          <path d="M33.9 16.5A12 12 0 1 0 35.4 28" fill="none" stroke="#000000" strokeWidth="4.6" strokeLinecap="round" />
          <circle cx="34.2" cy="21.6" r="3.3" fill="#000000" />
        </mask>
      </defs>
      <rect x="4" y="4" width="40" height="40" rx="12" fill="currentColor" mask={`url(#${id}m)`} />
    </svg>
  );
}

/** Dock thumbnail of a minimized window: a tiny window card with the app's tile as a badge. */
export function MiniWindow({ app, dark }: { app: WinApp; dark: boolean }) {
  return (
    <span className="mac-mini">
      <span className="mac-mini-card" style={{ background: dark ? '#2b2b2e' : '#fbfbfb' }}>
        <span className="mac-mini-bar">
          <i style={{ background: '#ff5f57' }} />
          <i style={{ background: '#febc2e' }} />
          <i style={{ background: '#28c840' }} />
        </span>
        <span className="mac-mini-lines">
          <i />
          <i />
          <i />
        </span>
      </span>
      <MacIcon app={app} className="mac-mini-badge" style={{ position: 'absolute', right: 0, bottom: 0, width: '44%', height: '44%' }} />
    </span>
  );
}

/** The segmented activity spinner (lock screen, shutdown): twelve fading bars stepping round. */
export function MacSpinner({ size = 20, color = '#ffffff', label }: { size?: number; color?: string; label?: string }) {
  return (
    <svg className="mac-spinner" width={size} height={size} viewBox="0 0 24 24" style={{ color }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x="10.9" y="1.5" width="2.2" height="6.2" rx="1.1" fill="currentColor" opacity={0.12 + (0.88 * (i + 1)) / 12} transform={`rotate(${i * 30} 12 12)`} />
      ))}
    </svg>
  );
}

/** Round initials avatar in a neutral grey (the lock screen's account picture). */
export function MacAvatar({ initials, size = 76 }: { initials: string; size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-full text-white font-medium shrink-0 select-none"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        letterSpacing: '0.02em',
        background: 'linear-gradient(180deg, #a7a7ad, #6b6b72)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.28), inset 0 0 0 1px rgba(255,255,255,0.18)',
      }}
    >
      {initials}
    </div>
  );
}
