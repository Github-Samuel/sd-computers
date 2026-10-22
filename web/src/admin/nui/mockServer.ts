import type { Auto, Camera, Computer, Job, Placed, Printer, Prop, Reply, Snapshot } from '@/admin/types';

// The panel in a browser tab (npm run dev -> /admin.html): a stand-in for the game and the server,
// so every tab, dialog and toast can be worked on without either. Placing "runs the gizmo" by
// hiding the panel for a moment, then bringing it back with the computer placed.

let nextId = 4;

let computers: Computer[] = [
  { key: 'mrpd_frontdesk', order: 1, source: 'config', label: 'MRPD Front Desk', hostname: 'LSPD-MRPD-FD01', style: 'retro', styleSet: true, x: 441.2, y: -978.9, z: 30.9, heading: 0, groups: { police: 0 }, boss: 'police', pin: true, users: ['Jessica Hale'] },
  { key: 'pillbox_reception', order: 2, source: 'config', label: 'Pillbox Reception', hostname: 'PILLBOX-RECEP01', style: 'modern', styleSet: true, x: 310.9, y: -597.4, z: 43.4, heading: 340, groups: { ambulance: 0 }, boss: 'ambulance', pin: false, users: [] },
  {
    key: 'public_pc', order: 3, source: 'model', label: 'Computer', hostname: 'LS-WORKSTATION', style: 'modern', styleSet: false, pin: false, users: ['Mike Rodriguez', 'Ana Flores'],
    models: ['prop_monitor_01a', 'prop_monitor_01b', 'prop_monitor_02', 'prop_monitor_03b', 'prop_monitor_w_large', 'prop_monitor_04a', 'ex_prop_monitor_01_ex', 'v_serv_ct_monitor01'],
  },
  { key: 'business_laptop', order: 4, source: 'model', label: 'Business Laptop', hostname: 'BIZ-LAPTOP', style: 'mac', styleSet: true, boss: '*', pin: false, users: [], models: ['prop_laptop_01a', 'p_laptop_02_s', 'prop_laptop_lester', 'prop_laptop_lester2'] },
  { key: 'placed_1', order: 5, id: 1, source: 'placed', label: 'Mechanic office', hostname: 'MECHANIC-OFF-01', style: 'mac', styleSet: true, prop: 'prop_laptop_01a', x: -339.6, y: -156.9, z: 39.8, heading: 87, groups: { mechanic: 2 }, boss: 'mechanic', pin: false, users: [] },
  { key: 'placed_2', order: 6, id: 2, source: 'placed', label: 'Vanilla Unicorn back room', hostname: 'VANILLA-UNIC-02', style: 'modern', styleSet: false, prop: 'prop_monitor_01a', x: 95.4, y: -1294.1, z: 29.6, heading: 211.5, pin: false, users: ['Devon Price'] },
  { key: 'placed_3', order: 7, id: 3, source: 'world', label: 'Booking desk', hostname: 'BOOKING-DESK-03', style: 'retro', styleSet: true, prop: 'prop_monitor_03b', x: 461.0, y: -988.4, z: 24.8, heading: 300, groups: { police: 0 }, pin: false, users: [] },
  { key: 'house_14_desk', order: 8, source: 'script', resource: 'sd-housing', label: 'Home office', hostname: 'HOME-OFFICE', style: 'mac', styleSet: true, prop: 'prop_laptop_01a', x: -174.3, y: 502.6, z: 137.4, heading: 190, pin: true, users: [] },
];

// The printers: stood from the panel, or picked.
let nextPrinter = 3;
let printers: Printer[] = [
  { id: 1, label: 'Front desk printer', prop: 'prop_printer_01', x: 443.1, y: -980.2, z: 30.7, heading: 90, waiting: 3 },
  { id: 2, label: 'Records room copier', prop: 'prop_copier_01', world: true, x: 452.6, y: -985.9, z: 30.7, heading: 180, waiting: 0 },
];
const PRINTER_PROPS = [
  { model: 'prop_printer_01', label: 'Laser printer' },
  { model: 'prop_printer_02', label: 'Desktop printer' },
  { model: 'v_res_printer', label: 'Home printer' },
  { model: 'prop_copier_01', label: 'Photocopier' },
];

