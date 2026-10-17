// Pixel art for the retro shell: hand-placed rects on a 16x16 grid (crispEdges, so they stay chunky
// at any integer scale), held to the 16-colour VGA palette. The SD OS mark is generated - the same
// gradient tile + open orbit ring + satellite dot as OsLogo, quantised to pixels with a 2x2 dither
// between the gradient stops (how a 16-colour card faked a blend).
import type { ReactElement, ReactNode } from 'react';
import type { WinApp } from '@/store/os';
import { isExt } from '@/types';
import ExtIcon from '@/apps/ext/ExtIcon';

const P = {
  k: '#000000',
  w: '#ffffff',
  s: '#c0c0c0',
  d: '#808080',
  n: '#000080',
  b: '#0000ff',
  t: '#008080',
  c: '#00ffff',
  r: '#aa0000',
  R: '#ff5555',
  y: '#ffff55',
  Y: '#d0a020',
  g: '#00aa00',
  G: '#55ff55',
  o: '#aa5500',
  O: '#d07a2a',
  l: '#b8e8b0',
};

interface IconProps {
  size?: number;
}

const Px = ({ x, y, w = 1, h = 1, c }: { x: number; y: number; w?: number; h?: number; c: string }) => (
  <rect x={x} y={y} width={w} height={h} fill={c} />
);

const grid = (children: ReactNode, size: number, n = 16) => (
  <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" style={{ imageRendering: 'pixelated', display: 'block' }} aria-hidden>
    {children}
  </svg>
);

// ── App icons ────────────────────────────────────────────────────────────────

/** Envelope with the flap's V. */
const MailPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={0} y={3} w={16} h={11} c={P.k} />
      <Px x={1} y={4} w={14} h={9} c={P.w} />
      <Px x={1} y={12} w={14} h={1} c={P.s} />
      {[0, 1, 2, 3, 4, 5, 6].map(i => (
        <g key={i}>
          <Px x={1 + i} y={4 + i} c={P.n} />
          <Px x={14 - i} y={4 + i} c={P.n} />
        </g>
      ))}
      <Px x={11} y={1} w={4} h={2} c={P.r} />
    </>,
    size,
  );

/** A log sheet with a warning badge on its corner. */
const LogsPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={1} y={0} w={10} h={15} c={P.k} />
      <Px x={2} y={1} w={8} h={13} c={P.w} />
      <Px x={3} y={3} w={6} h={1} c={P.k} />
      <Px x={3} y={5} w={6} h={1} c={P.d} />
      <Px x={3} y={7} w={6} h={1} c={P.d} />
      <Px x={3} y={9} w={4} h={1} c={P.d} />
      <Px x={3} y={11} w={3} h={1} c={P.d} />
      <Px x={11} y={7} w={2} h={2} c={P.k} />
      <Px x={10} y={9} w={4} h={2} c={P.k} />
      <Px x={9} y={11} w={6} h={2} c={P.k} />
      <Px x={8} y={13} w={8} h={3} c={P.k} />
      <Px x={11} y={9} w={2} h={2} c={P.y} />
      <Px x={10} y={11} w={4} h={2} c={P.y} />
      <Px x={9} y={13} w={6} h={2} c={P.y} />
      <Px x={11} y={10} w={2} h={3} c={P.k} />
      <Px x={11} y={14} w={2} h={1} c={P.k} />
    </>,
    size,
  );

/** A console window: navy strip, black screen, prompt and cursor. */
const CmdPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={0} y={1} w={16} h={14} c={P.d} />
      <Px x={1} y={2} w={14} h={2} c={P.n} />
      <Px x={1} y={4} w={14} h={10} c={P.k} />
      <Px x={3} y={6} c={P.s} />
      <Px x={4} y={7} c={P.s} />
      <Px x={3} y={8} c={P.s} />
      <Px x={6} y={8} w={3} h={1} c={P.w} />
    </>,
    size,
  );

/** Leather briefcase with a brass latch. */
const BossPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={5} y={2} w={6} h={1} c={P.k} />
      <Px x={5} y={3} w={1} h={2} c={P.k} />
      <Px x={10} y={3} w={1} h={2} c={P.k} />
      <Px x={0} y={5} w={16} h={10} c={P.k} />
      <Px x={1} y={6} w={14} h={8} c={P.o} />
      <Px x={1} y={6} w={14} h={1} c={P.O} />
      <Px x={1} y={9} w={14} h={1} c={P.k} />
      <Px x={7} y={8} w={2} h={3} c={P.y} />
    </>,
    size,
  );

