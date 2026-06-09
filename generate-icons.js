/**
 * Generates iOS PWA icons as PNG files using only Node.js built-ins (zlib).
 * Draws the Noty logo: purple rounded rectangle with white "N" lettering.
 */
const zlib = require('zlib');
const fs = require('fs');

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

// Returns true if pixel (px,py) is inside the "N" glyph for a given size
function isInN(px, py, size) {
  const pad   = size * 0.21;
  const thick = size * 0.145;
  const top   = pad;
  const bot   = size - pad;
  const left  = pad;
  const right = size - pad;

  // Left vertical bar
  if (px >= left && px <= left + thick && py >= top && py <= bot) return true;
  // Right vertical bar
  if (px >= right - thick && px <= right && py >= top && py <= bot) return true;
  // Diagonal band from (left+thick, top) to (right-thick, bot)
  // At row py, the diagonal center x:
  const t = (py - top) / (bot - top);
  if (t >= 0 && t <= 1) {
    const xCenter = (left + thick) + (right - thick - (left + thick)) * t;
    if (px >= xCenter - 0.5 && px <= xCenter + thick) return true;
  }
  return false;
}

function makePNG(size) {
  const pixels = new Uint8Array(size * size * 4);

  // Background gradient: #7c3aed → #6d28d9 top-to-bottom
  const r1 = 0x7c, g1 = 0x3a, b1 = 0xed;
  const r2 = 0x6d, g2 = 0x28, b2 = 0xd9;
  const radius = size * 0.2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Rounded corners
      const cx = Math.max(radius, Math.min(size - radius, x));
      const cy = Math.max(radius, Math.min(size - radius, y));
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist > radius) { pixels[idx + 3] = 0; continue; }

      if (isInN(x, y, size)) {
        // White letter with slight alpha blend for anti-alias at edges
        pixels[idx] = 255; pixels[idx+1] = 255; pixels[idx+2] = 255; pixels[idx+3] = 255;
      } else {
        // Purple background gradient top→bottom
        const t = y / size;
        pixels[idx]   = Math.round(r1 + (r2 - r1) * t);
        pixels[idx+1] = Math.round(g1 + (g2 - g1) * t);
        pixels[idx+2] = Math.round(b1 + (b2 - b1) * t);
        pixels[idx+3] = 255;
      }
    }
  }

  // Build raw image data
  const rawRows = [];
  for (let y = 0; y < size; y++) {
    rawRows.push(0); // filter None
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      rawRows.push(pixels[idx], pixels[idx+1], pixels[idx+2], pixels[idx+3]);
    }
  }

  const compressed = zlib.deflateSync(Buffer.from(rawRows));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA

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
