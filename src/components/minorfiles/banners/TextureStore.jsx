/**
 * Shared in-memory store for uploaded banner texture previews.
 * Maps lowercase filename → canvas data URL (PNG).
 * Uses the same M2TW .texture → DDS → RGBA pipeline as the Asset Converter.
 */

import { extractDdsFromTexture, ddsToImageData } from '@/lib/textureCodec';

const store = new Map();

function ddsBufferToDataUrl(ddsBuffer) {
  const result = ddsToImageData(ddsBuffer);
  if (!result) return null;
  const canvas = document.createElement('canvas');
  canvas.width = result.width;
  canvas.height = result.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(result.imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

async function fileToDataUrl(file) {
  const buffer = await file.arrayBuffer();

  // Try extracting DDS from .texture wrapper
  const extracted = extractDdsFromTexture(buffer);
  if (extracted) {
    const url = ddsBufferToDataUrl(extracted.ddsBuffer);
    if (url) return url;
  }

  // Fallback: try treating the raw buffer as DDS directly
  const direct = ddsToImageData(buffer);
  if (direct) {
    const canvas = document.createElement('canvas');
    canvas.width = direct.width;
    canvas.height = direct.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(direct.imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }

  // Fallback for plain PNG/TGA etc — create object URL
  return URL.createObjectURL(file);
}

/** Register files from a FileList or array of File objects */
export async function loadTextureFiles(files) {
  await Promise.all(Array.from(files).map(async (file) => {
    const key = file.name.toLowerCase();
    const url = await fileToDataUrl(file);
    if (url) store.set(key, url);
  }));
}

/** Look up a texture path from the XML (e.g. "banners\textures\foo.texture") */
export function getTexturePreview(path) {
  if (!path) return null;
  const filename = path.replace(/\\/g, '/').split('/').pop().toLowerCase();
  return store.get(filename) ?? null;
}

export function getStoreSize() {
  return store.size;
}