/** A spiral pad with a red binding. */
const NotepadPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={2} y={1} w={12} h={15} c={P.k} />
      <Px x={3} y={4} w={10} h={11} c={P.w} />
      <Px x={3} y={2} w={10} h={2} c={P.r} />
      <Px x={4} y={0} w={1} h={3} c={P.d} />
      <Px x={7} y={0} w={1} h={3} c={P.d} />
      <Px x={10} y={0} w={1} h={3} c={P.d} />
      <Px x={4} y={6} w={8} h={1} c={P.d} />
      <Px x={4} y={8} w={8} h={1} c={P.d} />
      <Px x={4} y={10} w={8} h={1} c={P.d} />
      <Px x={4} y={12} w={5} h={1} c={P.d} />
    </>,
    size,
  );

/** Speech balloon with three dots - Messages (phone link). */
const MessagesPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={1} y={2} w={14} h={9} c={P.k} />
      <Px x={2} y={3} w={12} h={7} c={P.w} />
      <Px x={3} y={11} w={3} h={2} c={P.k} />
      <Px x={4} y={11} w={1} h={1} c={P.w} />
      <Px x={3} y={13} w={1} h={1} c={P.k} />
      <Px x={4} y={6} w={2} h={2} c={P.g} />
      <Px x={7} y={6} w={2} h={2} c={P.g} />
      <Px x={10} y={6} w={2} h={2} c={P.g} />
    </>,
    size,
  );

/** Index card with an amber band - Notes (phone link). */
const NotesPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={2} y={1} w={12} h={14} c={P.k} />
      <Px x={3} y={2} w={10} h={12} c={P.w} />
      <Px x={3} y={2} w={10} h={3} c={P.Y} />
      <Px x={4} y={7} w={8} h={1} c={P.d} />
      <Px x={4} y={9} w={8} h={1} c={P.d} />
      <Px x={4} y={11} w={5} h={1} c={P.d} />
      <Px x={10} y={10} w={2} h={1} c={P.O} />
      <Px x={11} y={11} w={2} h={1} c={P.O} />
    </>,
    size,
  );

/** Desk calculator: LCD + keys. */
const CalculatorPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={2} y={0} w={12} h={16} c={P.k} />
      <Px x={3} y={1} w={10} h={14} c={P.d} />
      <Px x={4} y={2} w={8} h={3} c={P.l} />
      <Px x={8} y={3} w={3} h={1} c={P.k} />
      {[6, 9, 12].map(y =>
        [4, 7, 10].map(x => <Px key={`${x}${y}`} x={x} y={y} w={2} h={2} c={x === 10 && y === 12 ? P.R : P.s} />),
      )}
    </>,
    size,
  );

/** Control panel: a bevelled box with two sliders. */
const SettingsPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={1} y={1} w={14} h={14} c={P.k} />
      <Px x={2} y={2} w={12} h={12} c={P.s} />
      <Px x={2} y={2} w={12} h={1} c={P.w} />
      <Px x={2} y={2} w={1} h={12} c={P.w} />
      <Px x={2} y={13} w={12} h={1} c={P.d} />
      <Px x={13} y={2} w={1} h={12} c={P.d} />
      <Px x={4} y={5} w={8} h={1} c={P.k} />
      <Px x={4} y={10} w={8} h={1} c={P.k} />
      <Px x={5} y={4} w={2} h={3} c={P.n} />
      <Px x={9} y={9} w={2} h={3} c={P.r} />
    </>,
    size,
  );

