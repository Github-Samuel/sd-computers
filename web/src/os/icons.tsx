import { useId, type ReactElement } from 'react';
import type { WinApp } from '@/store/os';
import { isExt } from '@/types';
import ExtIcon from '@/apps/ext/ExtIcon';

// Colourful Fluent-style app icons, drawn as SVG so nothing ships as an image file. Gradient ids go
// through useId() - the same icon renders many times at once (taskbar, start, desktop, titlebar).

interface IconProps {
  size?: number;
}

/** Points of a gear outline: `teeth` square-ish cogs between rInner and rOuter. */
const gearPath = (cx: number, cy: number, rOuter: number, rInner: number, teeth: number): string => {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const angles = [a - step * 0.22, a - step * 0.14, a + step * 0.14, a + step * 0.22];
    const radii = [rInner, rOuter, rOuter, rInner];
    angles.forEach((ang, k) => pts.push(`${(cx + Math.cos(ang) * radii[k]).toFixed(2)},${(cy + Math.sin(ang) * radii[k]).toFixed(2)}`));
  }
  return `M${pts.join('L')}Z`;
};

const GEAR = gearPath(24, 24, 19, 15, 9);

function MailIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6cc4ff" />
          <stop offset="1" stopColor="#0a5fd6" />
        </linearGradient>
      </defs>
      <rect x="4" y="10" width="40" height="29" rx="4.5" fill={`url(#${id}a)`} />
      <path d="M6 14l18 12.5L42 14" fill="none" stroke="#eaf4ff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LogsIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2f6fb" />
          <stop offset="1" stopColor="#b7c4d8" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd75e" />
          <stop offset="1" stopColor="#f29a00" />
        </linearGradient>
      </defs>
      <rect x="8" y="5" width="28" height="37" rx="3.5" fill={`url(#${id}a)`} />
      <rect x="13" y="12" width="18" height="2.6" rx="1.3" fill="#62758f" />
      <rect x="13" y="18" width="18" height="2.6" rx="1.3" fill="#62758f" />
      <rect x="13" y="24" width="11" height="2.6" rx="1.3" fill="#62758f" />
      <path d="M34 25l10 17H24z" fill={`url(#${id}b)`} stroke="#c97b00" strokeWidth="0.8" strokeLinejoin="round" />
      <rect x="32.9" y="30.5" width="2.2" height="6" rx="1.1" fill="#3b2a00" />
      <circle cx="34" cy="39.3" r="1.3" fill="#3b2a00" />
    </svg>
  );
}

function CmdIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <rect x="4" y="8" width="40" height="33" rx="4.5" fill="#1a1a1a" stroke="#5a5a5a" strokeWidth="1.2" />
      <path d="M4.6 14h38.8" stroke="#3a3a3a" strokeWidth="1.2" />
      <path d="M12 21.5l7 5-7 5" fill="none" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22.5 33h11" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  );
}

function BossIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#43e3c1" />
          <stop offset="1" stopColor="#088c77" />
        </linearGradient>
      </defs>
      <path d="M17 15v-3.5A2.5 2.5 0 0 1 19.5 9h9a2.5 2.5 0 0 1 2.5 2.5V15" fill="none" stroke="#0a6b5c" strokeWidth="3" />
      <rect x="5" y="15" width="38" height="26" rx="4.5" fill={`url(#${id}a)`} />
      <rect x="5" y="25" width="38" height="2.6" fill="rgba(0,0,0,0.18)" />
      <rect x="20.5" y="22" width="7" height="8" rx="1.6" fill="#ecfffb" />
    </svg>
  );
}

function NotepadIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff2a8" />
          <stop offset="1" stopColor="#ffd84d" />
        </linearGradient>
      </defs>
      <rect x="9" y="9" width="30" height="34" rx="2.5" fill={`url(#${id}a)`} />
      <rect x="9" y="5" width="30" height="7" rx="2.5" fill="#c0392b" />
      <path d="M15 9v34" stroke="#e57373" strokeWidth="1.2" />
      {[19, 24, 29, 34, 39].map(y => (
        <rect key={y} x="17.5" y={y} width={y === 39 ? 10 : 17} height="1.6" rx="0.8" fill="#9aa7c7" />
      ))}
    </svg>
  );
}

