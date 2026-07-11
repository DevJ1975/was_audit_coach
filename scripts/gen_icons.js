/**
 * Placeholder icon generator — solid dark field + brand-blue "audit list"
 * glyph (three bars + check square), all axis-aligned rects so no image lib is
 * needed. Regenerate: node scripts/gen_icons.js. Replace with the real WLS
 * mark when it lands (assets/branding/README.md) — sizes must stay the same.
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const BG = [0x0e, 0x14, 0x1b];      // surfaces.bg
const FG = [0x4f, 0xa3, 0xe3];      // brand.default
const LIGHT = [0xed, 0xf2, 0xf7];   // text.primary

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, draw) {
  const px = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) px.set(BG, i * 3);
  draw((x, y, rgb) => {
    if (x >= 0 && x < size && y >= 0 && y < size) px.set(rgb, (y * size + x) * 3);
  }, size);
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    px.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function rect(set, x0, y0, w, h, rgb) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, rgb);
}

function drawGlyph(set, size) {
  const u = size / 16; // glyph grid
  // Brand plate
  rect(set, Math.round(2 * u), Math.round(2 * u), Math.round(12 * u), Math.round(12 * u), FG);
  // Three "checklist" bars (light)
  for (let i = 0; i < 3; i++) {
    rect(set, Math.round(4 * u), Math.round((4.2 + i * 2.6) * u), Math.round(6 * u), Math.round(1.2 * u), LIGHT);
  }
  // Check square (dark-on-brand, bottom right)
  rect(set, Math.round(10.6 * u), Math.round(9.6 * u), Math.round(2.6 * u), Math.round(2.6 * u), BG);
  rect(set, Math.round(11.2 * u), Math.round(10.2 * u), Math.round(1.4 * u), Math.round(1.4 * u), LIGHT);
}

const out = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const size of [48, 180, 192, 512, 1024]) {
  fs.writeFileSync(path.join(out, `icon-${size}.png`), png(size, drawGlyph));
  console.log(`icon-${size}.png`);
}