/** Yellow folder with a sheet of paper standing in it - Files. */
const FilesPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={1} y={2} w={4} h={1} c={P.k} />
      <Px x={0} y={3} w={6} h={3} c={P.k} />
      <Px x={12} y={4} w={3} h={1} c={P.k} />
      <Px x={12} y={5} w={4} h={1} c={P.k} />
      <Px x={1} y={3} w={4} h={3} c={P.Y} />
      <Px x={13} y={5} w={2} h={1} c={P.Y} />
      <Px x={5} y={0} w={8} h={6} c={P.k} />
      <Px x={6} y={1} w={6} h={5} c={P.w} />
      <Px x={7} y={2} w={4} h={1} c={P.d} />
      <Px x={7} y={4} w={4} h={1} c={P.d} />
      <Px x={0} y={6} w={16} h={10} c={P.k} />
      <Px x={1} y={7} w={14} h={8} c={P.y} />
      <Px x={14} y={7} w={1} h={8} c={P.Y} />
      <Px x={1} y={14} w={14} h={1} c={P.Y} />
    </>,
    size,
  );

/** Hooded camera on a wall bracket, red light on - Security Cameras. */
const CamerasPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={1} y={1} w={14} h={3} c={P.k} />
      <Px x={2} y={2} w={12} h={1} c={P.d} />
      <Px x={2} y={4} w={13} h={6} c={P.k} />
      <Px x={3} y={4} w={8} h={5} c={P.w} />
      <Px x={3} y={8} w={8} h={1} c={P.s} />
      <Px x={12} y={4} w={2} h={2} c={P.c} />
      <Px x={12} y={6} w={2} h={3} c={P.t} />
      <Px x={4} y={6} w={2} h={2} c={P.R} />
      <Px x={6} y={10} w={4} h={5} c={P.k} />
      <Px x={7} y={10} w={2} h={4} c={P.d} />
      <Px x={0} y={11} w={3} h={5} c={P.k} />
      <Px x={1} y={12} w={1} h={3} c={P.d} />
      <Px x={2} y={12} w={5} h={3} c={P.k} />
      <Px x={2} y={13} w={7} h={1} c={P.d} />
    </>,
    size,
  );

/** Cork board in a wooden frame with three pinned notes - Company Board. */
const BoardPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={0} y={1} w={16} h={14} c={P.k} />
      <Px x={1} y={2} w={14} h={12} c={P.o} />
      <Px x={2} y={3} w={12} h={10} c={P.O} />
      <Px x={3} y={4} w={4} h={6} c={P.w} />
      <Px x={4} y={6} w={2} h={1} c={P.d} />
      <Px x={4} y={8} w={2} h={1} c={P.d} />
      <Px x={8} y={4} w={5} h={4} c={P.y} />
      <Px x={8} y={9} w={5} h={3} c={P.l} />
      <Px x={4} y={4} w={2} h={1} c={P.r} />
      <Px x={10} y={4} w={1} h={1} c={P.r} />
      <Px x={10} y={9} w={1} h={1} c={P.r} />
    </>,
    size,
  );

/** Stone bank front: a pediment with a gold coin over four columns - Bank. */
const BankPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={7} y={0} w={2} h={1} c={P.k} />
      <Px x={5} y={1} w={6} h={1} c={P.k} />
      <Px x={3} y={2} w={10} h={1} c={P.k} />
      <Px x={1} y={3} w={14} h={1} c={P.k} />
      <Px x={0} y={4} w={16} h={12} c={P.k} />
      <Px x={7} y={1} w={2} h={1} c={P.s} />
      <Px x={5} y={2} w={6} h={1} c={P.s} />
      <Px x={3} y={3} w={10} h={1} c={P.s} />
      <Px x={7} y={2} w={2} h={2} c={P.y} />
      <Px x={1} y={5} w={14} h={1} c={P.w} />
      <Px x={1} y={7} w={14} h={5} c={P.n} />
      {[1, 5, 9, 13].map(x => (
        <g key={x}>
          <Px x={x} y={7} h={5} c={P.w} />
          <Px x={x + 1} y={7} h={5} c={P.s} />
        </g>
      ))}
      <Px x={1} y={13} w={14} h={1} c={P.w} />
      <Px x={1} y={14} w={14} h={1} c={P.s} />
    </>,
    size,
  );

