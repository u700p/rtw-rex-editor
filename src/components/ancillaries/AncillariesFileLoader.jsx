import React, { useRef } from 'react';
import { useAncillaries } from './AncillariesContext';
import { Button } from '@/components/ui/button';
import { Upload, Download, Save, RotateCcw, Image } from 'lucide-react';

// Decode a TGA file (true-color 24/32-bit) to a data URL via canvas
function decodeTgaToDataUrl(buffer) {
  const data = new Uint8Array(buffer);
  // TGA header is 18 bytes
  if (data.length < 18) return null;
  const idLength = data[0];
  const colorMapType = data[1];
  const imageType = data[2]; // 2 = uncompressed true-color, 10 = RLE true-color
  const width = data[12] | (data[13] << 8);
  const height = data[14] | (data[15] << 8);
  const bpp = data[16]; // bits per pixel
  const imageDescriptor = data[17];
  const topOrigin = !!(imageDescriptor & 0x20);

  if (colorMapType !== 0 || (imageType !== 2 && imageType !== 10)) return null;
  if (bpp !== 24 && bpp !== 32) return null;
  if (width === 0 || height === 0) return null;

  const headerSize = 18 + idLength;
  const bytesPerPixel = bpp / 8;
  const pixels = new Uint8ClampedArray(width * height * 4);

  let srcIdx = headerSize;
  let pixIdx = 0;

  if (imageType === 2) {
    // Uncompressed
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const b = data[srcIdx++], g = data[srcIdx++], r = data[srcIdx++];
        const a = bpp === 32 ? data[srcIdx++] : 255;
        pixels[pixIdx++] = r; pixels[pixIdx++] = g; pixels[pixIdx++] = b; pixels[pixIdx++] = a;
      }
    }
  } else {
    // RLE
    let pixel = 0;
    while (pixel < width * height) {
      const repCount = data[srcIdx++];
      const count = (repCount & 0x7f) + 1;
      if (repCount & 0x80) {
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

  // Flip vertically if bottom-origin (default TGA)
  if (!topOrigin) {
    const rowSize = width * 4;
    for (let y = 0; y < Math.floor(height / 2); y++) {
      const top = y * rowSize;
      const bot = (height - 1 - y) * rowSize;
      for (let i = 0; i < rowSize; i++) {
        const tmp = pixels[top + i];
        pixels[top + i] = pixels[bot + i];
        pixels[bot + i] = tmp;
      }
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imgData = new ImageData(pixels, width, height);
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

export default function AncillariesFileLoader() {
  const {
    ancData, textData, ancFilename, textFilename,
    loadAncFile, loadTextFile, loadTgaImages,
    exportAncFile, exportTextFile,
    saveAncillaries, revertAncillaries,
    isDirty,
  } = useAncillaries();
  const ancRef = useRef();
  const textRef = useRef();
  const tgaFolderRef = useRef();

  const handleAncFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => loadAncFile(ev.target.result, file.name);
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleTextFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = ev => loadTextFile(ev.target.result, file.name);
    reader.readAsText(file);
  };

  const handleTgaFolder = async (e) => {
    const files = Array.from(e.target.files || []).filter(f => f.name.toLowerCase().endsWith('.tga'));
    e.target.value = '';
    const images = {};
    for (const file of files) {
      const buf = await file.arrayBuffer();
      const dataUrl = decodeTgaToDataUrl(buf);
      if (dataUrl) {
        const key = file.name.replace(/\.tga$/i, '').toLowerCase();
        images[key] = dataUrl;
      }
    }
    loadTgaImages(images);
  };

  const downloadFile = (content, filename) => {
    const safeName = filename || 'export_ancillaries.txt';
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = safeName; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border bg-card">
      <input ref={ancRef} type="file" accept=".txt" className="hidden" onChange={handleAncFile} />
      <input ref={textRef} type="file" accept=".txt" className="hidden" onChange={handleTextFile} />
      <input ref={tgaFolderRef} type="file" className="hidden"
        webkitdirectory="" directory="" multiple onChange={handleTgaFolder} />

      {/* Load buttons */}
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1.5 text-white"
        onClick={() => ancRef.current?.click()}>
        <Upload className="w-3 h-3" />
        Load Ancillaries
      </Button>
      {ancData && <span className="text-[10px] text-muted-foreground font-mono truncate max-w-36">{ancFilename}</span>}

      <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1.5 text-white"
        onClick={() => textRef.current?.click()}>
        <Upload className="w-3 h-3" />
        Load Text (.txt)
      </Button>
      {textData && <span className="text-[10px] text-muted-foreground font-mono truncate max-w-36">{textFilename}</span>}

      <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1.5 text-white"
        title="Browse to data\ui\ancillaries\ folder"
        onClick={() => tgaFolderRef.current?.click()}>
        <Image className="w-3 h-3" />
        Load UI Images (.tga)
      </Button>

      {/* Save / Revert */}
      {ancData && isDirty && (
        <>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1.5 text-white ml-auto"
            onClick={saveAncillaries}>
            <Save className="w-3 h-3" />
            Save
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1.5 text-white"
            onClick={revertAncillaries}>
            <RotateCcw className="w-3 h-3" />
            Revert
          </Button>
        </>
      )}

      {/* Export */}
      {ancData && (
        <Button size="sm" className="h-7 px-2 text-xs gap-1.5 text-white ml-auto"
          onClick={() => downloadFile(exportAncFile(), ancFilename)}>
          <Download className="w-3 h-3" />
          Export Ancillaries{isDirty && ' *'}
        </Button>
      )}
      {textData && (
        <Button size="sm" variant="secondary" className="h-7 px-2 text-xs gap-1.5 text-white"
          onClick={() => downloadFile(exportTextFile(), textFilename)}>
          <Download className="w-3 h-3" />
          Export Text
        </Button>
      )}
    </div>
  );
}