/** Messages (phone link): a green speech bubble with a typing ellipsis. */
function MessagesIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6ee87a" />
          <stop offset="1" stopColor="#1fae3c" />
        </linearGradient>
      </defs>
      <path d="M24 7C13.5 7 6 13.6 6 21.6c0 4.6 2.5 8.6 6.4 11.2L10.6 41l8.3-4.7c1.6.4 3.3.6 5.1.6 10.5 0 18-6.6 18-15.3S34.5 7 24 7z" fill={`url(#${id}a)`} />
      {[16.5, 24, 31.5].map(x => (
        <circle key={x} cx={x} cy="21.6" r="2.6" fill="#ffffff" />
      ))}
    </svg>
  );
}

/** Notes (phone link): a white card with an amber header band and a pencil stroke. */
function NotesIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffc94a" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <rect x="7" y="6" width="34" height="36" rx="5" fill="#fbfaf6" stroke="#d9d4c4" strokeWidth="1" />
      <path d="M7 11a5 5 0 0 1 5-5h24a5 5 0 0 1 5 5v4H7z" fill={`url(#${id}a)`} />
      {[22, 27.5, 33].map(y => (
        <rect key={y} x="12" y={y} width={y === 33 ? 13 : 24} height="1.8" rx="0.9" fill="#c9c3b3" />
      ))}
      <path d="M30 36.5l8.5-8.5 2.6 2.6-8.5 8.5-3.4.8z" fill="#f59e0b" stroke="#b86e00" strokeWidth="0.8" strokeLinejoin="round" />
    </svg>
  );
}

function CalculatorIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#61666e" />
          <stop offset="1" stopColor="#2c2f34" />
        </linearGradient>
      </defs>
      <rect x="9" y="4" width="30" height="40" rx="4.5" fill={`url(#${id}a)`} />
      <rect x="13" y="9" width="22" height="8" rx="1.6" fill="#cfeaf8" />
      {[0, 1, 2].map(r =>
        [0, 1, 2].map(c => (
          <rect
            key={`${r}${c}`}
            x={13 + c * 7.6}
            y={21 + r * 7.2}
            width="5.6"
            height="5.2"
            rx="1.2"
            fill={r === 2 && c === 2 ? '#ff8c1a' : '#d9dce1'}
          />
        )),
      )}
    </svg>
  );
}

function SettingsIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a9b4c4" />
          <stop offset="1" stopColor="#56627a" />
        </linearGradient>
      </defs>
      <path d={GEAR} fill={`url(#${id}a)`} />
      <circle cx="24" cy="24" r="6.4" fill="#2b3240" />
      <circle cx="24" cy="24" r="3.4" fill="#9fb0c8" />
    </svg>
  );
}

/** Files: an amber folder with a sheet of paper standing in it. */
function FilesIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd972" />
          <stop offset="1" stopColor="#f59f1c" />
        </linearGradient>
      </defs>
      <path d="M4 14.5A3.5 3.5 0 0 1 7.5 11h9.6a3.5 3.5 0 0 1 2.5 1l2.9 3h18a3.5 3.5 0 0 1 3.5 3.5V30H4z" fill="#d9830b" />
      <rect x="11" y="6" width="26" height="26" rx="2.5" fill="#fbfcfe" stroke="#cfd6e2" strokeWidth="1" />
      <rect x="15.5" y="11" width="17" height="2.2" rx="1.1" fill="#a9b5c9" />
      <rect x="15.5" y="15.6" width="11" height="2.2" rx="1.1" fill="#a9b5c9" />
      <rect x="4" y="21" width="40" height="21" rx="3.5" fill={`url(#${id}a)`} />
    </svg>
  );
}

