const { createCanvas } = (() => {
  try { return require("canvas"); } catch { return { createCanvas: null }; }
})();

function generateStatusImage(color, label, size = 72) {
  if (createCanvas) {
    return generateWithCanvas(color, label, size);
  }
  return generateMinimalPng(color, size);
}

function generateWithCanvas(color, label, size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, 10);
  ctx.fill();

  if (label) {
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `${Math.max(10, Math.floor(size / 5))}px "Inter", "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const lines = label.split("\n");
    const lineHeight = Math.floor(size / (lines.length + 1));
    const startY = size / 2 - ((lines.length - 1) * lineHeight) / 2;

    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i].substring(0, 8), size / 2, startY + i * lineHeight);
    }
  }

  return canvas.toBuffer("image/png");
}

function generateMinimalPng(color, size) {
  const r = parseInt(color.substring(1, 3), 16);
  const g = parseInt(color.substring(3, 5), 16);
  const b = parseInt(color.substring(5, 7), 16);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type (RGB)
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const ihdrChunk = createPngChunk("IHDR", ihdrData);

  const rawData = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const rowOffset = y * (1 + size * 3);
    rawData[rowOffset] = 0; // filter byte
    for (let x = 0; x < size; x++) {
      const px = rowOffset + 1 + x * 3;
      const isCorner = (x < 10 && y < 10) || (x >= size - 10 && y < 10) || (x < 10 && y >= size - 10) || (x >= size - 10 && y >= size - 10);
      const edgeX = x < 10 || x >= size - 10;
      const edgeY = y < 10 || y >= size - 10;

      if (edgeX || edgeY) {
        const factor = isCorner ? 0.85 : 0.75;
        rawData[px] = Math.floor(r * factor);
        rawData[px + 1] = Math.floor(g * factor);
        rawData[px + 2] = Math.floor(b * factor);
      } else {
        rawData[px] = r;
        rawData[px + 1] = g;
        rawData[px + 2] = b;
      }
    }
  }

  // Simple PNG compression using zlib (deflate)
  const zlib = require("zlib");
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createPngChunk("IDAT", compressed);

  const iendChunk = createPngChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

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
  const table = crc32.table || (crc32.table = buildCrc32Table());
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrc32Table() {
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

module.exports = { generateStatusImage };
