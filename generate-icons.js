/**
 * Generates iOS PWA icons as PNG files using only Node.js built-ins (zlib).
 * Draws the Noty logo: purple rounded rectangle with white "N" lettering.
 */
const zlib = require('zlib');
const fs = require('fs');

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
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

function makePNG(size) {
  const pixels = new Uint8Array(size * size * 4); // RGBA

  // Draw purple rounded rectangle background
  const r1 = 0x7c, g1 = 0x3a, b1 = 0xed; // #7c3aed
  const r2 = 0xa7, g2 = 0x8b, b2 = 0xfa; // #a78bfa (lighter)
  const radius = size * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Rounded rect: check corner distance
      const cx = Math.max(radius, Math.min(size - radius, x));
      const cy = Math.max(radius, Math.min(size - radius, y));
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

      if (dist > radius) {
        pixels[idx + 3] = 0; // transparent outside
        continue;
      }

      // Diagonal gradient: top-left lighter, bottom-right darker
      const t = (x + y) / (size * 2);
      pixels[idx]     = Math.round(r1 + (r2 - r1) * (1 - t));
      pixels[idx + 1] = Math.round(g1 + (g2 - g1) * (1 - t));
      pixels[idx + 2] = Math.round(b1 + (b2 - b1) * (1 - t));
      pixels[idx + 3] = 255;
    }
  }

  // Draw white "N" letter
  const pad = size * 0.22;
  const thick = size * 0.13;
  const top = pad;
  const bot = size - pad;
  const left = pad;
  const right = size - pad;

  function drawRect(x0, y0, x1, y1) {
    for (let y = Math.round(y0); y < Math.round(y1); y++) {
      for (let x = Math.round(x0); x < Math.round(x1); x++) {
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const idx = (y * size + x) * 4;
        if (pixels[idx + 3] === 0) continue; // skip transparent
        pixels[idx] = 255; pixels[idx + 1] = 255; pixels[idx + 2] = 255; pixels[idx + 3] = 255;
      }
    }
  }

  // Left vertical bar
  drawRect(left, top, left + thick, bot);
  // Right vertical bar
  drawRect(right - thick, top, right, bot);
  // Diagonal stroke (N middle stroke)
  const steps = Math.ceil((bot - top) * 1.5);
  for (let i = 0; i < steps; i++) {
    const t2 = i / steps;
    const x = left + thick + (right - thick - left - thick) * t2;
    const y = top + (bot - top) * t2;
    drawRect(x, y, x + thick * 0.9, y + thick * 0.9);
  }

  // Build raw image data: filter byte (0) + row data
  const rawRows = [];
  for (let y = 0; y < size; y++) {
    rawRows.push(0); // filter type None
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      rawRows.push(pixels[idx], pixels[idx+1], pixels[idx+2], pixels[idx+3]);
    }
  }

  const raw = Buffer.from(rawRows);
  const compressed = zlib.deflateSync(raw);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type RGBA
  ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk('IHDR', ihdrData),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sizes = [180, 167, 152, 120, 512];
for (const size of sizes) {
  const png = makePNG(size);
  const filename = `icon-${size}.png`;
  fs.writeFileSync(`C:/Users/RayenMajoul/Desktop/Noty/${filename}`, png);
  console.log(`Generated ${filename} (${png.length} bytes)`);
}