// The security cameras: the config's, then the ones put up from the panel.
let nextCamera = 3;
let cameras: Camera[] = [
  { key: 'mrpd_lobby', source: 'config', label: 'Lobby', area: 'Mission Row Police Station', x: 435.7, y: -987.5, z: 33.8, pitch: -20, yaw: -32, fov: 70, groups: { police: 0 } },
  { key: 'mrpd_entrance', source: 'config', label: 'Front entrance', area: 'Mission Row Police Station', x: 433.4, y: -976.6, z: 34.3, pitch: -24, yaw: 150, fov: 75, groups: { police: 0 } },
  { key: 'pillbox_reception', source: 'config', label: 'Reception', area: 'Pillbox Hill Medical Center', x: 303.9, y: -590.6, z: 46.0, pitch: -22, yaw: -145, fov: 70, groups: { ambulance: 0 }, computers: ['pillbox_reception'] },
  { key: 'placed_cam_1', id: 1, source: 'placed', label: 'Workshop floor', area: "Benny's Original Motor Works", x: -211.4, y: -1324.8, z: 34.2, pitch: -28, yaw: 96, fov: 80, groups: { mechanic: 2 } },
  { key: 'placed_cam_2', id: 2, source: 'placed', label: 'Legion Square', area: null, x: 190.2, y: -938.6, z: 38.9, pitch: -15, yaw: -60, fov: 60 },
];

// The props that are a computer on their own, as the Automatic tab has them.
let auto: Auto = {
  enabled: true,
  computers: computers
    .filter(c => c.source === 'model')
    .map(c => ({ key: c.key, label: c.label, enabled: true, base: c.styleSet ? c.style : null, models: (c.models ?? []).map(model => ({ model, on: true, own: true })) })),
};
const autoModels = (key: string) => auto.computers.find(a => a.key === key);

// The props a computer can be placed as: the config's, then the ones added from the panel.
let props: Prop[] = [
  { model: 'prop_monitor_01a', label: 'Flat monitor', kind: 'monitor' },
  { model: 'prop_monitor_01b', label: 'Flat monitor (off)', kind: 'monitor' },
  { model: 'prop_monitor_02', label: 'HD monitor', kind: 'monitor' },
  { model: 'prop_monitor_03b', label: 'CRT monitor', kind: 'monitor' },
  { model: 'prop_monitor_w_large', label: 'Widescreen monitor', kind: 'monitor' },
  { model: 'prop_monitor_04a', label: 'Widescreen monitor (browser)', kind: 'monitor' },
  { model: 'ex_prop_monitor_01_ex', label: 'All-in-one', kind: 'monitor' },
  { model: 'v_serv_ct_monitor01', label: 'Control room monitor', kind: 'monitor' },
  { model: 'prop_laptop_01a', label: 'Laptop', kind: 'laptop' },
  { model: 'p_laptop_02_s', label: 'Laptop (white keys)', kind: 'laptop' },
  { model: 'prop_laptop_lester', label: 'Laptop (browsing)', kind: 'laptop' },
  { model: 'prop_laptop_lester2', label: 'Laptop (idle)', kind: 'laptop' },
  { model: 'xm_prop_x17_laptop_lester_01', label: 'Gaming laptop', kind: 'laptop' },
];

// Which props have a screen: every one the config ships has one measured; one added from the panel
// has none until it is drawn.
let screens: Snapshot['screens'] = Object.fromEntries(props.map(p => [p.model, 'config' as const]));

// The framework's jobs, by label (a job nobody is boss of cannot be given the Business Manager).
const jobs: Job[] = [
  { name: 'ambulance', label: 'EMS', boss: true },
  { name: 'bus', label: 'Bus', boss: false },
  { name: 'cardealer', label: 'Vehicle Dealer', boss: true },
  { name: 'unemployed', label: 'Civilian', boss: false },
  { name: 'judge', label: 'Honorary', boss: false },
  { name: 'lawyer', label: 'Law Firm', boss: true },
  { name: 'police', label: 'LSPD', boss: true },
  { name: 'mechanic', label: 'Mechanic', boss: true },
  { name: 'realestate', label: 'Real Estate', boss: true },
  { name: 'reporter', label: 'Reporter', boss: true },
  { name: 'bcso', label: 'Sheriff', boss: true },
  { name: 'taxi', label: 'Taxi', boss: true },
  { name: 'tow', label: 'Towing', boss: false },
].sort((a, b) => a.label.localeCompare(b.label));

