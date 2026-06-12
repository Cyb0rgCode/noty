/**
 * Generates app icons — minimal: small black "N" centered on white,
 * anti-aliased edges. Full-bleed square: iOS masks its own corners;
 * the sidebar rounds via CSS.
 */
const zlib = require('zlib');
const fs   = require('fs');

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crcBuf = Buffer.concat([typeBytes, data]);
  const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc32(crcBuf));
  return Buffer.concat([len, typeBytes, data, crcVal]);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Distance from pixel (px,py) to the N glyph — 0 inside, positive outside.
// pad controls glyph size (bigger pad = smaller N).
function distToN(px, py, size) {
  const pad   = size * 0.30;
  const thick = size * 0.105;
  const top   = pad, bot = size - pad;
  const left  = pad, right = size - pad;

  const dLeftX = Math.max(left - px, 0, px - (left + thick));
  const dLeftY = Math.max(top  - py, 0, py - bot);
  const dLeft  = Math.sqrt(dLeftX * dLeftX + dLeftY * dLeftY);

  const dRightX = Math.max((right - thick) - px, 0, px - right);
  const dRightY = Math.max(top - py, 0, py - bot);
  const dRight  = Math.sqrt(dRightX * dRightX + dRightY * dRightY);

  const t = clamp((py - top) / (bot - top), 0, 1);
  const xCenter = left + (right - thick - left) * t;
  const dDiagX  = Math.max(xCenter - 0.5 - px, 0, px - (xCenter + thick));
  const dDiagY  = Math.max(top - py, 0, py - bot);
  const dDiag   = Math.sqrt(dDiagX * dDiagX + dDiagY * dDiagY);

  return Math.min(dLeft, dRight, dDiag);
}

function makePNG(size) {
  const pixels = new Uint8Array(size * size * 4);
  const aa = Math.max(1, size / 180); // anti-alias width

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // White background, black glyph with anti-aliased edge
      const dist = distToN(x, y, size);
      const cov = clamp(1 - dist / aa, 0, 1);
      const v = Math.round(255 * (1 - cov));

      pixels[idx]   = v;
      pixels[idx+1] = v;
      pixels[idx+2] = v;
      pixels[idx+3] = 255;
    }
  }

  const rawRows = [];
  for (let y = 0; y < size; y++) {
    rawRows.push(0);
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      rawRows.push(pixels[idx], pixels[idx+1], pixels[idx+2], pixels[idx+3]);
    }
  }

  const compressed = zlib.deflateSync(Buffer.from(rawRows));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sizes = [180, 167, 152, 120, 512];
for (const size of sizes) {
  const png = makePNG(size);
  fs.writeFileSync(`C:/Users/RayenMajoul/Desktop/Noty/icon-${size}.png`, png);
  console.log(`Generated icon-${size}.png`);
}
