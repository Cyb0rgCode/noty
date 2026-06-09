/**
 * Generates iOS PWA icons — purple rounded rect, white "N" with fusion glow effect.
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

// Signed distance from pixel (px,py) to the N glyph — negative = inside
function distToN(px, py, size) {
  const pad   = size * 0.21;
  const thick = size * 0.145;
  const top   = pad, bot = size - pad;
  const left  = pad, right = size - pad;

  // Distance to left bar
  const dLeftX = Math.max(left - px, 0, px - (left + thick));
  const dLeftY = Math.max(top  - py, 0, py - bot);
  const dLeft  = Math.sqrt(dLeftX * dLeftX + dLeftY * dLeftY);

  // Distance to right bar
  const dRightX = Math.max((right - thick) - px, 0, px - right);
  const dRightY = Math.max(top - py, 0, py - bot);
  const dRight  = Math.sqrt(dRightX * dRightX + dRightY * dRightY);

  // Distance to diagonal band
  const t = Math.max(0, Math.min(1, (py - top) / (bot - top)));
  const xCenter = (left + thick) + (right - thick - (left + thick)) * t;
  const dDiagX  = Math.max(xCenter - 0.5 - px, 0, px - (xCenter + thick));
  const dDiagY  = Math.max(top - py, 0, py - bot);
  const dDiag   = Math.sqrt(dDiagX * dDiagX + dDiagY * dDiagY);

  return Math.min(dLeft, dRight, dDiag);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }

function makePNG(size) {
  const pixels = new Uint8Array(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const radius = size * 0.2;

  // Background colour stops (deep purple → indigo)
  const bg1 = [0x4c, 0x1d, 0x95]; // indigo-900 deep
  const bg2 = [0x7c, 0x3a, 0xed]; // violet-600
  const bg3 = [0x6d, 0x28, 0xd9]; // violet-700

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Rounded corners
      const rcx = clamp(x, radius, size - radius);
      const rcy = clamp(y, radius, size - radius);
      if (Math.hypot(x - rcx, y - rcy) > radius) { pixels[idx+3] = 0; continue; }

      // ── Background: radial energy bloom in upper-left ──────────────
      // Base vertical gradient bg1→bg3
      const ty = y / size;
      let r = lerp(bg1[0], bg3[0], ty);
      let g = lerp(bg1[1], bg3[1], ty);
      let b = lerp(bg1[2], bg3[2], ty);

      // Radial bloom: bright violet core offset slightly up-left
      const bloomX = size * 0.42, bloomY = size * 0.38;
      const bloomDist = Math.hypot(x - bloomX, y - bloomY) / (size * 0.5);
      const bloom = Math.max(0, 1 - bloomDist * bloomDist) * 0.55;
      r = lerp(r, bg2[0] + 60, bloom);
      g = lerp(g, bg2[1] + 15, bloom);
      b = lerp(b, bg2[2] + 30, bloom);

      // Diagonal shimmer streak (top-left to bottom-right, narrow band)
      const streakAxis = (x + y) / (size * 2); // 0..1
      const streakCenter = 0.52;
      const streakWidth  = 0.04;
      const streakT = Math.max(0, 1 - Math.abs(streakAxis - streakCenter) / streakWidth);
      const shimmer = streakT * streakT * 0.18;
      r = Math.min(255, r + shimmer * 255);
      g = Math.min(255, g + shimmer * 200);
      b = Math.min(255, b + shimmer * 255);

      // ── N glyph with soft glow halo ────────────────────────────────
      const dist = distToN(x, y, size);

      if (dist === 0) {
        // Solid white core
        r = 255; g = 255; b = 255;
      } else {
        // Glow: exponential falloff, violet-white tint
        const glowRadius = size * 0.045;
        const glow = Math.max(0, 1 - dist / glowRadius);
        const glowIntensity = glow * glow * 0.85;
        r = Math.min(255, r + glowIntensity * (255 - r) + glowIntensity * 40);
        g = Math.min(255, g + glowIntensity * (200 - g));
        b = Math.min(255, b + glowIntensity * (255 - b));
      }

      pixels[idx]   = Math.round(clamp(r, 0, 255));
      pixels[idx+1] = Math.round(clamp(g, 0, 255));
      pixels[idx+2] = Math.round(clamp(b, 0, 255));
      pixels[idx+3] = 255;
    }
  }

  // Build PNG
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