export const mockSnapshot = (): Snapshot => ({
  canEdit: true,
  computers: computers.map((c, i) => {
    const a = c.source === 'model' ? autoModels(c.key) : undefined;
    const models = a ? a.models.filter(m => m.on).map(m => m.model) : c.models;
    return { ...c, order: i + 1, models, off: a ? !auto.enabled || !a.enabled || models?.length === 0 : undefined, style: a?.style ?? c.style, styleSet: a ? !!a.style || c.styleSet : c.styleSet };
  }),
  cameras: { enabled: true, max: 200, list: cameras },
  printers: { enabled: true, max: 200, range: 30, item: 'printed_document', props: PRINTER_PROPS, list: printers },
  props,
  screens,
  auto,
  styles: [
    { key: 'modern', name: 'SD OS Pro', build: '4.2.2610', wallpaper: 'petals-dark', accent: '#4cc2ff', theme: 'dark', wallpapers: ['Petals (dark)', 'Petals (light)', 'Nebula', 'Dusk', 'Currents', 'Solid colour'], default: true },
    { key: 'mac', name: 'SD OS Harbor', build: '2.6', wallpaper: 'harbor-dunes', accent: '#0a84ff', theme: 'light', wallpapers: ['Dunes', 'Tide', 'Aurora', 'Graphite'], default: false },
    { key: 'retro', name: 'SD Desktop', build: '3.11', wallpaper: 'retro-teal', accent: '#000080', theme: 'light', wallpapers: ['Teal', 'Weave', 'Bricks', 'Starfield', 'Midnight'], default: false },
  ],
  jobs,
  boss: { available: true },
  defaultStyle: 'modern',
  rules: { boot: true, reach: 2.5, maxLabel: 48 },
  refreshMs: 5000,
});

const ok = <T extends object>(data?: T): Reply<T & { snapshot: Snapshot }> => ({ success: true, data: { ...(data as T), snapshot: mockSnapshot() } });
const fail = (message: string): Reply<{ snapshot: Snapshot }> => ({ success: false, message, data: { snapshot: mockSnapshot() } });

const hostname = (label: string, id: number) => `${label.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 12).replace(/-+$/, '') || 'PC'}-${String(id).padStart(2, '0')}`;

type Fields = { id?: number; label?: string; prop?: string; style?: string | null; jobs?: Record<string, number> | null; boss?: string | null; key?: string; model?: string; enabled?: boolean; kind?: Prop['kind']; area?: string | null };

// What the game does around the camera tool: hide the panel, show its HUD for a moment, then bring
// the panel back with the outcome.
const afterCamtool = (moving: boolean, placed: Placed) => {
  window.postMessage({ action: 'computers:admin:hide' }, '*');
  window.postMessage({ action: 'computers:camtool:hud', data: { active: true, moving, x: 190.2, y: -938.6, z: 38.9, pitch: -18, yaw: -60, fov: 62.5 } }, '*');
  window.setTimeout(() => {
    window.postMessage({ action: 'computers:camtool:hud', data: { active: false } }, '*');
    window.postMessage({ action: 'computers:admin:show', data: { snapshot: mockSnapshot(), placed } }, '*');
  }, 2500);
};

const applyFields = (c: Computer, d: Fields): Computer => ({
  ...c,
  label: d.label ?? c.label,
  hostname: d.label && d.label !== c.label ? hostname(d.label, c.id ?? 0) : c.hostname,
  prop: c.source === 'world' ? c.prop : (d.prop ?? c.prop), // (a picked prop is the game's: it stays what it is)
  style: d.style || 'modern',
  styleSet: !!d.style,
  groups: d.jobs ?? null,
  boss: d.boss ?? null,
});

// What the game does around the gizmo: hide the panel, then show it again with the outcome.
const afterGizmo = (placed: Placed) => {
  window.postMessage({ action: 'computers:admin:hide' }, '*');
  window.setTimeout(() => window.postMessage({ action: 'computers:admin:show', data: { snapshot: mockSnapshot(), placed } }, '*'), 900);
};

