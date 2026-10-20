import { record } from '@rrweb/record';
import type { eventWithTime } from '@rrweb/types';
import { fetchNui, isEnvBrowser } from '@/nui/bridge';
import { DEV_CHANNEL, pack, type Batch } from './codec';

// What the screen on this computer's prop shows to the players standing near it: a recording of
// the page, not of the pixels. rrweb takes one snapshot of the DOM and from then on only what
// changes (a node added, a character typed, the pointer moving), and a screen's page replays it.
// It runs only while somebody is watching - client Lua says when (computers:mirror) - and this
// module is loaded only then.
//
// Never recorded: what is typed into a password field (rrweb masks it at the source), anything
// under an element marked `mirror-block` (a StartHack window, or what a custom app's page marks),
// and anything outside this document but a custom app's page (the /computeradmin panel is another
// frame of the page that holds this one, src/host; the Browser's sites are frames in the OS -
// foreign() keeps what is in those out). A custom app's page is in a frame marked
// data-mirror-frame (src/apps/ext), and goes into the recording with the OS around it.

/** rrweb's event types and sources (the ones looked at here). */
const FULL_SNAPSHOT = 2;
const INCREMENTAL = 3;
const META = 4;
const INPUT = 5;

/** ms events are gathered for before a batch leaves (longer after a heavy one, see pause()). */
const FLUSH_MS = 100;
/** ms between two whole-screen snapshots, however many watchers ask at once. */
const SNAPSHOT_GAP_MS = 1500;
/** Minigame canvases are sent no wider than this (px). */
const CANVAS_MAX_W = 480;
const CANVAS_QUALITY = 0.45;
/** The frames whose page is recorded with the OS: custom apps' (src/apps/ext). */
const SHARED_FRAME = 'iframe[data-mirror-frame]';

const channel = isEnvBrowser() && typeof BroadcastChannel === 'function' ? new BroadcastChannel(DEV_CHANNEL) : null;

let stop: (() => void) | undefined;
let queue: eventWithTime[] = [];
let queueIsSnapshot = false;
let seq = 0;
let flushTimer: number | undefined;
let snapshotTimer: number | undefined;
let canvasTimer: number | undefined;
let lastSnapshot = 0;
let lastSize = 0;
let frames = new WeakMap<HTMLCanvasElement, string>();
/** Documents looked up as the page of a shared frame (true) or not (false), so each is looked up once. */
let shared = new WeakMap<Document, boolean>();

const isInput = (e: eventWithTime): boolean => e.type === INCREMENTAL && (e.data as { source?: number }).source === INPUT;

type NodeRef = { id?: number; parentId?: number };

/** The pages in this document's shared frames. */
const sharedPages = (): Document[] =>
  Array.from(document.querySelectorAll<HTMLIFrameElement>(SHARED_FRAME), f => f.contentDocument).filter(
    (doc): doc is Document => doc !== null,
  );

/** Whether a document is the page in one of this document's shared frames. */
function isShared(doc: Document): boolean {
  let yes = shared.get(doc);
  if (yes === undefined) {
    yes = sharedPages().includes(doc);
    shared.set(doc, yes);
  }
  return yes;
}

/**
 * Whether an event is about another document than this one and a shared frame's page. rrweb
 * follows into every frame it can read, and marking a frame `mirror-block` hides its attributes,
 * not what is inside it. So the event that would attach a frame's contents is dropped, and so is
 * everything that happens in one - unless the frame is one of this document's shared frames.
 */
function foreign(e: eventWithTime): boolean {
  if (e.type !== INCREMENTAL) return false;
  const d = e.data as {
    id?: number;
    isAttachIframe?: boolean;
    adds?: NodeRef[];
    removes?: NodeRef[];
    texts?: NodeRef[];
    attributes?: NodeRef[];
    positions?: NodeRef[];
  };
  if (d.isAttachIframe) {
    const frame = record.mirror.getNode(d.adds?.[0]?.parentId ?? -1);
    return !(frame instanceof HTMLIFrameElement && frame.ownerDocument === document && frame.matches(SHARED_FRAME));
  }
  const id = d.id ?? d.adds?.[0]?.parentId ?? d.removes?.[0]?.parentId ?? d.texts?.[0]?.id ?? d.attributes?.[0]?.id ?? d.positions?.[0]?.id;
  if (typeof id !== 'number') return false;
  const node = record.mirror.getNode(id);
  if (node === null || node === document) return false;
  // (a frame's document is its own node, with no owner)
  const doc = node.nodeType === Node.DOCUMENT_NODE ? (node as Document) : node.ownerDocument;
  return doc !== document && (doc === null || !isShared(doc));
}

/** A field typed into reports its whole value on every keystroke: only the last one in a batch matters. */
function squash(events: eventWithTime[]): eventWithTime[] {
  const last = new Map<number, number>();
  events.forEach((e, i) => {
    if (isInput(e)) last.set((e.data as { id: number }).id, i);
  });
  if (last.size === 0) return events;
  return events.filter((e, i) => !isInput(e) || last.get((e.data as { id: number }).id) === i);
}

