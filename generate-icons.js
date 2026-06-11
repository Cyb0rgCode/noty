/**
 * Generates app icons — aurora mesh gradient background, anti-aliased "N"
 * with gradient fill, drop shadow, soft glow, and glossy sheen.
 * Full-bleed square: iOS masks its own corners; the sidebar rounds via CSS.
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
function lerp(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }

// Distance from pixel (px,py) to the N glyph — 0 inside, positive outside
function distToN(px, py, size) {
  const pad   = size * 0.22;
  const thick = size * 0.15;
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

// Aurora blob: additive radial color contribution
function blob(x, y, cx, cy, radius, strength) {
  const d = Math.hypot(x - cx, y - cy) / radius;
  const f = Math.max(0, 1 - d * d);
  return f * f * strength;
}

function makePNG(size) {
  const pixels = new Uint8Array(size * size * 4);
  const aa = Math.max(1, size / 180);          // anti-alias width
  const shadowOff  = size * 0.022;
  const shadowSoft = size * 0.04;
  const glowRadius = size * 0.05;

  // Diagonal gradient stops
  const c0 = [0x1e, 0x1b, 0x4b]; // indigo-950
  const c1 = [0x7c, 0x3a, 0xed]; // violet-600
  const c2 = [0xc0, 0x26, 0xd3]; // fuchsia-600

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // ── Base: diagonal three-stop gradient ────────────────────────
      const td = (x + y) / (2 * size);
      let r, g, b;
      if (td < 0.5) {
        r = lerp(c0[0], c1[0], td * 2);
        g = lerp(c0[1], c1[1], td * 2);
        b = lerp(c0[2], c1[2], td * 2);
      } else {
        r = lerp(c1[0], c2[0], (td - 0.5) * 2);
        g = lerp(c1[1], c2[1], (td - 0.5) * 2);
        b = lerp(c1[2], c2[2], (td - 0.5) * 2);
      }

      // ── Aurora blobs (mesh-gradient feel) ──────────────────────────
      const b1 = blob(x, y, size * 0.78, size * 0.15, size * 0.60, 0.50); // lavender, upper-right
      r = lerp(r, 0xa7, b1); g = lerp(g, 0x8b, b1); b = lerp(b, 0xfa, b1);

      const b2 = blob(x, y, size * 0.12, size * 0.88, size * 0.65, 0.40); // indigo, lower-left
      r = lerp(r, 0x4f, b2); g = lerp(g, 0x46, b2); b = lerp(b, 0xe5, b2);

      const b3 = blob(x, y, size * 0.88, size * 0.92, size * 0.55, 0.35); // pink, lower-right
      r = lerp(r, 0xe8, b3); g = lerp(g, 0x79, b3); b = lerp(b, 0xf9, b3);

      // ── Vignette: darken corners for depth ─────────────────────────
      const vd = Math.hypot(x - size / 2, y - size / 2) / (size * 0.72);
      const vig = 1 - clamp(vd * vd, 0, 1) * 0.22;
      r *= vig; g *= vig; b *= vig;

      // ── Glossy sheen on top half ───────────────────────────────────
      if (y < size * 0.45) {
        const sheen = Math.pow(1 - y / (size * 0.45), 2) * 0.07;
        r += sheen * 255; g += sheen * 255; b += sheen * 255;
      }

      // ── Drop shadow under glyph (offset down-right) ────────────────
      const sDist = distToN(x - shadowOff, y - shadowOff, size);
      const sCov  = clamp(1 - sDist / shadowSoft, 0, 1);
      const shade = 1 - sCov * sCov * 0.45;
      r *= shade; g *= shade; b *= shade;

      // ── Soft glow halo around glyph ────────────────────────────────
      const dist = distToN(x, y, size);
      if (dist > 0 && dist < glowRadius) {
        const glow = Math.pow(1 - dist / glowRadius, 2) * 0.5;
        r = lerp(r, 255, glow * 0.6);
        g = lerp(g, 230, glow * 0.5);
        b = lerp(b, 255, glow * 0.7);
      }

      // ── Glyph: anti-aliased, vertical gradient white → lavender ────
      const cov = clamp(1 - dist / aa, 0, 1);
      if (cov > 0) {
        const gy = clamp((y - size * 0.22) / (size * 0.56), 0, 1);
        const gr = lerp(255, 0xdd, gy);
        const gg = lerp(255, 0xd6, gy);
        const gb = lerp(255, 0xfe, gy);
        r = lerp(r, gr, cov);
        g = lerp(g, gg, cov);
        b = lerp(b, gb, cov);
      }

      pixels[idx]   = Math.round(clamp(r, 0, 255));
      pixels[idx+1] = Math.round(clamp(g, 0, 255));
      pixels[idx+2] = Math.round(clamp(b, 0, 255));
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