export async function mockNui(callback: string, data: unknown): Promise<unknown> {
  await new Promise(resolve => window.setTimeout(resolve, 140));
  const d = (data ?? {}) as Fields;
  switch (callback.replace('computers:admin:', '')) {
    case 'snapshot':
      return ok();
    case 'close':
      // (a browser tab has nowhere to close to: come straight back, as reopening it in the game would)
      window.setTimeout(() => window.postMessage({ action: 'computers:admin:open', data: { snapshot: mockSnapshot() } }, '*'), 700);
      return { ok: true };
    case 'teleport':
      return ok();
    case 'updatecomputer': {
      const c = computers.find(x => x.id === d.id);
      if (!c) return fail('That no longer exists');
      computers = computers.map(x => (x === c ? applyFields(c, d) : x));
      return ok();
    }
    case 'deletecomputer':
      if (!computers.some(x => x.id === d.id)) return fail('That no longer exists');
      computers = computers.filter(x => x.id !== d.id);
      return ok();
    case 'removeconfigcomputer':
    case 'restoreconfigcomputer': {
      // (one of the config's locations: taken away, or put back - it stays in the list either way)
      const c = computers.find(x => x.key === d.key && x.source === 'config');
      if (!c) return fail('That no longer exists');
      const removed = callback.endsWith('removeconfigcomputer');
      computers = computers.map(x => (x === c ? { ...c, removed, users: removed ? [] : c.users } : x));
      return ok();
    }
    case 'teleportcamera':
    case 'teleportprinter':
      return ok();
    case 'placeprinter':
    case 'pickprinter': {
      const id = nextPrinter++;
      const world = callback.endsWith('pickprinter');
      printers = [...printers, { id, label: d.label || 'Printer', prop: world ? 'prop_printer_02' : (d.prop ?? 'prop_printer_01'), world: world || undefined, x: 120.5 + id * 3.1, y: -1040.2 - id * 2.4, z: 29.3, heading: (id * 47) % 360, waiting: 0 }];
      afterGizmo({ what: 'printer', action: world ? 'picked' : 'placed', success: true });
      return { ok: true };
    }
    case 'moveprinter': {
      printers = printers.map(p => (p.id === d.id ? { ...p, x: p.x + 1.5, heading: (p.heading + 90) % 360 } : p));
      afterGizmo({ what: 'printer', action: 'moved', success: true });
      return { ok: true };
    }
    case 'updateprinter': {
      const p = printers.find(x => x.id === d.id);
      if (!p) return fail('That no longer exists');
      printers = printers.map(x => (x === p ? { ...p, label: d.label ?? p.label, prop: p.world ? p.prop : (d.prop ?? p.prop) } : x));
      return ok();
    }
    case 'deleteprinter':
      if (!printers.some(x => x.id === d.id)) return fail('That no longer exists');
      printers = printers.filter(x => x.id !== d.id);
      return ok();
    case 'placecamera': {
      const id = nextCamera++;
      cameras = [...cameras, { key: `placed_cam_${id}`, id, source: 'placed', label: d.label || 'Camera', area: d.area || null, x: 120.5 + id * 3.1, y: -1040.2 - id * 2.4, z: 33.3, pitch: -18, yaw: (id * 47) % 360 - 180, fov: 62.5, groups: d.jobs ?? null }];
      afterCamtool(false, { what: 'camera', action: 'placed', success: true });
      return { ok: true };
    }
    case 'movecamera': {
      cameras = cameras.map(c => (c.id === d.id ? { ...c, x: c.x + 1.5, pitch: -18, fov: 62.5 } : c));
      afterCamtool(true, { what: 'camera', action: 'moved', success: true });
      return { ok: true };
    }
    case 'updatecamera': {
      const c = cameras.find(x => x.id === d.id && x.source === 'placed');
      if (!c) return fail('That no longer exists');
      cameras = cameras.map(x => (x === c ? { ...c, label: d.label ?? c.label, area: d.area || null, groups: d.jobs ?? null } : x));
      return ok();
    }
    case 'deletecamera':
      if (!cameras.some(x => x.id === d.id && x.source === 'placed')) return fail('That no longer exists');
      cameras = cameras.filter(x => x.id !== d.id);
      return ok();
    case 'removeconfigcamera':
    case 'restoreconfigcamera': {
      // (one of the config's cameras: taken away, or put back - it stays in the list either way)
      const c = cameras.find(x => x.key === d.key && x.source === 'config');
      if (!c) return fail('That no longer exists');
      cameras = cameras.map(x => (x === c ? { ...c, removed: callback.endsWith('removeconfigcamera') } : x));
      return ok();
    }
    case 'deleteallcomputers': {
      const count = computers.filter(x => x.source === 'placed' || x.source === 'world').length;
      computers = computers.filter(x => x.source !== 'placed' && x.source !== 'world');
      return ok({ count });
    }
    case 'placecomputer': {
      const id = nextId++;
      const base: Computer = { key: `placed_${id}`, order: 0, id, source: 'placed', label: 'Computer', hostname: '', style: 'modern', styleSet: false, x: 120.5 + id * 3.1, y: -1040.2 - id * 2.4, z: 29.3, heading: (id * 47) % 360, pin: false, users: [] };
      computers = [...computers, applyFields({ ...base, hostname: hostname(d.label ?? 'Computer', id) }, d)];
      afterGizmo({ what: 'computer', action: 'placed', success: true });
      return { ok: true };
    }
    case 'pickcomputer': {
      // (the admin "aimed at" a widescreen monitor somewhere)
      const id = nextId++;
      const base: Computer = { key: `placed_${id}`, order: 0, id, source: 'world', label: 'Computer', hostname: '', style: 'modern', styleSet: false, prop: 'prop_monitor_w_large', x: 446.9, y: -974.7 - id, z: 30.4, heading: 165, pin: false, users: [] };
      computers = [...computers, applyFields({ ...base, hostname: hostname(d.label ?? 'Computer', id) }, { ...d, prop: undefined })];
      afterGizmo({ what: 'computer', action: 'picked', success: true });
      return { ok: true };
    }
    case 'setauto':
      auto = { ...auto, enabled: d.enabled === true };
      return ok();
    case 'setautocomputer':
      if (!autoModels(d.key ?? '')) return fail('That no longer exists');
      auto = { ...auto, computers: auto.computers.map(a => (a.key === d.key ? { ...a, enabled: d.enabled === true } : a)) };
      return ok();
    case 'setautomodel':
      if (!autoModels(d.key ?? '')?.models.some(m => m.model === d.model)) return fail('That request made no sense');
      auto = { ...auto, computers: auto.computers.map(a => (a.key === d.key ? { ...a, models: a.models.map(m => (m.model === d.model ? { ...m, on: d.enabled === true } : m)) } : a)) };
      return ok();
    case 'setautostyle':
      if (!autoModels(d.key ?? '')) return fail('That no longer exists');
      auto = { ...auto, computers: auto.computers.map(c => (c.key === d.key ? { ...c, style: d.style || null } : c)) };
      return ok();
    case 'setautomodelstyle':
      auto = { ...auto, computers: auto.computers.map(c => (c.key === d.key ? { ...c, models: c.models.map(m => (m.model === d.model ? { ...m, style: d.style || null } : m)) } : c)) };
      return ok();
    case 'addprop': {
      if (!d.model || props.some(x => x.model === d.model)) return fail('That prop is already on the list');
      if (d.model.includes('nope')) return fail(`The game has no prop called ${d.model}`);
      props = [...props, { model: d.model, label: d.label || d.model, kind: d.kind, custom: true }];
      // (a prop nobody lists is offered to every model computer, off)
      auto = { ...auto, computers: auto.computers.map(c => ({ ...c, models: [...c.models, { model: d.model!, on: false, own: false }] })) };
      return ok();
    }
    case 'removeprop':
      if (computers.some(x => x.prop === d.model)) return fail('A computer is placed as that prop - delete it first');
      props = props.filter(x => !(x.custom && x.model === d.model));
      auto = { ...auto, computers: auto.computers.map(c => ({ ...c, models: c.models.filter(m => m.own || m.model !== d.model) })) };
      return ok();
    case 'setupscreen': {
      // (the screen tool: its HUD shows over nothing here, for as long as a quick drawing takes)
      const label = props.find(x => x.model === d.model)?.label ?? d.model;
      window.postMessage({ action: 'computers:admin:hide' }, '*');
      window.postMessage(
        { action: 'computers:screener:hud', data: { active: true, label, model: d.model, x: -0.0015, y: -0.066, z: 0.313, w: 0.429, h: 0.315, tilt: 4.9, heading: 0, drawn: true, over: 'resize', view: 'front', picture: true, canUndo: true } },
        '*',
      );
      window.setTimeout(() => {
        screens = { ...screens, [d.model!]: 'custom' };
        window.postMessage({ action: 'computers:screener:hud', data: { active: false } }, '*');
        window.postMessage({ action: 'computers:admin:show', data: { snapshot: mockSnapshot(), placed: { what: 'screen', action: 'saved', success: true } } }, '*');
      }, 2500);
      return { ok: true };
    }
    case 'resetscreen': {
      if (screens[d.model ?? ''] !== 'custom') return fail('That no longer exists');
      const { [d.model!]: _, ...rest } = screens;
      // (one of the config's props goes back to the screen the config has for it; one added here to none)
      screens = props.some(x => x.model === d.model && !x.custom) ? { ...rest, [d.model!]: 'config' } : rest;
      return ok();
    }
    case 'movecomputer': {
      computers = computers.map(x => (x.id === d.id ? { ...x, x: (x.x ?? 0) + 1.25, heading: ((x.heading ?? 0) + 15) % 360 } : x));
      afterGizmo({ what: 'computer', action: 'moved', success: true });
      return { ok: true };
    }
    default:
      return fail(`Unknown verb ${callback}`);
  }
}