/** Framed snapshot: sun, sky and two hills - Photos. */
const PhotosPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={0} y={1} w={16} h={14} c={P.k} />
      <Px x={1} y={2} w={14} h={12} c={P.w} />
      <Px x={2} y={3} w={12} h={10} c={P.c} />
      <Px x={10} y={4} w={2} h={2} c={P.y} />
      <Px x={5} y={6} w={2} h={1} c={P.g} />
      <Px x={4} y={7} w={4} h={1} c={P.g} />
      <Px x={3} y={8} w={6} h={1} c={P.g} />
      <Px x={2} y={9} w={8} h={4} c={P.g} />
      <Px x={12} y={8} w={1} h={1} c={P.G} />
      <Px x={11} y={9} w={3} h={1} c={P.G} />
      <Px x={10} y={10} w={4} h={1} c={P.G} />
      <Px x={8} y={11} w={6} h={1} c={P.G} />
      <Px x={6} y={12} w={8} h={1} c={P.G} />
    </>,
    size,
  );

/** Red address book with index tabs and a figure on the cover - Contacts. */
const ContactsPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={12} y={2} w={3} h={10} c={P.k} />
      <Px x={12} y={3} w={2} h={2} c={P.y} />
      <Px x={12} y={6} w={2} h={2} c={P.c} />
      <Px x={12} y={9} w={2} h={2} c={P.G} />
      <Px x={0} y={0} w={12} h={16} c={P.k} />
      <Px x={1} y={1} w={10} h={14} c={P.R} />
      <Px x={1} y={1} w={2} h={14} c={P.r} />
      <Px x={6} y={3} w={2} h={4} c={P.w} />
      <Px x={5} y={4} w={4} h={2} c={P.w} />
      <Px x={5} y={8} w={4} h={1} c={P.w} />
      <Px x={4} y={9} w={6} h={3} c={P.w} />
    </>,
    size,
  );

/** A handset standing in front of a monitor, two joined links on its screen - Phone Link. */
const PhoneLinkPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={0} y={1} w={12} h={9} c={P.k} />
      <Px x={1} y={2} w={10} h={7} c={P.s} />
      <Px x={2} y={3} w={8} h={5} c={P.t} />
      <Px x={5} y={10} w={2} h={2} c={P.d} />
      <Px x={2} y={12} w={7} h={2} c={P.k} />
      <Px x={3} y={12} w={5} h={1} c={P.s} />
      <Px x={9} y={4} w={7} h={12} c={P.k} />
      <Px x={10} y={5} w={5} h={9} c={P.w} />
      <Px x={12} y={14} w={1} h={1} c={P.s} />
      <Px x={11} y={7} w={2} h={2} c={P.n} />
      <Px x={12} y={9} w={2} h={2} c={P.g} />
      <Px x={12} y={8} w={1} h={1} c={P.w} />
    </>,
    size,
  );

/** Wireframe globe: blue sphere ruled with meridians and parallels - Browser. */
const BrowserPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={5} y={0} w={5} h={15} c={P.k} />
      <Px x={3} y={1} w={9} h={13} c={P.k} />
      <Px x={2} y={2} w={11} h={11} c={P.k} />
      <Px x={1} y={3} w={13} h={9} c={P.k} />
      <Px x={0} y={5} w={15} h={5} c={P.k} />
      <Px x={5} y={1} w={5} h={13} c={P.b} />
      <Px x={3} y={2} w={9} h={11} c={P.b} />
      <Px x={2} y={3} w={11} h={9} c={P.b} />
      <Px x={1} y={5} w={13} h={5} c={P.b} />
      <Px x={1} y={7} w={13} h={1} c={P.c} />
      <Px x={2} y={4} w={11} h={1} c={P.c} />
      <Px x={2} y={10} w={11} h={1} c={P.c} />
      <Px x={7} y={1} w={1} h={13} c={P.c} />
      <Px x={5} y={2} w={1} h={1} c={P.c} />
      <Px x={4} y={3} w={1} h={2} c={P.c} />
      <Px x={3} y={5} w={1} h={5} c={P.c} />
      <Px x={4} y={10} w={1} h={2} c={P.c} />
      <Px x={5} y={12} w={1} h={1} c={P.c} />
      <Px x={9} y={2} w={1} h={1} c={P.c} />
      <Px x={10} y={3} w={1} h={2} c={P.c} />
      <Px x={11} y={5} w={1} h={5} c={P.c} />
      <Px x={10} y={10} w={1} h={2} c={P.c} />
      <Px x={9} y={12} w={1} h={1} c={P.c} />
    </>,
    size,
  );

