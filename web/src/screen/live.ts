import { Replayer } from '@rrweb/replay';
import type { eventWithTime } from '@rrweb/types';
import { unpack } from '@/mirror/codec';

// A computer somebody is using: the recording of their page (src/mirror/recorder.ts), replayed as
// it arrives. rrweb rebuilds the recorded DOM inside an iframe that cannot run script, with this
// page's stylesheets beside it, and the result is scaled to fit the screen.

/** ms an event is held back for, so one that arrives a little late still plays at its own pace. */
const PLAYOUT_MS = 60;
/** ms between looks at whether the picture still fits (a shell that redraws its chassis moves it). */
const FIT_MS = 500;
/** Events the replayer keeps for scrubbing, which a live screen never does: trimmed past this. */
const MAX_KEPT = 3000;
/** How far the picture's shape may be from the screen's and still be stretched to fill it. */
const MAX_STRETCH = 1.12;

export interface Player {
  /** Play one batch. `reset` = it is a whole-screen snapshot to start (over) from. */
  push(blob: string, reset: boolean): void;
}

/**
 * @param host the element the copy is drawn in (must be in the document)
 * @param stage the size it has to fit, px
 * @param onPicture called once the first snapshot is on screen
 */
export function createPlayer(host: HTMLElement, stage: { w: number; h: number }, onPicture: () => void): Player {
  const clip = document.createElement('div');
  clip.className = 'screen-clip';
  host.appendChild(clip);

  let replayer: Replayer | null = null;
  /** The recorder's clock is another machine's: the smallest gap seen to it is the best guess at the difference. */
  let skew = Infinity;
  let lastStamp = 0;
  let work: Promise<void> = Promise.resolve();

  /** Scale the recorded viewport - or the part of it a shell marks as its screen - to fill the stage. */
  const fit = (): void => {
    if (!replayer) return;
    const { iframe, wrapper } = replayer;
    const fw = Number(iframe.getAttribute('width'));
    const fh = Number(iframe.getAttribute('height'));
    if (!fw || !fh) return;
    let box = { x: 0, y: 0, w: fw, h: fh };
    const mark = iframe.contentDocument?.querySelector('[data-mirror-viewport]');
    if (mark) {
      const r = mark.getBoundingClientRect();
      if (r.width > 8 && r.height > 8) box = { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    // A shape close to the screen's is stretched the last few percent to fill it (a 16:9 desktop
    // on a 16:10 laptop); one further off keeps its shape and gets bars, as a monitor would give it.
    let sx = stage.w / box.w;
    let sy = stage.h / box.h;
    if (Math.max(sx, sy) / Math.min(sx, sy) > MAX_STRETCH) sx = sy = Math.min(sx, sy);
    clip.style.width = `${box.w * sx}px`;
    clip.style.height = `${box.h * sy}px`;
    clip.style.left = `${(stage.w - box.w * sx) / 2}px`;
    clip.style.top = `${(stage.h - box.h * sy) / 2}px`;
    wrapper.style.transform = `translate(${-box.x * sx}px, ${-box.y * sy}px) scale(${sx}, ${sy})`;
  };

  // Canvases. Where script cannot run a <canvas> is not a drawing surface: the browser shows its
  // (empty) fallback content, a box with no size, and the window around it folds up. So each one is
  // given its box back from its width/height attributes, and the frames the recorder samples are
  // shown as its background.
  const box = (canvas: HTMLElement): void => {
    const view = canvas.ownerDocument.defaultView;
    if (!canvas.style.width) canvas.style.width = `${canvas.getAttribute('width') ?? 300}px`;
    if (!canvas.style.height) canvas.style.height = `${canvas.getAttribute('height') ?? 150}px`;
    if (view?.getComputedStyle(canvas).display === 'inline') canvas.style.display = 'inline-block';
    canvas.style.backgroundSize = '100% 100%';
    canvas.style.backgroundRepeat = 'no-repeat';
  };
  const boxAll = (): void => {
    const doc = replayer?.iframe.contentDocument;
    if (!doc) return;
    doc.querySelectorAll<HTMLElement>('canvas').forEach(box);
    // (and in the custom apps' pages, each a frame of its own)
    doc.querySelectorAll('iframe').forEach(f => f.contentDocument?.querySelectorAll<HTMLElement>('canvas').forEach(box));
  };
  /**
   * Canvases that arrive after the snapshot (a hack window opening) are boxed as they are added.
   * One in a custom app's page is not seen being added (that page is another document, filled in
   * after the snapshot): the look at the fit every FIT_MS boxes it.
   */
  const added = new MutationObserver(boxAll);

  /** A minigame frame: what a canvas showed on the recorder's side, as an image. */
  const paint = (r: Replayer, event: unknown): void => {
    const data = (event as { data?: { tag?: string; payload?: { id?: number; url?: string } } }).data;
    const frame = data?.tag === 'canvas' ? data.payload : undefined;
    if (!frame || typeof frame.id !== 'number' || typeof frame.url !== 'string' || !/^data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+$/.test(frame.url)) return;
    const node = r.getMirror().getNode(frame.id) as HTMLElement | null;
    if (!node || node.nodeName !== 'CANVAS') return;
    box(node);
    node.style.backgroundImage = `url("${frame.url}")`;
  };

  const build = (): void => {
    replayer?.destroy();
    skew = Infinity;
    lastStamp = 0;
    const r = new Replayer([], {
      root: clip,
      liveMode: true,
      mouseTail: false,
      showWarning: false,
      triggerFocus: false,
      pauseAnimation: false, // (a live copy is never "paused": frozen, every fade-in would sit at its first frame)
      UNSAFE_replayCanvas: false,
      // A custom app's page the recording leaves out (the app asked to be, or its page could not be
      // read): what stands in its place is the app's icon and name, kept hidden on the computer
      // itself (src/apps/ext/index.tsx).
      insertStyleRules: ['[data-mirror-placeholder] { visibility: visible !important; }'],
    });
    r.on('fullsnapshot-rebuilded', () => {
      boxAll();
      added.disconnect();
      const doc = r.iframe.contentDocument;
      if (doc) added.observe(doc, { childList: true, subtree: true });
      fit();
      onPicture();
    });
    r.on('resize', fit);
    r.on('custom-event', e => paint(r, e));
    r.startLive();
    replayer = r;
  };

  const play = (events: eventWithTime[]): void => {
    if (!replayer || events.length === 0) return;
    const now = Date.now();
    skew = Math.min(skew, now - events[events.length - 1].timestamp);
    for (const e of events) {
      // On this machine's clock, and never at or before the one ahead of it: the replayer does not
      // keep two events with the same time in the order they came.
      lastStamp = Math.max(lastStamp + 0.01, e.timestamp + skew + PLAYOUT_MS);
      e.timestamp = lastStamp;
      replayer.addEvent(e);
    }
    const kept = (replayer.service.state.context as { events: unknown[] }).events;
    if (kept.length > MAX_KEPT) kept.splice(0, kept.length - MAX_KEPT / 2);
  };

  window.setInterval(() => {
    fit();
    boxAll();
  }, FIT_MS);

  return {
    push(blob, reset) {
      // One at a time, in the order they came: unpacking is asynchronous.
      work = work
        .then(() => unpack(blob))
        .then(json => {
          if (reset) build();
          play(JSON.parse(json) as eventWithTime[]);
        })
        .catch(() => undefined);
    },
  };
}
