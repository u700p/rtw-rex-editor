/**
 * Load a TGA file (ArrayBuffer) into a usable layer state object.
 * Returns { bitmap, data, width, height } or null on failure.
 */
function flipRowsInPlace(pixels, width, height) {
  const rowSize = width * 4;
  const temp = new Uint8ClampedArray(rowSize);
  for (let y = 0; y < Math.floor(height / 2); y++) {
    const top = y * rowSize;
    const bot = (height - 1 - y) * rowSize;
    temp.set(pixels.subarray(top, top + rowSize));
    pixels.copyWithin(top, bot, bot + rowSize);
    pixels.set(temp, bot);
  }
}

export async function loadTGA(buffer) {
  const data = new Uint8Array(buffer);
  if (data.length < 18) return null;

  const idLength       = data[0];
  const colorMapType   = data[1];
  const imageType      = data[2];
  const width          = data[12] | (data[13] << 8);
  const height         = data[14] | (data[15] << 8);
  const bpp            = data[16];
  const imageDescriptor = data[17];
  const topOrigin      = !!(imageDescriptor & 0x20);

  if (colorMapType !== 0) return null;
  if (imageType !== 2 && imageType !== 10) return null;
  if (bpp !== 24 && bpp !== 32) return null;
  if (width === 0 || height === 0) return null;

  const headerSize = 18 + idLength;
  const pixels = new Uint8ClampedArray(width * height * 4);
  let srcIdx = headerSize, pixIdx = 0;

  if (imageType === 2) {
    // Uncompressed
    for (let i = 0; i < width * height; i++) {
      const b = data[srcIdx++], g = data[srcIdx++], r = data[srcIdx++];
      const a = bpp === 32 ? data[srcIdx++] : 255;
      pixels[pixIdx++] = r; pixels[pixIdx++] = g; pixels[pixIdx++] = b; pixels[pixIdx++] = a;
    }
  } else {
    // RLE compressed
    let pixel = 0;
    while (pixel < width * height) {
      const rc = data[srcIdx++], count = (rc & 0x7f) + 1;
      if (rc & 0x80) {
        const b = data[srcIdx++], g = data[srcIdx++], r = data[srcIdx++];
        const a = bpp === 32 ? data[srcIdx++] : 255;
        for (let i = 0; i < count; i++, pixel++) {
          pixels[pixIdx++] = r; pixels[pixIdx++] = g; pixels[pixIdx++] = b; pixels[pixIdx++] = a;
        }
      } else {
        for (let i = 0; i < count; i++, pixel++) {
          const b = data[srcIdx++], g = data[srcIdx++], r = data[srcIdx++];
          const a = bpp === 32 ? data[srcIdx++] : 255;
          pixels[pixIdx++] = r; pixels[pixIdx++] = g; pixels[pixIdx++] = b; pixels[pixIdx++] = a;
        }
      }
    }
  }

  // Flip vertically if bottom-origin
  if (!topOrigin) {
    flipRowsInPlace(pixels, width, height);
  }

  const imageData = new ImageData(pixels, width, height);
  const bitmap = await createImageBitmap(imageData);
  return { bitmap, data: pixels, width, height };
}