function deliver(batch: Batch): void {
  if (channel) channel.postMessage({ batch });
  else void fetchNui('computers:mirror:batch', batch);
}

function flush(): void {
  window.clearTimeout(flushTimer);
  flushTimer = undefined;
  if (queue.length === 0) return;
  const batch = { seq: seq++, full: queueIsSnapshot, events: queueIsSnapshot ? queue : squash(queue) };
  queue = [];
  queueIsSnapshot = false;
  void pack(JSON.stringify(batch.events)).then(blob => {
    lastSize = blob.length;
    deliver({ seq: batch.seq, full: batch.full, blob });
  });
}

/** How long the next batch gathers for: a heavy one (a big window opening) buys the wire a breather. */
const pause = (): number => (lastSize > 32768 ? 500 : lastSize > 8192 ? 250 : FLUSH_MS);

function emit(event: eventWithTime): void {
  if (foreign(event)) return;
  // A snapshot travels as a batch of its own - what was waiting leaves first, nothing rides along
  // behind it - so a page already in step can drop it whole and lose nothing.
  if (event.type === META) {
    flush();
    queueIsSnapshot = true;
  }
  queue.push(event);
  if (event.type === FULL_SNAPSHOT) {
    lastSnapshot = Date.now();
    frames = new WeakMap(); // (whoever starts from this snapshot has no canvas frames yet)
    shared = new WeakMap(); // (an app re-registered meanwhile may have left the copy)
    flush();
    return;
  }
  if (!queueIsSnapshot && flushTimer === undefined) flushTimer = window.setTimeout(flush, pause());
}

/** A new watcher (or one that lost a batch) needs a snapshot to start from. */
function snapshot(): void {
  const wait = lastSnapshot + SNAPSHOT_GAP_MS - Date.now();
  if (wait <= 0) {
    record.takeFullSnapshot(true);
    return;
  }
  if (snapshotTimer !== undefined) return;
  snapshotTimer = window.setTimeout(() => {
    snapshotTimer = undefined;
    if (stop) record.takeFullSnapshot(true);
  }, wait);
}

/**
 * The minigames draw on a canvas, which a DOM recording does not see: send what they show as small
 * images - and what the canvases in a custom app's page show. Not a canvas marked data-mirror-skip -
 * a security camera's picture is the watching player's own game view (src/apps/cameras/GameView.tsx),
 * and far too much to send three times a second.
 */
function sampleCanvases(scratch: HTMLCanvasElement): void {
  const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>('.os-root canvas:not([data-mirror-skip])'));
  for (const page of sharedPages()) canvases.push(...page.querySelectorAll<HTMLCanvasElement>('canvas:not([data-mirror-skip])'));
  canvases.forEach(canvas => {
    if (!canvas.width || !canvas.height) return;
    const id = record.mirror.getId(canvas);
    if (id <= 0) return;
    const scale = Math.min(1, CANVAS_MAX_W / canvas.width);
    scratch.width = Math.round(canvas.width * scale);
    scratch.height = Math.round(canvas.height * scale);
    const ctx = scratch.getContext('2d');
    if (!ctx) return;
    let url: string;
    try {
      ctx.drawImage(canvas, 0, 0, scratch.width, scratch.height);
      url = scratch.toDataURL('image/webp', CANVAS_QUALITY);
    } catch {
      return; // (an app's canvas with a picture from another origin on it cannot be read)
    }
    if (frames.get(canvas) === url) return;
    frames.set(canvas, url);
    record.addCustomEvent('canvas', { id, url });
  });
}

function begin(canvasFps: number): void {
  stop = record({
    emit,
    blockClass: 'mirror-block',
    maskInputOptions: { password: true },
    slimDOMOptions: 'all',
    sampling: { mousemove: 50, mousemoveCallback: 200, scroll: 150, input: 'all' },
    recordCanvas: false,
    collectFonts: false,
    inlineImages: false,
  });
  if (canvasFps > 0) {
    const scratch = document.createElement('canvas');
    canvasTimer = window.setInterval(() => sampleCanvases(scratch), Math.max(100, Math.round(1000 / canvasFps)));
  }
}

function end(): void {
  stop?.();
  stop = undefined;
  window.clearTimeout(flushTimer);
  window.clearTimeout(snapshotTimer);
  window.clearInterval(canvasTimer);
  flushTimer = snapshotTimer = canvasTimer = undefined;
  queue = [];
  queueIsSnapshot = false;
}

/** Start recording (or, already recording, take a fresh snapshot for whoever just arrived) - or stop. */
export function control(d: { record: boolean; canvasFps?: number }): void {
  if (!d.record) end();
  else if (stop) snapshot();
  else begin(d.canvasFps ?? 0);
}
