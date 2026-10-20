import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/vt323/400.css';
import '../styles.css';
import '../styles/retro.css';
import '../styles/mac.css';
import '../styles/sites.css';
import '../styles/games.css';
import '@rrweb/replay/dist/style.css';
import './screen.css';
import { setLocale } from '@/i18n';
import { DEV_CHANNEL, type Batch } from '@/mirror/codec';
import Idle from './Idle';
import { createPlayer } from './live';
import { inGame, params, post, resource } from './params';

// The page behind every screen in the world (client/screens): a browser the game draws on a
// computer's prop. `mode=idle` is the style's lock face; `mode=live` is a copy of the session of
// whoever is sitting at that computer, fed in batches by client Lua (the lock face until the first
// one lands). It draws in the top-left vw x vh of its window - the part mapped onto the screen.

// What is replayed here was recorded on another player's machine. It cannot run script (the
// replay's iframe is sandboxed), and with this it cannot fetch anything from anywhere the server
// did not name either: this resource, the wallpapers' hosts, and the custom apps' (their icons,
// and the pictures, fonts and stylesheets of their pages).
if (inGame) {
  const hostsOf = (list: string): string[] => list.split(/\s+/).filter(h => /^https?:\/\/[\w.-]+(:\d+)?$/.test(h));
  const wallpapers = hostsOf(params.imageHosts);
  const apps = hostsOf(params.appHosts);
  const own = `'self' data: blob:`;
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = [
    `default-src ${own}`,
    `script-src 'self'`,
    `style-src ${[own, ...apps].join(' ')} 'unsafe-inline'`,
    `img-src ${[own, ...wallpapers, ...apps].join(' ')}`,
    `font-src ${[own, ...apps].join(' ')}`,
    `connect-src ${own} https://${resource}`,
  ].join('; ');
  document.head.appendChild(meta);
}

function Live({ onPicture }: { onPicture: () => void }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const player = createPlayer(host.current, { w: params.vw, h: params.vh }, onPicture);

    if (inGame) {
      const onMessage = (e: MessageEvent) => {
        const m = e.data as { action?: string; data?: { blob?: string; reset?: boolean } } | undefined;
        if (m?.action === 'mirror:batch' && typeof m.data?.blob === 'string') player.push(m.data.blob, m.data.reset === true);
      };
      window.addEventListener('message', onMessage);
      void post('computers:screen:ready', { id: params.id });
      return () => window.removeEventListener('message', onMessage);
    }

    // Browser dev: the OS in another tab records for us over a channel. It asks until a snapshot
    // arrives, then follows on from it - what client Lua does in the game.
    if (typeof BroadcastChannel !== 'function') return;
    const channel = new BroadcastChannel(DEV_CHANNEL);
    let inStep = false;
    channel.onmessage = e => {
      const batch = (e.data as { batch?: Batch } | undefined)?.batch;
      if (!batch) return;
      if (batch.full && !inStep) {
        inStep = true;
        player.push(batch.blob, true);
      } else if (inStep && !batch.full) {
        player.push(batch.blob, false);
      }
    };
    const ask = window.setInterval(() => !inStep && channel.postMessage({ need: true }), 2000);
    channel.postMessage({ need: true });
    return () => {
      window.clearInterval(ask);
      channel.close();
    };
  }, [onPicture]);

  return <div ref={host} className="screen-live" />;
}

function Screen() {
  const [picture, setPicture] = useState(false);
  const onPicture = useRef(() => setPicture(true)).current;
  return (
    <div className="screen-stage" style={{ width: params.vw, height: params.vh }}>
      {!picture && <Idle />}
      {params.mode === 'live' && (
        <div className={picture ? 'screen-layer' : 'screen-layer is-waiting'}>
          <Live onPicture={onPicture} />
        </div>
      )}
    </div>
  );
}

void post('computers:ui:locale').then(r => {
  const strings = (r as { strings?: Record<string, unknown> } | null)?.strings;
  if (strings) setLocale(strings);
});

createRoot(document.getElementById('root')!).render(<Screen />);
