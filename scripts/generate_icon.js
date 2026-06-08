const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "build");
fs.mkdirSync(outDir, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];

function clamp(value, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16)
  ];
}

function roundedRectCoverage(x, y, left, top, width, height, radius) {
  const right = left + width;
  const bottom = top + height;
  if (x < left || x > right || y < top || y > bottom) return 0;
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  const distance = Math.hypot(x - cx, y - cy);
  return clamp(radius + 0.5 - distance, 0, 1);
}

function circleCoverage(x, y, cx, cy, r) {
  return clamp(r + 0.5 - Math.hypot(x - cx, y - cy), 0, 1);
}

function paintPixel(buffer, idx, rgb, alpha) {
  const inv = 1 - alpha;
  buffer[idx] = Math.round(buffer[idx] * inv + rgb[0] * alpha);
  buffer[idx + 1] = Math.round(buffer[idx + 1] * inv + rgb[1] * alpha);
  buffer[idx + 2] = Math.round(buffer[idx + 2] * inv + rgb[2] * alpha);
  buffer[idx + 3] = Math.round(buffer[idx + 3] * inv + 255 * alpha);
}

function drawIcon(size) {
  const scale = size / 256;
  const buffer = Buffer.alloc(size * size * 4);
  const bgA = hexToRgb("#10141F");
  const bgB = hexToRgb("#070A12");
  const blue = hexToRgb("#5A7BFF");
  const violet = hexToRgb("#4A4DFF");
  const white = hexToRgb("#F7F9FF");

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / scale;
      const y = (py + 0.5) / scale;
      const idx = (py * size + px) * 4;

      const bgMask = roundedRectCoverage(x, y, 0, 0, 256, 256, 58);
      if (bgMask <= 0) continue;

      const bgT = clamp((x * 0.35 + y * 0.65) / 256, 0, 1);
      const bg = bgA.map((channel, i) => mix(channel, bgB[i], bgT));
      paintPixel(buffer, idx, bg, bgMask);

      const glow = circleCoverage(x, y, 128, 70, 46) * 0.16;
      if (glow > 0) paintPixel(buffer, idx, violet, glow);

      const dotMask = circleCoverage(x, y, 128, 70, 25);
      if (dotMask > 0) {
        const t = clamp(((x - 103) + (y - 45)) / 100, 0, 1);
        const dot = blue.map((channel, i) => mix(channel, violet[i], t));
        paintPixel(buffer, idx, dot, dotMask);
      }

      const stemMask = roundedRectCoverage(x, y, 103, 112, 50, 94, 9);
      if (stemMask > 0) paintPixel(buffer, idx, white, stemMask);
    }
  }

  return buffer;
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(entries.length * 16);
  let offset = header.length + directory.length;
  entries.forEach((entry, index) => {
    const base = index * 16;
    directory[base] = entry.size === 256 ? 0 : entry.size;
    directory[base + 1] = entry.size === 256 ? 0 : entry.size;
    directory[base + 2] = 0;
    directory[base + 3] = 0;
    directory.writeUInt16LE(1, base + 4);
    directory.writeUInt16LE(32, base + 6);
    directory.writeUInt32LE(entry.png.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}

const entries = sizes.map((size) => ({
  size,
  png: encodePng(size, size, drawIcon(size))
}));

fs.writeFileSync(path.join(outDir, "icon.ico"), encodeIco(entries));
fs.writeFileSync(path.join(outDir, "icon.png"), entries[entries.length - 1].png);
console.log("Generated build/icon.ico and build/icon.png");
