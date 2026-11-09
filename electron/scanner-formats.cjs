const fs = require('node:fs');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');

async function saveScannerAsBmp(inputPath, outputPath) {
  const { data, info } = await sharp(inputPath).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const rowBytes = Math.ceil((info.width * 3) / 4) * 4;
  const pixelBytes = rowBytes * info.height;
  const header = Buffer.alloc(54);
  header.write('BM', 0, 'ascii');
  header.writeUInt32LE(54 + pixelBytes, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(info.width, 18);
  header.writeInt32LE(info.height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(0, 30);
  header.writeUInt32LE(pixelBytes, 34);
  header.writeInt32LE(2835, 38);
  header.writeInt32LE(2835, 42);
  const pixels = Buffer.alloc(pixelBytes);
  for (let y = 0; y < info.height; y += 1) {
    const sourceRow = y * info.width * 3;
    const targetRow = (info.height - y - 1) * rowBytes;
    for (let x = 0; x < info.width; x += 1) {
      const sourceIndex = sourceRow + x * 3;
      const targetIndex = targetRow + x * 3;
      pixels[targetIndex] = data[sourceIndex + 2];
      pixels[targetIndex + 1] = data[sourceIndex + 1];
      pixels[targetIndex + 2] = data[sourceIndex];
    }
  }
  fs.writeFileSync(outputPath, Buffer.concat([header, pixels]));
}

async function saveScannerAsPdf(inputPath, outputPath) {
  const pdf = await PDFDocument.create();
  const embedded = await pdf.embedJpg(new Uint8Array(fs.readFileSync(inputPath)));
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 24;
  const scale = Math.min((pageWidth - margin * 2) / embedded.width, (pageHeight - margin * 2) / embedded.height);
  const width = embedded.width * scale;
  const height = embedded.height * scale;
  const page = pdf.addPage([pageWidth, pageHeight]);
  page.drawImage(embedded, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height });
  fs.writeFileSync(outputPath, Buffer.from(await pdf.save()));
}

async function exportScannerImage(inputPath, outputPath, format) {
  const supportedFormats = new Set(['jpeg', 'png', 'bmp', 'tiff', 'webp', 'pdf']);
  if (!supportedFormats.has(format)) throw new Error('صيغة الحفظ غير مدعومة.');
  if (format === 'bmp') return saveScannerAsBmp(inputPath, outputPath);
  if (format === 'pdf') return saveScannerAsPdf(inputPath, outputPath);
  return sharp(inputPath).toFormat(format, { quality: 92 }).toFile(outputPath);
}

async function prepareScannerOcrImage(inputPath) {
  const metadata = await sharp(inputPath).metadata();
  if (!metadata.width || !metadata.height) throw new Error('أبعاد صورة المسح غير صالحة.');
  const longestSide = Math.max(metadata.width, metadata.height);
  const scale = Math.max(1, Math.min(2.2, 2200 / longestSide));
  const width = Math.max(1, Math.round(metadata.width * scale));
  const image = await sharp(inputPath)
    .rotate()
    .greyscale()
    .normalize()
    .sharpen({ sigma: 1.1, m1: 0.5, m2: 2 })
    .resize({ width, withoutEnlargement: false, fit: 'inside' })
    .png({ compressionLevel: 6 })
    .toBuffer();
  return `data:image/png;base64,${image.toString('base64')}`;
}

async function prepareScannerOcrInput(inputPath) {
  try {
    const dataUrl = await prepareScannerOcrImage(inputPath);
    return { buffer: Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'), preprocessed: true, warning: '' };
  } catch (error) {
    const buffer = fs.readFileSync(inputPath);
    if (!buffer.length) throw error;
    return { buffer, preprocessed: false, warning: String(error?.message || error) };
  }
}

module.exports = { exportScannerImage, prepareScannerOcrImage, prepareScannerOcrInput };
