import type { OpenPayload, OsStyle } from '@/types';
import { withPhoneLink } from './phonelink';
import { withExtApps } from './ext';

/** What session.open returns for the MRPD front desk, as a police boss - the browser dev payload. */
export const mockPayload: OpenPayload = {
  computer: {
    id: 'mrpd_frontdesk',
    label: 'MRPD Front Desk',
    hostname: 'LSPD-MRPD-FD01',
    ip: '10.42.17.88',
    instance: 'mrpd_frontdesk',
    style: 'modern',
    requiresPin: true,
    lockedFor: 0,
    apps: [
      { id: 'mail', label: 'Mail', w: 1060, h: 660 },
      { id: 'messages', label: 'Messages', w: 920, h: 620 },
      { id: 'notes', label: 'Notes', w: 860, h: 580 },
      { id: 'boss', label: 'Business Manager', w: 1100, h: 680 },
      { id: 'logs', label: 'Event Viewer', w: 1040, h: 620 },
      { id: 'cmd', label: 'Command Prompt', w: 900, h: 540 },
      { id: 'notepad', label: 'Notepad', w: 820, h: 560 },
      { id: 'calculator', label: 'Calculator', w: 340, h: 520 },
      { id: 'files', label: 'Files', w: 1180, h: 740 },
      { id: 'browser', label: 'Browser', w: 1100, h: 700 },
      { id: 'bank', label: 'Bank', w: 940, h: 640 },
      { id: 'board', label: 'Company Board', w: 940, h: 620 },
      { id: 'cameras', label: 'Security Cameras', w: 900, h: 600 },
      { id: 'photos', label: 'Photos', w: 980, h: 640 },
      { id: 'contacts', label: 'Contacts', w: 860, h: 600 },
      { id: 'phonelink', label: 'Phone Link', w: 620, h: 700 },
      { id: 'games', label: 'Games', w: 860, h: 640 },
      { id: 'settings', label: 'Settings', w: 900, h: 600 },
    ],
    pinned: ['mail', 'messages', 'browser', 'files', 'boss', 'cmd', 'logs', 'notepad'],
    desktopIcons: ['mail', 'messages', 'notes', 'files', 'browser', 'bank', 'board', 'boss', 'cameras', 'photos', 'contacts', 'phonelink', 'logs', 'cmd', 'notepad', 'calculator', 'games', 'settings'],
  },
  user: { name: 'Jessica Hale', initials: 'JH', job: 'LSPD' },
  desktop: {
    style: 'modern',
    monitor: false,
    sounds: true,
    osName: 'SD OS Pro',
    osBuild: '4.2.2610',
    boot: true,
    clock24: false,
    wallpapers: [
      { id: 'petals-dark', label: 'Petals (dark)' },
      { id: 'petals-light', label: 'Petals (light)' },
      { id: 'nebula', label: 'Nebula' },
      { id: 'dusk', label: 'Dusk' },
      { id: 'currents', label: 'Currents' },
      { id: 'solid', label: 'Solid colour' },
    ],
    accents: ['#4cc2ff', '#60cdff', '#7a7dff', '#c239b3', '#e74856', '#ff8c00', '#16c60c', '#00b7c3'],
    defaultWallpaper: 'petals-dark',
    defaultTheme: 'dark',
  },
  settings: {},
  hacks: {
    practice: true,
    defaultDifficulty: 'medium',
    games: {
      maze: { program: 'net-maze.exe', label: 'Network Maze' },
      capture: { program: 'node-grab.exe', label: 'Node Capture' },
      cipher: { program: 'cipher-lock.exe', label: 'Cipher Lock' },
      snake: { program: 'data-worm.exe', label: 'Data Worm' },
      firewall: { program: 'fw-defense.exe', label: 'Firewall Defense' },
      evasion: { program: 'highway-evade.exe', label: 'Highway Evasion' },
      typing: { program: 'code-inject.exe', label: 'Code Injection' },
      signal: { program: 'sig-replay.exe', label: 'Signal Replay' },
      pipe: { program: 'pipe-route.exe', label: 'Packet Routing' },
      breakout: { program: 'ice-break.exe', label: 'ICE Breaker' },
    },
  },
  mail: { domain: 'lsmail.com', maxRecipients: 20, maxSubject: 200, maxBody: 10000, minPassword: 6, maxDisplayName: 40 },
};

/** Each style's desktop block, mirroring configs/shared/desktop.lua Styles. */
const STYLE_DESKTOP: Record<OsStyle, Partial<OpenPayload['desktop']>> = {
  modern: {},
  retro: {
    osName: 'SD Desktop',
    osBuild: '3.11',
    wallpapers: [
      { id: 'retro-teal', label: 'Teal' },
      { id: 'retro-weave', label: 'Weave' },
      { id: 'retro-bricks', label: 'Bricks' },
      { id: 'retro-starfield', label: 'Starfield' },
      { id: 'retro-navy', label: 'Midnight' },
    ],
    defaultWallpaper: 'retro-teal',
    accents: ['#000080', '#008080', '#800000', '#008000', '#800080', '#404040'],
    defaultTheme: 'light',
    monitor: true,
    sounds: true,
  },
  mac: {
    osName: 'SD OS Harbor',
    osBuild: '2.6',
    wallpapers: [
      { id: 'harbor-dunes', label: 'Dunes' },
      { id: 'harbor-tide', label: 'Tide' },
      { id: 'harbor-aurora', label: 'Aurora' },
      { id: 'harbor-graphite', label: 'Graphite' },
    ],
    defaultWallpaper: 'harbor-dunes',
    accents: ['#0a84ff', '#bf5af2', '#ff375f', '#ff9f0a', '#ffd60a', '#30d158', '#8e8e93'],
    defaultTheme: 'light',
  },
};

/**
 * The dev payload in a given style (browser: ?style=retro / ?style=mac), with the phone's apps on
 * it or not as the Phone Link mock has the machine (?phonelink=new: not linked yet).
 */
export function mockPayloadFor(style: OsStyle): OpenPayload {
  return withExtApps(
    withPhoneLink({
      ...mockPayload,
      computer: { ...mockPayload.computer, style },
      desktop: { ...mockPayload.desktop, ...STYLE_DESKTOP[style], style },
    }),
  );
}

/** The mock PIN for the browser dev payload's requiresPin lock screen. */
export const MOCK_PIN = '1031';
