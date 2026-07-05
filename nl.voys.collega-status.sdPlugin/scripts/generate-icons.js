const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const COLORS = {
  available: { hex: "#28A745", label: "Vrij" },
  internal_only: { hex: "#17A2B8", label: "Intern" },
  do_not_disturb: { hex: "#DC3545", label: "Bezet" },
  offline: { hex: "#6C757D", label: "Offline" },
  unknown: { hex: "#3A4754", label: "?" },
  auth_error: { hex: "#DC3545", label: "Auth" },
  config: { hex: "#495057", label: "Config" },
  missing: { hex: "#3A4754", label: "??" },
  key: { hex: "#253342", label: "" },
  category: { hex: "#162B3B", label: "V" },
  plugin: { hex: "#162B3B", label: "V" },
};

function createPngChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = crc32(typeAndData);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([length, typeAndData, crcBuf]);
}

function crc32(buf) {
  let crc = 0xffffffff;
  const table = buildTable();
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
}

function generatePng(colorHex, label, size) {
  const r = parseInt(colorHex.substring(1, 3), 16);
  const g = parseInt(colorHex.substring(3, 5), 16);
  const b = parseInt(colorHex.substring(5, 7), 16);

  const rawData = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowOffset = y * (1 + size * 4);
    rawData[rowOffset] = 0;
    for (let x = 0; x < size; x++) {
      const px = rowOffset + 1 + x * 4;
      const isCorner =
        (x < 8 && y < 8) ||
        (x >= size - 8 && y < 8) ||
        (x < 8 && y >= size - 8) ||
        (x >= size - 8 && y >= size - 8);
      const isEdge = x < 4 || x >= size - 4 || y < 4 || y >= size - 4;

      if (isCorner) {
        rawData[px] = Math.floor(r * 0.85);
        rawData[px + 1] = Math.floor(g * 0.85);
        rawData[px + 2] = Math.floor(b * 0.85);
        rawData[px + 3] = 255;
      } else {
        rawData[px] = r;
        rawData[px + 1] = g;
        rawData[px + 2] = b;
        rawData[px + 3] = 255;
      }
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(rawData);

  return Buffer.concat([
    sig,
    createPngChunk("IHDR", ihdr),
    createPngChunk("IDAT", compressed),
    createPngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const iconsDir = path.join(__dirname, "..", "icons");
const actionDir = path.join(iconsDir, "action");

for (const [name, cfg] of Object.entries(COLORS)) {
  let sizes, dir;
  if (name === "plugin") {
    sizes = [144, 288];
    dir = iconsDir;
  } else if (name === "category") {
    sizes = [28, 56];
    dir = iconsDir;
  } else {
    sizes = [72, 144];
    dir = actionDir;
  }

  for (const sz of sizes) {
    const suffix = sizes.length > 1 ? (sz === sizes[1] ? "@2x" : "") : "";
    const png = generatePng(cfg.hex, cfg.label, sz);
    const outName = `${name}${suffix}.png`;
    fs.writeFileSync(path.join(dir, outName), png);
    console.log(`Generated ${outName} (${sz}x${sz})`);
  }
}

console.log("All icons generated.");