/** Navy two-grip gamepad: cross pad and two buttons - Games. */
const GamesPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={2} y={3} w={12} h={1} c={P.k} />
      <Px x={1} y={4} w={14} h={1} c={P.k} />
      <Px x={0} y={5} w={16} h={5} c={P.k} />
      <Px x={0} y={10} w={6} h={2} c={P.k} />
      <Px x={10} y={10} w={6} h={2} c={P.k} />
      <Px x={1} y={12} w={4} h={1} c={P.k} />
      <Px x={11} y={12} w={4} h={1} c={P.k} />
      <Px x={2} y={13} w={2} h={1} c={P.k} />
      <Px x={12} y={13} w={2} h={1} c={P.k} />
      <Px x={2} y={4} w={12} h={1} c={P.b} />
      <Px x={1} y={5} w={14} h={4} c={P.n} />
      <Px x={1} y={9} w={5} h={1} c={P.n} />
      <Px x={10} y={9} w={5} h={1} c={P.n} />
      <Px x={1} y={10} w={4} h={2} c={P.n} />
      <Px x={11} y={10} w={4} h={2} c={P.n} />
      <Px x={2} y={12} w={2} h={1} c={P.n} />
      <Px x={12} y={12} w={2} h={1} c={P.n} />
      <Px x={3} y={5} w={1} h={3} c={P.w} />
      <Px x={2} y={6} w={3} h={1} c={P.w} />
      <Px x={12} y={5} w={2} h={2} c={P.y} />
      <Px x={10} y={7} w={2} h={2} c={P.R} />
    </>,
    size,
  );

/** A raised grey plate with a red flag on it - Mines. */
const MinesPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={1} y={1} w={14} h={14} c={P.k} />
      <Px x={2} y={2} w={12} h={12} c={P.s} />
      <Px x={2} y={2} w={12} h={1} c={P.w} />
      <Px x={2} y={2} w={1} h={12} c={P.w} />
      <Px x={2} y={13} w={12} h={1} c={P.d} />
      <Px x={13} y={2} w={1} h={12} c={P.d} />
      <Px x={7} y={4} w={1} h={8} c={P.k} />
      <Px x={5} y={11} w={5} h={1} c={P.k} />
      <Px x={8} y={4} w={4} h={1} c={P.R} />
      <Px x={8} y={5} w={5} h={2} c={P.R} />
      <Px x={8} y={7} w={3} h={1} c={P.R} />
    </>,
    size,
  );

/** A white card with a red heart on green baize - Solitaire. */
const SolitairePx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={0} y={1} w={16} h={14} c={P.k} />
      <Px x={1} y={2} w={14} h={12} c={P.g} />
      <Px x={4} y={3} w={8} h={10} c={P.k} />
      <Px x={5} y={4} w={6} h={8} c={P.w} />
      <Px x={6} y={6} w={1} h={2} c={P.R} />
      <Px x={9} y={6} w={1} h={2} c={P.R} />
      <Px x={7} y={7} w={2} h={2} c={P.R} />
      <Px x={6} y={8} w={4} h={1} c={P.R} />
      <Px x={7} y={9} w={2} h={1} c={P.R} />
    </>,
    size,
  );

/** A green snake bending across a black screen towards a red dot - Snake. */
const SnakePx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={0} y={0} w={16} h={16} c={P.k} />
      <Px x={2} y={11} w={7} h={2} c={P.G} />
      <Px x={7} y={7} w={2} h={4} c={P.G} />
      <Px x={7} y={7} w={6} h={2} c={P.G} />
      <Px x={11} y={3} w={2} h={4} c={P.G} />
      <Px x={11} y={3} w={2} h={2} c={P.l} />
      <Px x={12} y={3} w={1} h={1} c={P.k} />
      <Px x={3} y={3} w={2} h={2} c={P.R} />
    </>,
    size,
  );

/** Green shield with a keyhole - the hack runner. */
const HackPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={2} y={1} w={12} h={9} c={P.k} />
      <Px x={3} y={10} w={10} h={2} c={P.k} />
      <Px x={5} y={12} w={6} h={2} c={P.k} />
      <Px x={7} y={14} w={2} h={1} c={P.k} />
      <Px x={3} y={2} w={10} h={1} c={P.G} />
      <Px x={3} y={3} w={10} h={6} c={P.g} />
      <Px x={4} y={9} w={8} h={2} c={P.g} />
      <Px x={6} y={11} w={4} h={2} c={P.g} />
      <Px x={7} y={4} w={2} h={1} c={P.k} />
      <Px x={6} y={5} w={4} h={2} c={P.k} />
      <Px x={7} y={7} w={2} h={3} c={P.k} />
    </>,
    size,
  );

