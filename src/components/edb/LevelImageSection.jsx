import React, { useRef, useState } from 'react';
import { useEDB } from './EDBContext';
import { useRefData } from './RefDataContext';
import { Button } from '@/components/ui/button';
import { Upload, Download, ImageIcon } from 'lucide-react';

// Image slots per level per culture
// type: 'icon' | 'panel' | 'construction'
const IMAGE_SLOTS = [
  {
    type: 'icon',
    label: 'Icon',
    pathHint: 'ui/[culture]/buildings/constructed/#[culture]_[level].tga',
    aspect: 64 / 51,        // ~1.25
    previewClass: 'w-16',
    previewStyle: { aspectRatio: '64/51' },
  },
  {
    type: 'panel',
    label: 'Panel',
    pathHint: 'ui/[culture]/buildings/#[culture]_[level].tga',
    aspect: 78 / 62,        // ~1.26
    previewClass: 'w-20',
    previewStyle: { aspectRatio: '78/62' },
  },
  {
    type: 'construction',
    label: 'Constructed',
    pathHint: 'ui/[culture]/buildings/#[culture]_[level]_constructed.tga',
    aspect: 300 / 245,      // ~1.22
    previewClass: 'w-28',
    previewStyle: { aspectRatio: '300/245' },
  },
];

function encodeTGA(canvas, targetW, targetH) {
  const offscreen = document.createElement('canvas');
  offscreen.width = targetW;
  offscreen.height = targetH;
  const ctx = offscreen.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, targetW, targetH);
  const imgData = ctx.getImageData(0, 0, targetW, targetH);
  const pixels = imgData.data;
  const header = new Uint8Array(18);
  header[2] = 2; // uncompressed RGB
  header[12] = targetW & 0xff; header[13] = (targetW >> 8) & 0xff;
  header[14] = targetH & 0xff; header[15] = (targetH >> 8) & 0xff;
  header[16] = 32; // 32 bpp (RGBA)
  header[17] = 0x28; // top-left origin
  const bodySize = targetW * targetH * 4;
  const body = new Uint8Array(bodySize);
  for (let i = 0; i < targetW * targetH; i++) {
    const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2], a = pixels[i * 4 + 3];
    body[i * 4] = b; body[i * 4 + 1] = g; body[i * 4 + 2] = r; body[i * 4 + 3] = a;
  }
  const out = new Uint8Array(18 + bodySize);
  out.set(header); out.set(body, 18);
  return out;
}

function downloadTGA(canvas, filename, targetW, targetH) {
  const tga = encodeTGA(canvas, targetW, targetH);
  const blob = new Blob([tga], { type: 'image/x-tga' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const SLOT_SIZES = { icon: [64, 51], panel: [78, 62], construction: [300, 245] };

function ImageSlot({ culture, levelName, slot }) {
  const { imageData, loadBuildingTgaImages } = useEDB();
  const key = `${levelName}_${culture}_${slot.type}`;
  const img = imageData[key];
  const fileRef = useRef();
  const [preview, setPreview] = useState(null); // { dataUrl, canvas }

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const image = new window.Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, 0, 0);
        setPreview({ dataUrl, canvas, fileName: file.name });
      };
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSaveAsTga = () => {
    if (!preview) return;
    const [tw, th] = SLOT_SIZES[slot.type];
    const filename = `#${culture}_${levelName}${slot.type === 'construction' ? '_constructed' : ''}.tga`;
    downloadTGA(preview.canvas, filename, tw, th);
    // Also load into the editor's imageData
    const [targetW, targetH] = SLOT_SIZES[slot.type];
    const offscreen = document.createElement('canvas');
    offscreen.width = targetW; offscreen.height = targetH;
    const ctx = offscreen.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(preview.canvas, 0, 0, targetW, targetH);
    loadBuildingTgaImages([{
      path: `data/ui/${culture}/buildings/${slot.type === 'icon' ? 'constructed/' : ''}#${culture}_${levelName}${slot.type === 'construction' ? '_constructed' : ''}.tga`,
      name: `#${culture}_${levelName}${slot.type === 'construction' ? '_constructed' : ''}.tga`,
      url: offscreen.toDataURL('image/png'),
    }]);
    setPreview(null);
  };

  const [tw, th] = SLOT_SIZES[slot.type];

  return (
    <div className="flex flex-col items-center gap-1 group">
      <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">{slot.label}</p>
      {img ? (
        <div className="relative">
          <img
            src={img.url}
            alt={slot.label}
            className="rounded border border-border bg-black/20 object-contain"
            style={{ width: 64, ...slot.previewStyle }}
          />
          <button
            className="absolute -top-1 -right-1 w-4 h-4 bg-destructive/80 rounded-full text-[9px] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            title="Replace"
            onClick={() => fileRef.current?.click()}
          >×</button>
        </div>
      ) : preview ? (
        <div className="flex flex-col items-center gap-1">
          <img src={preview.dataUrl} alt="preview" className="rounded border border-border object-contain bg-black/20" style={{ width: 64, ...slot.previewStyle }} />
          <p className="text-[9px] text-muted-foreground">→ {tw}×{th}px</p>
          <div className="flex gap-1">
            <Button size="sm" className="h-5 text-[9px] px-1.5 gap-0.5" onClick={handleSaveAsTga}>
              <Download className="w-2.5 h-2.5" /> Save .tga
            </Button>
            <button className="text-[9px] text-muted-foreground hover:text-destructive" onClick={() => setPreview(null)}>✕</button>
          </div>
        </div>
      ) : (
        <button
          className="border border-dashed border-border rounded flex flex-col items-center justify-center gap-0.5 hover:border-primary/40 hover:bg-primary/5 transition-colors text-muted-foreground"
          style={{ width: 64, ...slot.previewStyle }}
          onClick={() => fileRef.current?.click()}
          title={`Upload image for ${slot.pathHint}`}
        >
          <Upload className="w-3 h-3" />
          <span className="text-[8px]">Upload</span>
          <span className="text-[8px] opacity-60">{tw}×{th}</span>
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  );
}

export default function LevelImageSection({ levelName }) {
  const { cultures } = useRefData();

  if (!cultures || cultures.length === 0) {
    return (
      <div className="flex items-center gap-2 p-2 rounded-lg bg-accent/30 border border-dashed border-border text-[10px] text-muted-foreground">
        <ImageIcon className="w-3.5 h-3.5 shrink-0" />
        Load descr_sm_factions.txt to see culture-specific building images
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {cultures.map(culture => (
        <div key={culture}>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{culture}</p>
          <div className="flex gap-3 flex-wrap">
            {IMAGE_SLOTS.map(slot => (
              <ImageSlot key={slot.type} culture={culture} levelName={levelName} slot={slot} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
