import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

/**
 * A checkout of the app templates (github.com/Samuels-Development/sd-computers-app-templates), for
 * the dev payload's Wrenchworks (src/nui/mock/ext.ts): SD_COMPUTERS_TEMPLATES, or one beside this
 * repository, as a plain folder or as a FiveM category. null = none, and no Wrenchworks.
 */
const TEMPLATES = [
  process.env.SD_COMPUTERS_TEMPLATES,
  fileURLToPath(new URL('../../sd-computers-app-templates', import.meta.url)),
  fileURLToPath(new URL('../../[sd-computers-app-templates]', import.meta.url)),
].find((dir): dir is string => !!dir && existsSync(join(dir, 'wrenchworks', 'web', 'index.html'))) ?? null;

// Dev server only: the templates' app pages, at /ext/<app>/... from <checkout>/<app>/web/..., so
// Wrenchworks opens a real page in its window.
const templates = (): Plugin => ({
  name: 'sd-computers-app-templates',
  apply: 'serve',
  configureServer(server) {
    if (!TEMPLATES) return;
    const root = resolve(TEMPLATES);
    server.middlewares.use('/ext', (req, res, next) => {
      const m = /^\/([a-z0-9_-]+)\/([^?#]+)/.exec(decodeURIComponent(req.url ?? ''));
      if (!m) return next();
      const file = resolve(join(root, m[1], 'web', m[2]));
      if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
      res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
      createReadStream(file).pipe(res);
    });
  },
});

/**
 * The recorder (src/mirror/recorder.ts) takes in a custom app's page: rrweb watches a frame's
 * document from when it attaches it to the recording - and attaches it again on every whole-screen
 * snapshot (one per player who starts watching), each time adding a full set of watchers and never
 * taking the last set away. Every change in the page would then be sent once per snapshot taken
 * since the recording began, and a stylesheet rule inserted once would be inserted that many times
 * on the screens. This has it watch each document once per recording. It refuses to build an rrweb
 * whose code no longer reads as it did (2.1.7).
 */
const rrwebFramesOnce = (): Plugin => ({
  name: 'sd-computers-rrweb-frames-once',
  transform(code, id) {
    if (!/[\\/]@rrweb[\\/]record[\\/]dist[\\/]record\.js$/.test(id.split('?')[0])) return;
    const listen = 'iframeManager.addLoadListener((iframeEl) => {';
    const watch = 'handlers.push(observe(iframeEl.contentDocument));';
    if (code.split(listen).length !== 2 || code.split(watch).length !== 2) {
      throw new Error('@rrweb/record changed: check vite.config.ts rrwebFramesOnce against it before building');
    }
    const once = [
      'if (!watchedDocs.has(iframeEl.contentDocument)) {',
      'watchedDocs.add(iframeEl.contentDocument);',
      watch,
      '}',
    ].join(' ');
    return code.replace(listen, `const watchedDocs = new WeakSet();\n    ${listen}`).replace(watch, once);
  },
});

// Build the desktop into web/build with relative asset paths so the
// FiveM NUI (nui://sd-computers/web/build/index.html) resolves them. Filenames
// are unhashed to match the lean fxmanifest files{} globs.
export default defineConfig({
  plugins: [react(), templates(), rrwebFramesOnce()],
  // (served as it is in dev, so rrwebFramesOnce reaches it there too: it imports nothing)
  optimizeDeps: { exclude: ['@rrweb/record'] },
  // (src/nui/mock/ext.ts puts Wrenchworks on the dev desktop only when its page can be served)
  define: { __SDC_TEMPLATES__: JSON.stringify(TEMPLATES !== null) },
  base: './',
  // '@' -> src, so cross-area imports read `@/i18n` instead of `../../../i18n`.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'build',
    emptyOutDir: true,
    assetsDir: 'assets',
    target: 'chrome103', // FiveM's CEF is Chromium 103 (navigator.userAgent in game) - no toSorted, :has(), color-mix, dvh
    rollupOptions: {
      // index.html is the resource's NUI page (src/host): it holds the OS (os.html) and the
      // /computeradmin panel (admin.html) as two frames - the OS so it can be laid over a prop's
      // screen with a window of its own, the panel so its stylesheet (sd-bombs' admin UI) and the
      // OS's never meet. screen.html is the page a computer's prop shows in the world (src/screen),
      // loaded by the game as a DUI.
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        os: fileURLToPath(new URL('./os.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
        screen: fileURLToPath(new URL('./screen.html', import.meta.url)),
      },
      output: {
        // What the pages share from node_modules (React, zustand, the icons) in one chunk with a
        // name that says so, instead of one named after whichever module Rollup met first. rrweb is
        // left out of it: the recorder is fetched only while a screen is being watched, and the
        // replayer belongs to screen.html alone. The OS's stylesheets, which screen.html borrows
        // for its lock faces, get the same treatment (os.css).
        manualChunks: id => {
          if (id.includes('node_modules')) return id.includes('rrweb') ? undefined : 'vendor';
          return /[\\/]src[\\/]styles(\.css$|[\\/])/.test(id) ? 'os' : undefined;
        },
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
