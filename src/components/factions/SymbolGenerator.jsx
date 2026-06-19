/**
 * SymbolGenerator — takes a source image and produces the full set of
 * faction symbol TGAs (symbol24 ×4, symbol48 ×4, symbol80 ×1) via canvas.
 *
 * Native game dimensions (measured from real assets):
 *   symbol24-set : 32 × 41
 *   symbol48-set : 59 × 59
 *   symbol80     : 90 × 90
 *
 * Variants:
 *   standard  — as-is
 *   grey      — desaturated
 *   roll      — brightness +30% (lighter / glow)
 *   select    — blue tint overlay (matches game UI select state)
 */

import React, { useState, useRef, useCallback } from 'react';
import { Upload, Download, Wand2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode image file'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image from URL'));
    img.src = url;
  });
}

/** Draw src image into a canvas of given size and return ImageData */
function resizeToImageData(img, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Apply a pixel-level filter to ImageData, returns new ImageData */
function applyFilter(imageData, variant) {
  const src = imageData.data;
  const out = new ImageData(imageData.width, imageData.height);
  const dst = out.data;

  for (let i = 0; i < src.length; i += 4) {
    let r = src[i], g = src[i + 1], b = src[i + 2], a = src[i + 3];

    if (variant === 'grey') {
      // Luminance-weighted greyscale
      const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      r = g = b = lum;
    } else if (variant === 'roll') {
      // Brighten by 30%, clamp
      r = Math.min(255, Math.round(r * 1.30));
      g = Math.min(255, Math.round(g * 1.30));
      b = Math.min(255, Math.round(b * 1.30));
    } else if (variant === 'select') {
      // Blue-steel tint: blend 40% blue overlay
      r = Math.round(r * 0.60 + 60 * 0.40);
      g = Math.round(g * 0.60 + 80 * 0.40);
      b = Math.round(b * 0.60 + 160 * 0.40);
    }

    dst[i] = r; dst[i + 1] = g; dst[i + 2] = b; dst[i + 3] = a;
  }
  return out;
}

/** Encode ImageData as a 32-bit RGBA TGA and return a Blob */
function encodeRgbaTga(imageData) {
  const { width, height, data } = imageData;
  const pixelCount = width * height;
  const header = new Uint8Array(18);
  header[2] = 2;    // uncompressed true-color
  header[12] = width & 0xFF;
  header[13] = (width >> 8) & 0xFF;
  header[14] = height & 0xFF;
  header[15] = (height >> 8) & 0xFF;
  header[16] = 32; // 32-bit RGBA
  header[17] = 0x28; // top-left origin + alpha bits = 8

  const pixels = new Uint8Array(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    pixels[i * 4]     = data[i * 4 + 2]; // B
    pixels[i * 4 + 1] = data[i * 4 + 1]; // G
    pixels[i * 4 + 2] = data[i * 4];     // R
    pixels[i * 4 + 3] = data[i * 4 + 3]; // A
  }
  const buf = new Uint8Array(18 + pixels.length);
  buf.set(header); buf.set(pixels, 18);
  return new Blob([buf], { type: 'application/octet-stream' });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Slot spec
// ---------------------------------------------------------------------------

const VARIANTS = ['standard', 'grey', 'roll', 'select'];

const SETS = [
  { key: '80',  w: 90, h: 90,  label: 'Symbol 80',  variants: ['standard'] },
  { key: '48',  w: 59, h: 59,  label: 'Symbol 48',  variants: VARIANTS },
  { key: '24',  w: 32, h: 41,  label: 'Symbol 24',  variants: VARIANTS },
];

function filename(factionName, setKey, variant) {
  if (setKey === '80') return `${factionName}.tga`;
  const suffix = variant === 'standard' ? '' : `_${variant}`;
  return `symbol${setKey}_${factionName}${suffix}.tga`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SymbolGenerator({ factionName }) {
  const [sourceImg, setSourceImg] = useState(null); // HTMLImageElement
  const [sourcePreview, setSourcePreview] = useState(null); // data URL for preview
  const [generated, setGenerated] = useState({}); // { "48_grey": dataURL, ... }
  const [generating, setGenerating] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const fileRef = useRef();

  const loadSource = useCallback(async (img, preview) => {
    setSourceImg(img);
    setSourcePreview(preview);
    setGenerated({});
  }, []);

  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const img = await loadImageFromFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => loadSource(img, ev.target.result);
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Image load error:', err.message);
    }
    e.target.value = '';
  }, [loadSource]);

  const handleUrl = useCallback(async () => {
    if (!urlInput.trim()) return;
    try {
      const img = await loadImageFromUrl(urlInput.trim());
      loadSource(img, urlInput.trim());
    } catch (err) {
      console.error('URL load error:', err.message);
    }
  }, [urlInput, loadSource]);

  const generate = useCallback(async () => {
    if (!sourceImg) return;
    setGenerating(true);
    const result = {};
    for (const set of SETS) {
      for (const variant of set.variants) {
        const id = `${set.key}_${variant}`;
        const base = resizeToImageData(sourceImg, set.w, set.h);
        const filtered = applyFilter(base, variant);
        const canvas = document.createElement('canvas');
        canvas.width = set.w; canvas.height = set.h;
        canvas.getContext('2d').putImageData(filtered, 0, 0);
        result[id] = canvas.toDataURL('image/png');
      }
    }
    setGenerated(result);
    setGenerating(false);
  }, [sourceImg]);

  const downloadOne = useCallback((set, variant) => {
    const id = `${set.key}_${variant}`;
    const img = new window.Image();
    img.onload = () => {
      const imageData = resizeToImageData(img, set.w, set.h);
      const filtered = applyFilter(imageData, variant);
      const blob = encodeRgbaTga(filtered);
      downloadBlob(blob, filename(factionName, set.key, variant));
    };
    img.src = generated[id];
  }, [generated, factionName]);

  const downloadAll = useCallback(() => {
    for (const set of SETS) {
      for (const variant of set.variants) {
        const id = `${set.key}_${variant}`;
        if (!generated[id]) continue;
        const img = new window.Image();
        const s = set, v = variant;
        img.onload = () => {
          const imageData = resizeToImageData(img, s.w, s.h);
          const filtered = applyFilter(imageData, v);
          const blob = encodeRgbaTga(filtered);
          downloadBlob(blob, filename(factionName, s.key, v));
        };
        img.src = generated[id];
      }
    }
  }, [generated, factionName]);

  const hasGenerated = Object.keys(generated).length > 0;

  return (
    <div className="space-y-4 border border-slate-700 rounded-lg p-4 bg-slate-900/50">
      <div className="flex items-center gap-2">
        <Wand2 className="w-4 h-4 text-amber-400" />
        <p className="text-sm font-semibold text-slate-200">Auto-Generate Symbols</p>
      </div>

      {/* Source input */}
      <div className="space-y-2">
        <p className="text-xs text-slate-400">Upload a source image (any format/size) to generate the full TGA symbol set.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} className="border-slate-600 text-slate-300 text-xs">
            <Upload className="w-3 h-3 mr-1" /> Upload Image
          </Button>
          <input ref={fileRef} type="file" accept="image/*,.tga" className="hidden" onChange={handleFile} />
          <input
            type="text"
            placeholder="…or paste image URL"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500"
          />
          <Button size="sm" variant="outline" onClick={handleUrl} className="border-slate-600 text-slate-300 text-xs">Load</Button>
        </div>
      </div>

      {/* Source preview */}
      {sourcePreview && (
        <div className="flex items-center gap-3">
          <img src={sourcePreview} alt="source" className="w-16 h-16 object-contain rounded border border-slate-600 bg-slate-800" style={{ imageRendering: 'pixelated' }} />
          <div className="space-y-1">
            <p className="text-xs text-slate-300">Source loaded ✓</p>
            <p className="text-[10px] text-slate-500">Will generate 9 files for <span className="text-amber-400 font-mono">{factionName}</span></p>
            <Button size="sm" onClick={generate} disabled={generating} className="text-xs h-7">
              {generating ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Generating…</> : <><Wand2 className="w-3 h-3 mr-1" />Generate All</>}
            </Button>
          </div>
        </div>
      )}

      {/* Results grid */}
      {hasGenerated && (
        <div className="space-y-3">
          {SETS.map(set => (
            <div key={set.key} className="space-y-1.5">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                {set.label} <span className="text-slate-600 normal-case">({set.w}×{set.h})</span>
              </p>
              <div className={`grid gap-2 ${set.variants.length === 4 ? 'grid-cols-4' : 'grid-cols-2'}`}>
                {set.variants.map(variant => {
                  const id = `${set.key}_${variant}`;
                  const url = generated[id];
                  return (
                    <div key={id} className="flex flex-col items-center gap-1">
                      <div
                        className="w-full rounded border border-slate-600 bg-slate-800 flex items-center justify-center cursor-pointer hover:border-amber-500 transition-colors overflow-hidden"
                        style={{ aspectRatio: `${set.w}/${set.h}`, minHeight: 40 }}
                        title={`Download ${filename(factionName, set.key, variant)}`}
                        onClick={() => downloadOne(set, variant)}
                      >
                        <img src={url} alt={id} className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
                      </div>
                      <span className="text-[8px] text-slate-500 text-center leading-tight">{filename(factionName, set.key, variant)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <Button size="sm" variant="outline" onClick={downloadAll} className="w-full border-slate-600 text-slate-300 text-xs mt-1">
            <Download className="w-3 h-3 mr-1" /> Download All as .tga
          </Button>
        </div>
      )}
    </div>
  );
}