/** Security Cameras: a wall-bracket camera tipped down at the room, its recording light lit. */
function CamerasIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6f9fc" />
          <stop offset="1" stopColor="#b3c0d4" />
        </linearGradient>
      </defs>
      <rect x="4" y="25" width="5.5" height="18" rx="2" fill="#64718a" />
      <path d="M9 36h8.5l5-9" fill="none" stroke="#64718a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <g transform="rotate(14 24 19)">
        <rect x="8" y="11" width="30" height="16" rx="4.5" fill={`url(#${id}a)`} />
        <rect x="31" y="11" width="9" height="16" rx="3" fill="#2b3447" />
        <rect x="36" y="14.5" width="2.4" height="9" rx="1.2" fill="#6fdcff" />
        <rect x="6" y="8" width="36" height="5.5" rx="2.75" fill="#7c8aa1" />
        <circle cx="14.5" cy="21" r="2.6" fill="#ff3d3d" />
      </g>
    </svg>
  );
}

/** Company Board: a cork pinboard in a wooden frame with three pinned notes. */
function BoardIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3cd95" />
          <stop offset="1" stopColor="#d59a55" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b87a3c" />
          <stop offset="1" stopColor="#85501f" />
        </linearGradient>
      </defs>
      <rect x="4" y="7" width="40" height="34" rx="4.5" fill={`url(#${id}b)`} />
      <rect x="7.5" y="10.5" width="33" height="27" rx="2" fill={`url(#${id}a)`} />
      <rect x="11" y="15" width="12" height="14" rx="1.2" fill="#ffffff" />
      <rect x="13.5" y="20.5" width="7" height="1.6" rx="0.8" fill="#aab4c6" />
      <rect x="13.5" y="24" width="5" height="1.6" rx="0.8" fill="#aab4c6" />
      <rect x="26" y="14" width="11" height="9.5" rx="1.2" fill="#ffe36b" />
      <rect x="25" y="26.5" width="12" height="8" rx="1.2" fill="#9fe6c0" />
      <circle cx="17" cy="15.5" r="2.3" fill="#e5383b" />
      <circle cx="31.5" cy="14.5" r="2.3" fill="#2f7de1" />
      <circle cx="31" cy="27" r="2.3" fill="#e5383b" />
    </svg>
  );
}

/** Bank: a classical front - a pediment with a gold coin, three columns, a stepped base. */
function BankIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a3a0ff" />
          <stop offset="1" stopColor="#4a40d4" />
        </linearGradient>
      </defs>
      <rect x="7" y="19" width="34" height="19" fill="#372fa8" />
      <rect x="9.5" y="21" width="6" height="15.5" rx="1.2" fill="#f1efff" />
      <rect x="21" y="21" width="6" height="15.5" rx="1.2" fill="#f1efff" />
      <rect x="32.5" y="21" width="6" height="15.5" rx="1.2" fill="#f1efff" />
      <path d="M22.5 5.4a3 3 0 0 1 3 0L42.5 15a3 3 0 0 1 1.5 2.6V19a1.5 1.5 0 0 1-1.5 1.5h-37A1.5 1.5 0 0 1 4 19v-1.4A3 3 0 0 1 5.5 15z" fill={`url(#${id}a)`} />
      <circle cx="24" cy="13.6" r="3.4" fill="#ffcf3f" />
      <rect x="4" y="37" width="40" height="6.5" rx="2" fill={`url(#${id}a)`} />
    </svg>
  );
}

/** Photos: a white-bordered print of a sun over two green hills. */
function PhotosIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#58c7ff" />
          <stop offset="1" stopColor="#c9f0ff" />
        </linearGradient>
      </defs>
      <rect x="4" y="8" width="40" height="32" rx="4.5" fill="#ffffff" stroke="#cfd6e2" strokeWidth="1" />
      <rect x="7.5" y="11.5" width="33" height="25" rx="2" fill={`url(#${id}a)`} />
      <circle cx="32.5" cy="18.5" r="4" fill="#ffd23f" />
      <path d="M7.5 30.5c3-4.2 6-7.5 9.5-7.5 4.5 0 7 5 10.5 9 2 2.3 4.5 4.5 7 4.5h-25a2 2 0 0 1-2-2z" fill="#58c66e" />
      <path d="M19 36.5c3.5-5 7.5-8.5 12-8.5 4 0 7 2.2 9.5 5v1.5a2 2 0 0 1-2 2z" fill="#2c9d55" />
    </svg>
  );
}