/** CRT monitor on a stand - the generic "system" icon. */
const SystemPx = ({ size = 32 }: IconProps) =>
  grid(
    <>
      <Px x={1} y={1} w={14} h={10} c={P.k} />
      <Px x={2} y={2} w={12} h={8} c={P.s} />
      <Px x={3} y={3} w={10} h={6} c={P.t} />
      <Px x={5} y={4} w={6} h={3} c={P.w} />
      <Px x={5} y={4} w={6} h={1} c={P.n} />
      <Px x={7} y={11} w={2} h={2} c={P.d} />
      <Px x={4} y={13} w={8} h={2} c={P.k} />
      <Px x={5} y={13} w={6} h={1} c={P.s} />
    </>,
    size,
  );

const APP_PX: Record<Exclude<WinApp, `ext:${string}`> | 'system', (p: IconProps) => ReactElement> = {
  mail: MailPx,
  logs: LogsPx,
  cmd: CmdPx,
  boss: BossPx,
  notepad: NotepadPx,
  calculator: CalculatorPx,
  settings: SettingsPx,
  messages: MessagesPx,
  notes: NotesPx,
  files: FilesPx,
  cameras: CamerasPx,
  board: BoardPx,
  bank: BankPx,
  photos: PhotosPx,
  contacts: ContactsPx,
  phonelink: PhoneLinkPx,
  browser: BrowserPx,
  games: GamesPx,
  mines: MinesPx,
  solitaire: SolitairePx,
  snake: SnakePx,
  hack: HackPx,
  system: SystemPx,
};

/** An app's pixel icon (16-grid, so use multiples of 16 for crisp pixels). */
export function PixelAppIcon({ app, size = 32 }: { app: WinApp | 'system'; size?: number }) {
  if (isExt(app)) return <ExtIcon app={app} size={size} look="pixel" />;
  const Icon = APP_PX[app] ?? SystemPx;
  return <Icon size={size} />;
}

// ── The SD OS mark, pixelated ───────────────────────────────────────────────

const MARK_STOPS = ['#3fe0d0', '#4f8dff', '#8b5cff'];

/**
 * Pixel runs for the mark on an n x n grid: rounded tile filled with a diagonal teal -> blue -> violet
 * ramp (5 bands: solid, dither, solid, dither, solid), an orbit ring open on the right, and the
 * satellite dot sitting in the gap.
 */
function markRuns(n: number): { x: number; y: number; w: number; c: string }[] {
  const c = n / 2;
  const ringR = n * 0.3;
  const half = n * 0.055 + 0.2;
  const corner = Math.max(1.5, n / 5);
  const dotA = (-12 * Math.PI) / 180;
  const dotX = c + ringR * 0.9 * Math.cos(dotA);
  const dotY = c + ringR * 0.9 * Math.sin(dotA);
  const dotR = Math.max(1.05, n * 0.07);
  const runs: { x: number; y: number; w: number; c: string }[] = [];
  for (let y = 0; y < n; y++) {
    let cur: { x: number; y: number; w: number; c: string } | null = null;
    for (let x = 0; x < n; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const qx = Math.min(Math.max(px, corner), n - corner);
      const qy = Math.min(Math.max(py, corner), n - corner);
      let col: string | null = null;
      if (Math.hypot(px - qx, py - qy) <= corner + 0.15) {
        const dx = px - c;
        const dy = py - c;
        const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
        const onRing = Math.abs(Math.hypot(dx, dy) - ringR) <= half && !(ang > -42 && ang < 24);
        const onDot = Math.hypot(px - dotX, py - dotY) <= dotR;
        if (onRing || onDot) col = '#ffffff';
        else {
          const band = Math.min(4, Math.floor(((x + y) / (2 * n - 2)) * 5));
          const odd = (x + y) % 2 === 1;
          col = band === 0 ? MARK_STOPS[0] : band === 1 ? (odd ? MARK_STOPS[1] : MARK_STOPS[0]) : band === 2 ? MARK_STOPS[1] : band === 3 ? (odd ? MARK_STOPS[2] : MARK_STOPS[1]) : MARK_STOPS[2];
        }
      }
      if (cur && col === cur.c) cur.w++;
      else {
        if (cur) runs.push(cur);
        cur = col ? { x, y, w: 1, c: col } : null;
      }
    }
    if (cur) runs.push(cur);
  }
  return runs;
}

