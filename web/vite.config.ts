import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

const EXAMPLES = fileURLToPath(new URL('../examples', import.meta.url));
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

// Dev server only: the example custom apps' pages, at /ext/<app>/... from examples/<app>/web/...,
// so the dev payload's Wrenchworks (src/nui/mock/ext.ts) opens a real page in its window.
const examples = (): Plugin => ({
  name: 'sd-computers-examples',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/ext', (req, res, next) => {
      const m = /^\/([a-z0-9_-]+)\/([^?#]+)/.exec(decodeURIComponent(req.url ?? ''));
      if (!m) return next();
      const file = resolve(join(EXAMPLES, m[1], 'web', m[2]));
      if (!file.startsWith(EXAMPLES + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
      res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
      createReadStream(file).pipe(res);
    });
  },
});

// Build the desktop into web/build with relative asset paths so the
// FiveM NUI (nui://sd-computers/web/build/index.html) resolves them. Filenames
// are unhashed to match the lean fxmanifest files{} globs.
export default defineConfig({
  plugins: [react(), examples()],
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