/** Contacts: a rose address book with index tabs and a person's silhouette on the cover. */
function ContactsIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff9aa0" />
          <stop offset="1" stopColor="#df3f58" />
        </linearGradient>
      </defs>
      <rect x="34" y="10" width="8.5" height="7.5" rx="2.2" fill="#ffd166" />
      <rect x="34" y="20.2" width="8.5" height="7.5" rx="2.2" fill="#6fdcb0" />
      <rect x="34" y="30.5" width="8.5" height="7.5" rx="2.2" fill="#7cc4ff" />
      <rect x="7" y="5" width="31" height="38" rx="4.5" fill={`url(#${id}a)`} />
      <path d="M11.5 5H13v38h-1.5A4.5 4.5 0 0 1 7 38.5v-29A4.5 4.5 0 0 1 11.5 5z" fill="rgba(0,0,0,0.2)" />
      <circle cx="25.5" cy="18.5" r="5" fill="#ffffff" />
      <path d="M16 35c0-5.5 4.2-9 9.5-9s9.5 3.5 9.5 9a1.5 1.5 0 0 1-1.5 1.5h-16A1.5 1.5 0 0 1 16 35z" fill="#ffffff" />
    </svg>
  );
}

/** Phone Link: a phone standing in front of a monitor, two chain links on its screen. */
function PhoneLinkIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#74d6ff" />
          <stop offset="1" stopColor="#2b6fe6" />
        </linearGradient>
      </defs>
      <rect x="3" y="6" width="34" height="25" rx="3.5" fill={`url(#${id}a)`} />
      <rect x="6" y="9" width="28" height="19" rx="1.5" fill="#e3f4ff" />
      <rect x="15.5" y="31" width="9" height="4.5" fill="#8793a6" />
      <rect x="10" y="35" width="20" height="3.5" rx="1.75" fill="#a8b2c2" />
      <rect x="25.5" y="14.5" width="19.5" height="30.5" rx="4.5" fill="#182441" />
      <rect x="28" y="17.5" width="14.5" height="22.5" rx="2" fill="#ffffff" />
      <rect x="33" y="41.6" width="4.5" height="1.6" rx="0.8" fill="#ffffff" />
      <rect x="30.2" y="26.4" width="6.6" height="4.8" rx="2.4" fill="none" stroke="#2b6fe6" strokeWidth="1.9" />
      <rect x="33.7" y="26.4" width="6.6" height="4.8" rx="2.4" fill="none" stroke="#16a34a" strokeWidth="1.9" />
    </svg>
  );
}

/** Browser: a globe ruled with a meridian and parallels, a pointer resting on it. */
function BrowserIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#74e4ff" />
          <stop offset="1" stopColor="#1672dc" />
        </linearGradient>
      </defs>
      <circle cx="22.5" cy="22.5" r="18" fill={`url(#${id}a)`} />
      <ellipse cx="22.5" cy="22.5" rx="7.5" ry="17" fill="none" stroke="#ffffff" strokeWidth="2" />
      <path d="M5.5 22.5h34M8 13c4 1.7 8.5 2.7 14.5 2.7S33 14.7 37 13M8 32c4-1.7 8.5-2.7 14.5-2.7S33 30.3 37 32" fill="none" stroke="#ffffff" strokeWidth="2" />
      <path d="M27 26v17.5l4.7-4.3 3.1 6.8 3.5-1.6-3.1-6.7 6.3-.4z" fill="#ffffff" stroke="#0d3f8f" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/** Games: a plain two-grip gamepad - a cross pad on the left, two buttons on the right. */
function GamesIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f59bff" />
          <stop offset="1" stopColor="#9b34dc" />
        </linearGradient>
      </defs>
      <path d="M14.5 11h19c5.7 0 9.7 4.3 10.5 10l1.2 8.5c.7 5-2 8.5-5.5 8.5-2.5 0-4.3-1.5-5.5-3.8l-1.5-2.9c-.5-1-1.5-1.8-2.7-1.8H18c-1.2 0-2.2.8-2.7 1.8l-1.5 2.9c-1.2 2.3-3 3.8-5.5 3.8-3.5 0-6.2-3.5-5.5-8.5L4 21c.8-5.7 4.8-10 10.5-10z" fill={`url(#${id}a)`} />
      <rect x="10.5" y="18.8" width="9" height="3.4" rx="1.1" fill="#ffffff" />
      <rect x="13.3" y="16" width="3.4" height="9" rx="1.1" fill="#ffffff" />
      <circle cx="36.5" cy="18" r="2.5" fill="#ffe36b" />
      <circle cx="31.5" cy="23" r="2.5" fill="#ffe36b" />
    </svg>
  );
}

/** Mines: one raised steel plate of the field with a flag planted on it. */
function MinesIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8c97a4" />
          <stop offset="1" stopColor="#3c434b" />
        </linearGradient>
      </defs>
      <rect x="5" y="5" width="38" height="38" rx="7" fill="#15181c" />
      <rect x="7" y="7" width="34" height="34" rx="5" fill={`url(#${id}a)`} />
      <path d="M8 13.5V40M40.5 8v32" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="1" fill="none" />
      <path d="M19 12v24M14 36h11" stroke="#f2f5f8" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d="M20.5 12.5L36 19 20.5 25.5z" fill="#ff7a1a" />
    </svg>
  );
}

/** Solitaire: two cards on the felt, the ace of spades over a heart. */
function SolitaireIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <rect x="4" y="6" width="40" height="36" rx="8" fill="#16663f" />
      <rect x="4" y="6" width="40" height="36" rx="8" fill="none" stroke="#e3c574" strokeOpacity="0.7" strokeWidth="1.5" />
      <g transform="rotate(-12 18 24)">
        <rect x="9" y="11" width="18" height="26" rx="2.6" fill="#fbf8ee" stroke="#1b1b1f" strokeOpacity="0.35" />
        <path d="M18 31c-4.4-3.8-6.6-6.2-6.6-8.9 0-2 1.5-3.5 3.4-3.5 1.3 0 2.5.7 3.2 1.9.7-1.2 1.9-1.9 3.2-1.9 1.9 0 3.4 1.5 3.4 3.5 0 2.7-2.2 5.1-6.6 8.900z" fill="#c5221f" />
      </g>
      <g transform="rotate(10 30 24)">
        <rect x="21" y="10" width="18" height="26" rx="2.6" fill="#fffdf7" stroke="#1b1b1f" strokeOpacity="0.35" />
        <path d="M30 15c-2.6 3.3-6.5 5.6-6.5 8.8 0 1.9 1.4 3.2 3.2 3.2 1.1 0 2-.5 2.7-1.3-.1 1.4-.6 2.6-1.5 3.600h4.200c-.9-1-1.4-2.2-1.5-3.6.7.8 1.6 1.3 2.7 1.3 1.8 0 3.2-1.3 3.2-3.2 0-3.2-3.9-5.5-6.5-8.800z" fill="#1b1b1f" />
      </g>
    </svg>
  );
}

/** Snake: the snake itself, lit, turning on its black screen towards what it eats. */
function SnakeIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <rect x="4" y="4" width="40" height="40" rx="9" fill="#0a0612" />
      <rect x="4" y="4" width="40" height="40" rx="9" fill="none" stroke="#3b2a66" strokeWidth="2" />
      <path d="M12 34h12v-9h10v-9" fill="none" stroke="#39ff7a" strokeWidth="6" strokeLinejoin="round" strokeLinecap="square" />
      <rect x="30.5" y="11.5" width="7" height="7" rx="1.5" fill="#b6ffd0" />
      <rect x="33" y="14" width="2" height="2" fill="#0a0612" />
      <rect x="12.5" y="12.5" width="5" height="5" fill="#ff3ea5" transform="rotate(45 15 15)" />
    </svg>
  );
}

