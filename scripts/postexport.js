/**
 * Post-export HTML injection. `web.output: "single"` (SPA mode) ignores
 * app/+html.tsx, so the PWA wiring the exporter doesn't emit — manifest link,
 * touch icon, iOS standalone meta, dark pre-bundle background — is injected
 * into dist/index.html here. Runs after every web export (see package.json
 * build:web and vercel.json buildCommand). Idempotent.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'dist', 'index.html');
let html = fs.readFileSync(file, 'utf8');

if (html.includes('data-wls-pwa')) {
  console.log('postexport: already injected');
  process.exit(0);
}

const inject = [
  '<link rel="manifest" href="/manifest.json" data-wls-pwa>',
  '<link rel="apple-touch-icon" href="/icons/icon-180.png">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  // Dark-first: never flash white while the bundle loads.
  '<style>html,body{background:#0E141B}</style>',
].join('\n');

html = html.replace('</head>', `${inject}</head>`);
fs.writeFileSync(file, html);
console.log('postexport: PWA tags injected');
