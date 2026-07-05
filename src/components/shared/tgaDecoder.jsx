/**
 * Decodes a TGA (Targa) image buffer into a PNG data URL for browser rendering.
 * Supports uncompressed/RLE true-color, color-mapped, and grayscale TGA files.
 */
export function decodeTgaToDataUrl(buffer) {
  const data = new Uint8Array(buffer);
  if (data.length < 18) return null;
  const idLength = data[0], colorMapType = data[1], imageType = data[2];
  const colorMapFirst = data[3] | (data[4] << 8);
  const colorMapLength = data[5] | (data[6] << 8);
  const colorMapDepth = data[7];
  const width = data[12] | (data[13] << 8), height = data[14] | (data[15] << 8);
  const bpp = data[16], imageDescriptor = data[17];
  const topOrigin = !!(imageDescriptor & 0x20);
  const rightOrigin = !!(imageDescriptor & 0x10);
  const isMapped = imageType === 1 || imageType === 9;
  const isTrueColor = imageType === 2 || imageType === 10;
  const isGray = imageType === 3 || imageType === 11;
  const isRle = imageType === 9 || imageType === 10 || imageType === 11;
  if (!isMapped && !isTrueColor && !isGray) return null;
  if (isMapped && colorMapType !== 1) return null;
  if (!isMapped && colorMapType !== 0) return null;
  if (isTrueColor && ![15, 16, 24, 32].includes(bpp)) return null;
  if (isGray && ![8, 16].includes(bpp)) return null;
  if (isMapped && ![8, 15, 16].includes(bpp)) return null;
  if (width === 0 || height === 0) return null;
  let srcIdx = 18 + idLength;
  const readColor = (bits) => {
    if (bits === 32) {
      const b = data[srcIdx++], g = data[srcIdx++], r = data[srcIdx++], a = data[srcIdx++];
      return [r, g, b, a];
    }
    if (bits === 24) {
      const b = data[srcIdx++], g = data[srcIdx++], r = data[srcIdx++];
      return [r, g, b, 255];
    }
    if (bits === 16 || bits === 15) {
      const v = data[srcIdx++] | (data[srcIdx++] << 8);
      const b = (v & 0x1f) * 255 / 31;
      const g = ((v >> 5) & 0x1f) * 255 / 31;
      const r = ((v >> 10) & 0x1f) * 255 / 31;
      return [Math.round(r), Math.round(g), Math.round(b), 255];
    }
    const g = data[srcIdx++];
    return [g, g, g, 255];
  };

  let colorMap = null;
  if (isMapped) {
    colorMap = new Map();
    for (let i = 0; i < colorMapLength; i++) {
      colorMap.set(colorMapFirst + i, readColor(colorMapDepth));
    }
  }

  const pixels = new Uint8ClampedArray(width * height * 4);

  const readIndex = () => {
    if (bpp === 8) return data[srcIdx++];
    return data[srcIdx++] | (data[srcIdx++] << 8);
  };

  const readPixel = () => {
    if (isMapped) return colorMap.get(readIndex()) || [0, 0, 0, 0];
    if (isGray) {
      const g = data[srcIdx++];
      const a = bpp === 16 ? data[srcIdx++] : 255;
      return [g, g, g, a];
    }
    return readColor(bpp);
  };

  let pixIdx = 0;
  if (!isRle) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const [r, g, b, a] = readPixel();
      pixels[pixIdx++] = r; pixels[pixIdx++] = g; pixels[pixIdx++] = b; pixels[pixIdx++] = a;
    }
  } else {
    let pixel = 0;
    while (pixel < width * height) {
      const rc = data[srcIdx++], count = (rc & 0x7f) + 1;
      if (rc & 0x80) {
        const [r, g, b, a] = readPixel();
        for (let i = 0; i < count; i++, pixel++) {
          pixels[pixIdx++] = r; pixels[pixIdx++] = g; pixels[pixIdx++] = b; pixels[pixIdx++] = a;
        }
      } else {
        for (let i = 0; i < count; i++, pixel++) {
          const [r, g, b, a] = readPixel();
          pixels[pixIdx++] = r; pixels[pixIdx++] = g; pixels[pixIdx++] = b; pixels[pixIdx++] = a;
        }
      }
    }
  }
  if (!topOrigin) {
    const rowSize = width * 4;
    for (let y = 0; y < Math.floor(height / 2); y++) {
      const top = y * rowSize, bot = (height - 1 - y) * rowSize;
      for (let i = 0; i < rowSize; i++) {
        const tmp = pixels[top + i]; pixels[top + i] = pixels[bot + i]; pixels[bot + i] = tmp;
      }
    }
  }
  if (rightOrigin) {
    const rowSize = width * 4;
    for (let y = 0; y < height; y++) {
      const row = y * rowSize;
      for (let x = 0; x < Math.floor(width / 2); x++) {
        const left = row + x * 4;
        const right = row + (width - 1 - x) * 4;
        for (let i = 0; i < 4; i++) {
          const tmp = pixels[left + i]; pixels[left + i] = pixels[right + i]; pixels[right + i] = tmp;
        }
      }
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas.toDataURL('image/png');
}