function HackIcon({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f3a17" />
          <stop offset="1" stopColor="#0a1508" />
        </linearGradient>
      </defs>
      <path d="M24 4l16 6v12c0 10-7 18-16 22C15 40 8 32 8 22V10z" fill={`url(#${id}a)`} stroke="#88e52b" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="24" cy="20" r="4.2" fill="#88e52b" />
      <rect x="22.4" y="22" width="3.2" height="9" rx="1.2" fill="#88e52b" />
    </svg>
  );
}

function SystemIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <rect x="5" y="9" width="38" height="25" rx="3" fill="#3a8ee6" />
      <rect x="8" y="12" width="32" height="19" rx="1.5" fill="#bfe1ff" />
      <rect x="18" y="35" width="12" height="3" fill="#7d8796" />
      <rect x="13" y="38" width="22" height="3" rx="1.5" fill="#9aa4b2" />
    </svg>
  );
}

const ICONS: Record<Exclude<WinApp, `ext:${string}`> | 'system', (p: IconProps) => ReactElement> = {
  mail: MailIcon,
  logs: LogsIcon,
  cmd: CmdIcon,
  boss: BossIcon,
  notepad: NotepadIcon,
  calculator: CalculatorIcon,
  settings: SettingsIcon,
  messages: MessagesIcon,
  notes: NotesIcon,
  files: FilesIcon,
  cameras: CamerasIcon,
  board: BoardIcon,
  bank: BankIcon,
  photos: PhotosIcon,
  contacts: ContactsIcon,
  phonelink: PhoneLinkIcon,
  browser: BrowserIcon,
  games: GamesIcon,
  mines: MinesIcon,
  solitaire: SolitaireIcon,
  snake: SnakeIcon,
  hack: HackIcon,
  system: SystemIcon,
};

/** An app's icon by id (falls back to the generic system icon). */
export function AppIcon({ app, size = 24 }: { app: WinApp | 'system'; size?: number }) {
  if (isExt(app)) return <ExtIcon app={app} size={size} look="modern" />;
  const Icon = ICONS[app] ?? SystemIcon;
  return <Icon size={size} />;
}

/**
 * The SD OS mark (Start button, boot screen, Settings > About): a gradient tile with an open
 * orbit ring and a satellite dot. Original artwork - no third-party logo anywhere in the OS.
 */
export function OsLogo({ size = 24 }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3fe0d0" />
          <stop offset="0.55" stopColor="#4f8dff" />
          <stop offset="1" stopColor="#8b5cff" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="40" height="40" rx="12" fill={`url(#${id}a)`} />
      <path d="M33.9 16.5A12 12 0 1 0 35.4 28" fill="none" stroke="#ffffff" strokeWidth="4.2" strokeLinecap="round" />
      <circle cx="34.2" cy="21.6" r="3.1" fill="#ffffff" />
    </svg>
  );
}

/** Round initials avatar on an accent gradient. */
export function Avatar({ initials, size = 32 }: { initials: string; size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-full font-semibold text-white shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: 'linear-gradient(135deg, var(--accent), #2b2f6b)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)',
      }}
    >
      {initials}
    </div>
  );
}

// Thin 10px caption glyphs for the title bar buttons.
export const GlyphMin = () => (
  <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5.5h10" stroke="currentColor" strokeWidth="1" /></svg>
);
export const GlyphMax = () => (
  <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
);
export const GlyphRestore = () => (
  <svg width="10" height="10" viewBox="0 0 10 10">
    <rect x="0.5" y="2.5" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1" />
    <path d="M2.5 2.5V1.8A1.3 1.3 0 0 1 3.8 0.5h4.4a1.3 1.3 0 0 1 1.3 1.3v4.4a1.3 1.3 0 0 1-1.3 1.3H7.5" fill="none" stroke="currentColor" strokeWidth="1" />
  </svg>
);
export const GlyphClose = () => (
  <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1" /></svg>
);
