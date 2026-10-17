/// <reference types="vite/client" />
import type { AppDef, OpenPayload, RpcResult } from '@/types';
import type { MockHandler } from './index';

// Custom apps in the browser dev server: the example app (examples/wrenchworks), its page served
// by vite.config.ts at /ext/wrenchworks/, and a stand-in for its server endpoints and for the
// custom-app endpoints of server/computers/appapi.lua. Dev server only: a built page has no
// example to frame.

const WRENCHWORKS: AppDef = {
  id: 'ext:wrenchworks',
  label: 'Wrenchworks',
  w: 1120,
  h: 720,
  resizable: true,
  ext: {
    id: 'wrenchworks',
    resource: 'wrenchworks',
    ui: '/ext/wrenchworks/index.html',
    icon: '/ext/wrenchworks/icon.svg',
    color: '#f2711c',
    description: 'Work orders for your garage: what is in, what it needs, and what it costs.',
    developer: 'Wrenchworks Software',
    version: '1.0.0',
  },
};

/** The dev payload with the example app on it (pinned and on the desktop, with a count on its icon). */
export function withExtApps(p: OpenPayload): OpenPayload {
  if (!import.meta.env.DEV) return p;
  return {
    ...p,
    computer: {
      ...p.computer,
      apps: [...p.computer.apps, WRENCHWORKS],
      pinned: [...p.computer.pinned, WRENCHWORKS.id],
      desktopIcons: [...p.computer.desktopIcons, WRENCHWORKS.id],
      badges: { [WRENCHWORKS.id]: 2 },
    },
  };
}

interface Order {
  id: number;
  plate: string;
  model: string;
  customer: string;
  contact?: string;
  work: string;
  quote: number;
  status: 'open' | 'progress' | 'done';
  color?: string;
  photo?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  closedBy?: string;
}

// (not index.ts's ok/fail: the dev payload reaches this file before index.ts has finished loading)
const ok = <T>(data?: T): RpcResult<T> => ({ ok: true, data });
const fail = (error: string): RpcResult<never> => ({ ok: false, error });

const now = () => Math.floor(Date.now() / 1000);
const ME = 'Jessica Hale';

let nextId = 15;
let orders: Order[] = [
  { id: 14, plate: '46EEK572', model: 'Sultan RS', customer: 'Franklin C.', contact: 'franklin@lsmail.com', work: 'Front bumper replaced, respray in candy red, check the brakes - pulling to the left.', quote: 3450, status: 'open', color: '#e5484d', createdBy: 'Lamar Davis', createdAt: now() - 1500, updatedAt: now() - 1500 },
  { id: 13, plate: '07ZXD118', model: 'Elegy RH8', customer: 'Tracey De Santa', contact: 'tracey@lsmail.com', work: 'Engine stage 3, turbo, new exhaust. Customer waiting in reception.', quote: 18200, status: 'progress', color: '#5aa9ff', createdBy: ME, createdAt: now() - 7600, updatedAt: now() - 3100 },
  { id: 12, plate: '82LSC004', model: 'Bison', customer: 'Walk-in', work: 'Two new rear tyres and an alignment.', quote: 640, status: 'open', createdBy: 'Lamar Davis', createdAt: now() - 9800, updatedAt: now() - 9800 },
  { id: 11, plate: '33KIF920', model: 'Banshee', customer: 'Wade H.', contact: 'wade@lsmail.com', work: 'Windscreen and both headlights after a run-in with a lamp post.', quote: 1180, status: 'done', createdBy: ME, createdAt: now() - 90000, updatedAt: now() - 60000, closedBy: ME },
];

/** What the server would push to every open Wrenchworks after a change. */
function changed(kind: string, order: Order): void {
  window.postMessage({ action: 'computers:app:message', data: { app: WRENCHWORKS.id, action: 'orders', data: { kind, order, by: ME, orders } } }, '*');
  window.postMessage({ action: 'computers:app:badge', data: { app: WRENCHWORKS.id, count: orders.filter(o => o.status !== 'done').length } }, '*');
}

const clean = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

const ENDPOINTS: Record<string, (data: Record<string, unknown>) => ReturnType<MockHandler>> = {
  'orders:list': () => ok({ orders, me: ME }),
  'orders:create': d => {
    const plate = clean(d.plate, 8);
    const work = clean(d.work, 600);
    if (!plate) return fail('A work order needs the plate.');
    if (!work) return fail('Say what is to be done.');
    const order: Order = {
      id: nextId++, plate: plate.toUpperCase(), model: clean(d.model, 32) ?? 'Unknown', customer: clean(d.customer, 48) ?? 'Walk-in',
      contact: clean(d.contact, 64), work, quote: Math.max(0, Math.floor(Number(d.quote) || 0)), status: 'open',
      photo: typeof d.photo === 'string' && d.photo.startsWith('https://') ? d.photo : undefined, createdBy: ME, createdAt: now(), updatedAt: now(),
    };
    orders = [order, ...orders];
    changed('created', order);
    return ok(order);
  },
  'orders:update': d => {
    const order = orders.find(o => o.id === Number(d.id));
    if (!order) return fail('That work order is gone.');
    if (d.status === 'open' || d.status === 'progress' || d.status === 'done') {
      order.closedBy = d.status === 'done' ? ME : undefined;
      order.status = d.status;
    }
    if (d.quote !== undefined) order.quote = Math.max(0, Math.floor(Number(d.quote) || 0));
    if (typeof d.photo === 'string') order.photo = d.photo;
    if (typeof d.color === 'string') order.color = d.color;
    order.updatedAt = now();
    changed('updated', order);
    return ok(order);
  },
  'orders:delete': d => {
    const order = orders.find(o => o.id === Number(d.id));
    if (order) {
      orders = orders.filter(o => o !== order);
      changed('deleted', order);
    }
    return ok(true);
  },
};

/** computer.storage, kept for the dev session: app|scope|key -> the JSON text. */
const stored = new Map<string, string>();

const handlers: Record<string, MockHandler> = {
  'app:call': p => {
    if (p.app !== 'wrenchworks') return fail('That app is not installed on this computer.');
    const fn = typeof p.endpoint === 'string' ? ENDPOINTS[p.endpoint] : undefined;
    if (!fn) return fail(`This app has no command called ${String(p.endpoint)}.`);
    return fn(p.data && typeof p.data === 'object' ? (p.data as Record<string, unknown>) : {});
  },
  'app:window': () => ok(),
  'app:badge': p => ok({ count: Number(p.count) || 0 }),
  'app:log': p => {
    console.info(`[mock] ${String(p.app)} wrote to the Event Viewer: ${String(p.message)}`);
    return ok();
  },
  'app:storage': p => {
    const prefix = `${String(p.app)}|${p.scope === 'computer' ? 'computer' : 'character'}|`;
    if (p.op === 'get') return ok({ value: stored.get(prefix + String(p.key)) ?? null });
    if (p.op === 'keys') return ok({ keys: [...stored.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length)), limits: { maxKeys: 64, maxBytes: 65536, maxKey: 64 } });
    if (p.op === 'clear') {
      for (const k of [...stored.keys()]) if (k.startsWith(prefix)) stored.delete(k);
      return ok();
    }
    if (p.op === 'set') {
      if (typeof p.value === 'string') stored.set(prefix + String(p.key), p.value);
      else stored.delete(prefix + String(p.key));
      return ok();
    }
    return fail('Invalid request.');
  },
};

export default handlers;