const MARK_CACHE = new Map<number, ReactElement[]>();

/** The SD OS mark as pixel art. `grid` 16 for small/menu use, 24 for the splash. */
export function PixelMark({ size = 32, grid: n = 16 }: { size?: number; grid?: number }) {
  let rects = MARK_CACHE.get(n);
  if (!rects) {
    rects = markRuns(n).map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.c} />);
    MARK_CACHE.set(n, rects);
  }
  return grid(rects, size, n);
}

// ── Message box icons ───────────────────────────────────────────────────────

/** Red stop disc with a white cross - errors. */
export const IconStop = ({ size = 32 }: IconProps) => {
  const px: ReactElement[] = [];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 8;
      const dy = y + 0.5 - 8;
      const d = Math.hypot(dx, dy);
      if (d > 7.6) continue;
      const cross = d < 4.8 && Math.abs(Math.abs(dx) - Math.abs(dy)) < 1.1;
      px.push(<Px key={`${x},${y}`} x={x} y={y} c={d > 6.6 ? P.k : cross ? P.w : P.r} />);
    }
  return grid(px, size);
};

/** White disc with a navy "i" - information. */
export const IconInfo = ({ size = 32 }: IconProps) => {
  const px: ReactElement[] = [];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
      if (d > 7.6) continue;
      px.push(<Px key={`${x},${y}`} x={x} y={y} c={d > 6.6 ? P.k : P.w} />);
    }
  return grid(
    <>
      {px}
      <Px x={7} y={3} w={2} h={2} c={P.n} />
      <Px x={6} y={6} w={3} h={1} c={P.n} />
      <Px x={7} y={7} w={2} h={5} c={P.n} />
      <Px x={6} y={12} w={4} h={1} c={P.n} />
    </>,
    size,
  );
};

/** Yellow triangle with "!" - warnings. */
export const IconWarn = ({ size = 32 }: IconProps) =>
  grid(
    <>
      {Array.from({ length: 7 }, (_, i) => (
        <Px key={i} x={7 - i} y={1 + i * 2} w={2 + i * 2} h={2} c={P.k} />
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <Px key={`f${i}`} x={8 - i} y={3 + i * 2} w={i * 2} h={2} c={P.y} />
      ))}
      <Px x={7} y={5} w={2} h={5} c={P.k} />
      <Px x={7} y={11} w={2} h={2} c={P.k} />
    </>,
    size,
  );

// ── Window glyphs (title bar boxes) ─────────────────────────────────────────

export const GlyphSys = () => (
  <svg className="rt-glyph" width="13" height="5" viewBox="0 0 13 5" shapeRendering="crispEdges" aria-hidden>
    <rect x="0" y="0" width="12" height="4" fill="#ffffff" stroke="#000000" strokeWidth="1" transform="translate(0.5 0.5)" />
    <rect x="1" y="4" width="12" height="1" fill="#000000" opacity="0.55" />
  </svg>
);
export const GlyphMin = () => (
  <svg className="rt-glyph" width="9" height="9" viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden>
    <path d="M4.5 7 L1 3 L8 3 Z" fill="#000" />
  </svg>
);
export const GlyphMax = () => (
  <svg className="rt-glyph" width="9" height="9" viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden>
    <path d="M4.5 2 L8 6 L1 6 Z" fill="#000" />
  </svg>
);
export const GlyphRestore = () => (
  <svg className="rt-glyph" width="9" height="11" viewBox="0 0 9 11" shapeRendering="crispEdges" aria-hidden>
    <path d="M4.5 0.5 L7.5 4 L1.5 4 Z" fill="#000" />
    <path d="M4.5 10.5 L1.5 7 L7.5 7 Z" fill="#000" />
  </svg>
);
