/**
 * SymbolGenerator — full faction symbol TGA generator.
 * Features:
 *  - PNG with transparency upload (preserves alpha)
 *  - Fit width / fit height / original proportions scaling modes
 *  - Per-set custom resolution (min = game native)
 *  - Roll / Select light mask overlay (optional PNG upload per variant)
 *  - 32-bit RGBA TGA export with transparency preserved
 *  - "Download All" → ZIP with proper folder structure
 */

import React, { useState, useRef, useCallback } from 'react';
import { Upload, Download, Wand2, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import JSZip from 'jszip';

// ---------------------------------------------------------------------------
// Image loading
// ---------------------------------------------------------------------------

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Canvas / pixel helpers
// ---------------------------------------------------------------------------

function fittedRect(img, w, h, fitMode) {
  if (fitMode === 'stretch') return { x: 0, y: 0, w, h };
  if (fitMode === 'fit-width') {
    const scale = w / img.width;
    const dh = img.height * scale;
    return { x: 0, y: (h - dh) / 2, w, h: dh };
  }
  if (fitMode === 'fit-height') {
    const scale = h / img.height;
    const dw = img.width * scale;
    return { x: (w - dw) / 2, y: 0, w: dw, h };
  }
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  return { x: (w - dw) / 2, y: (h - dh) / 2, w: dw, h: dh };
}

/** Draw src image into w×h canvas using supersampled browser resampling, returns ImageData */
function drawToImageData(img, w, h, fitMode) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const sampleScale = Math.max(2, Math.min(4, Math.ceil(Math.max(img.width / Math.max(1, w), img.height / Math.max(1, h)) / 2)));
  const work = document.createElement('canvas');
  work.width = w * sampleScale;
  work.height = h * sampleScale;
  const wctx = work.getContext('2d');
  wctx.clearRect(0, 0, work.width, work.height);
  wctx.imageSmoothingEnabled = true;
  wctx.imageSmoothingQuality = 'high';
  const rect = fittedRect(img, w, h, fitMode);
  wctx.drawImage(
    img,
    rect.x * sampleScale,
    rect.y * sampleScale,
    rect.w * sampleScale,
    rect.h * sampleScale
  );
  ctx.drawImage(work, 0, 0, work.width, work.height, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Apply pixel filter + optional light mask overlay, returns new ImageData */
function applyFilter(imageData, variant, maskImg, w, h) {
  const src = imageData.data;
  const out = new ImageData(w, h);
  const dst = out.data;

  // Get mask pixels if provided
  let maskData = null;
  if (maskImg) {
    maskData = drawToImageData(maskImg, w, h, 'stretch').data;
  }

  for (let i = 0; i < src.length; i += 4) {
    let r = src[i], g = src[i + 1], b = src[i + 2], a = src[i + 3];

    if (variant === 'grey') {
      const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      r = g = b = lum;
    } else if (variant === 'roll') {
      r = Math.min(255, Math.round(r * 1.18 + 18));
      g = Math.min(255, Math.round(g * 1.14 + 12));
      b = Math.min(255, Math.round(b * 1.06 + 4));
    } else if (variant === 'select') {
      r = Math.round(r * 0.70 + 196 * 0.30);
      g = Math.round(g * 0.70 + 142 * 0.30);
      b = Math.round(b * 0.72 + 42 * 0.28);
    }

    // Blend mask on top (screen blend using mask alpha)
    if (maskData) {
      const mr = maskData[i], mg = maskData[i + 1], mb = maskData[i + 2], ma = maskData[i + 3] / 255;
      r = Math.min(255, Math.round(r + mr * ma));
      g = Math.min(255, Math.round(g + mg * ma));
      b = Math.min(255, Math.round(b + mb * ma));
    }

    dst[i] = r; dst[i + 1] = g; dst[i + 2] = b; dst[i + 3] = a;
  }
  return out;
}

/** Encode ImageData as a 32-bit RGBA TGA Blob (preserves alpha) */
function encodeRgbaTga(imageData) {
  const { width, height, data } = imageData;
  const header = new Uint8Array(18);
  header[2] = 2;
  header[12] = width & 0xFF; header[13] = (width >> 8) & 0xFF;
  header[14] = height & 0xFF; header[15] = (height >> 8) & 0xFF;
  header[16] = 32;
  header[17] = 0x28; // top-left + 8 alpha bits
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4]     = data[i * 4 + 2]; // B
    pixels[i * 4 + 1] = data[i * 4 + 1]; // G
    pixels[i * 4 + 2] = data[i * 4];     // R
    pixels[i * 4 + 3] = data[i * 4 + 3]; // A
  }
  const buf = new Uint8Array(18 + pixels.length);
  buf.set(header); buf.set(pixels, 18);
  return new Blob([buf], { type: 'application/octet-stream' });
}

function tgaArrayBuffer(imageData) {
  const { width, height, data } = imageData;
  const header = new Uint8Array(18);
  header[2] = 2;
  header[12] = width & 0xFF; header[13] = (width >> 8) & 0xFF;
  header[14] = height & 0xFF; header[15] = (height >> 8) & 0xFF;
  header[16] = 32; header[17] = 0x28;
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4]     = data[i * 4 + 2];
    pixels[i * 4 + 1] = data[i * 4 + 1];
    pixels[i * 4 + 2] = data[i * 4];
    pixels[i * 4 + 3] = data[i * 4 + 3];
  }
  const buf = new Uint8Array(18 + pixels.length);
  buf.set(header); buf.set(pixels, 18);
  return buf.buffer;
}

function downloadBlob(blob, fname) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fname; a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIT_MODES = [
  { value: 'contain',    label: 'Keep proportions' },
  { value: 'fit-width',  label: 'Fit width' },
  { value: 'fit-height', label: 'Fit height' },
  { value: 'stretch',    label: 'Stretch' },
];

const DEFAULT_SETS = [
  { key: '80',  minW: 80, minH: 80,  label: 'Symbol 80',  folder: 'data/menu/symbols/fe_symbols_80',  variants: ['standard'] },
  { key: '48',  minW: 59, minH: 59,  label: 'Symbol 48',  folder: 'data/menu/symbols/fe_buttons_48',  variants: ['standard', 'grey', 'roll', 'select'] },
  { key: '24',  minW: 32, minH: 41,  label: 'Symbol 24',  folder: 'data/menu/symbols/fe_buttons_24',  variants: ['standard', 'grey', 'roll', 'select'] },
];

function tgaFilename(factionName, setKey, variant) {
  if (setKey === '80') return `${factionName}.tga`;
  const suffix = variant === 'standard' ? '' : `_${variant}`;
  return `symbol${setKey}_${factionName}${suffix}.tga`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MaskUploader({ label, maskImg, onLoad, onClear }) {
  const ref = useRef();
  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { onLoad(await loadImageFromFile(file)); } catch (err) { console.error(err.message); }
    e.target.value = '';
  }, [onLoad]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate-400 w-14 shrink-0">{label} mask:</span>
      {maskImg ? (
        <div className="flex items-center gap-1">
          <img src={maskImg._preview} alt="mask" className="w-6 h-6 object-contain rounded border border-slate-600 bg-slate-800" />
          <button onClick={onClear} className="text-slate-500 hover:text-red-400"><X className="w-3 h-3" /></button>
        </div>
      ) : (
        <button
          onClick={() => ref.current?.click()}
          className="text-[10px] text-slate-500 hover:text-slate-300 border border-dashed border-slate-600 rounded px-2 py-0.5"
        >+ mask PNG</button>
      )}
      <input ref={ref} type="file" accept="image/png" className="hidden" onChange={handleFile} />
    </div>
  );
}

function SetConfig({ set, config, onChange }) {
  const aspectW = set.minW;
  const aspectH = set.minH;

  const handleW = (val) => {
    const w = Math.max(set.minW, Number(val));
    const h = Math.max(set.minH, Math.round(w * aspectH / aspectW));
    onChange({ w, h });
  };

  const handleH = (val) => {
    const h = Math.max(set.minH, Number(val));
    const w = Math.max(set.minW, Math.round(h * aspectW / aspectH));
    onChange({ w, h });
  };

  return (
    <div className="flex items-center gap-3 text-[10px] text-slate-400">
      <span className="font-semibold text-slate-300 w-20">{set.label}</span>
      <label className="flex items-center gap-1">
        W <input
          type="number" min={set.minW} value={config.w}
          onChange={e => handleW(e.target.value)}
          className="w-14 bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-slate-200"
        />
      </label>
      <label className="flex items-center gap-1">
        H <input
          type="number" min={set.minH} value={config.h}
          onChange={e => handleH(e.target.value)}
          className="w-14 bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-slate-200"
        />
      </label>
      <span className="text-slate-600">min {set.minW}×{set.minH}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SymbolGenerator({ factionName }) {
  const [sourceImg, setSourceImg]     = useState(null);
  const [sourcePreview, setSourcePreview] = useState(null);
  const [generated, setGenerated]     = useState({});
  const [generating, setGenerating]   = useState(false);
  const [fitMode, setFitMode]         = useState('contain');
  const [rollMask, setRollMask]       = useState(null);   // HTMLImageElement + _preview
  const [selectMask, setSelectMask]   = useState(null);

  // Per-set resolution configs
  const [setConfigs, setSetConfigs] = useState(() =>
    Object.fromEntries(DEFAULT_SETS.map(s => [s.key, { w: s.minW, h: s.minH }]))
  );

  const fileRef = useRef();

  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const img = await loadImageFromFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => {
        img._preview = ev.target.result;
        setSourceImg(img);
        setSourcePreview(ev.target.result);
        setGenerated({});
      };
      reader.readAsDataURL(file);
    } catch (err) { console.error(err.message); }
    e.target.value = '';
  }, []);

  const loadMask = useCallback(async (img, setter) => {
    const reader = new FileReader();
    // we already have the HTMLImageElement; we need a preview URL
    // img._preview was set inside loadImageFromFile's reader callback for source
    // For masks, wire it here:
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    img._preview = canvas.toDataURL('image/png');
    setter(img);
  }, []);

  const generate = useCallback(async () => {
    if (!sourceImg) return;
    setGenerating(true);
    const result = {};
    for (const set of DEFAULT_SETS) {
      const { w, h } = setConfigs[set.key];
      for (const variant of set.variants) {
        const id = `${set.key}_${variant}`;
        const base = drawToImageData(sourceImg, w, h, fitMode);
        const mask = variant === 'roll' ? rollMask : variant === 'select' ? selectMask : null;
        const filtered = applyFilter(base, variant, mask, w, h);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').putImageData(filtered, 0, 0);
        result[id] = canvas.toDataURL('image/png');
      }
    }
    setGenerated(result);
    setGenerating(false);
  }, [sourceImg, fitMode, setConfigs, rollMask, selectMask]);

  const downloadOne = useCallback((set, variant) => {
    if (!sourceImg) return;
    const { w, h } = setConfigs[set.key];
    const mask = variant === 'roll' ? rollMask : variant === 'select' ? selectMask : null;
    const base = drawToImageData(sourceImg, w, h, fitMode);
    const filtered = applyFilter(base, variant, mask, w, h);
    const blob = encodeRgbaTga(filtered);
    downloadBlob(blob, tgaFilename(factionName, set.key, variant));
  }, [sourceImg, factionName, setConfigs, fitMode, rollMask, selectMask]);

  const downloadAll = useCallback(async () => {
    if (!sourceImg) return;
    const zip = new JSZip();
    for (const set of DEFAULT_SETS) {
      const { w, h } = setConfigs[set.key];
      for (const variant of set.variants) {
        const id = `${set.key}_${variant}`;
        if (!generated[id]) continue;
        const mask = variant === 'roll' ? rollMask : variant === 'select' ? selectMask : null;
        const base = drawToImageData(sourceImg, w, h, fitMode);
        const filtered = applyFilter(base, variant, mask, w, h);
        const buf = tgaArrayBuffer(filtered);
        const fname = tgaFilename(factionName, set.key, variant);
        zip.file(`${set.folder}/${fname}`, buf);
      }
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `${factionName}_symbols.zip`);
  }, [generated, sourceImg, factionName, setConfigs, fitMode, rollMask, selectMask]);

  const hasGenerated = Object.keys(generated).length > 0;

  return (
    <div className="space-y-4 border border-slate-700 rounded-lg p-4 bg-slate-900/50">
      <div className="flex items-center gap-2">
        <Wand2 className="w-4 h-4 text-amber-400" />
        <p className="text-sm font-semibold text-slate-200">Auto-Generate Symbols</p>
      </div>

      {/* Upload source */}
      <div className="space-y-2">
        <p className="text-xs text-slate-400">
          Upload a <span className="text-amber-400 font-semibold">PNG with transparent background</span> to generate the full TGA symbol set.
        </p>
        <div className="flex gap-2 items-center">
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} className="border-slate-600 text-slate-300 text-xs shrink-0">
            <Upload className="w-3 h-3 mr-1" /> Upload PNG
          </Button>
          <input ref={fileRef} type="file" accept="image/png" className="hidden" onChange={handleFile} />
          {sourcePreview && (
            <div className="flex items-center gap-2">
              <img src={sourcePreview} alt="source" className="w-10 h-10 object-contain rounded border border-slate-600 bg-slate-800" style={{ imageRendering: 'pixelated' }} />
              <div>
                <p className="text-xs text-green-400">Source loaded ✓</p>
                <p className="text-[10px] text-slate-500">for <span className="text-amber-400 font-mono">{factionName}</span></p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fit mode */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Scaling mode</p>
        <div className="flex gap-1 flex-wrap">
          {FIT_MODES.map(m => (
            <button
              key={m.value}
              onClick={() => setFitMode(m.value)}
              className={`text-[10px] px-2 py-1 rounded border transition-colors ${fitMode === m.value
                ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                : 'border-slate-600 text-slate-400 hover:text-slate-200'}`}
            >{m.label}</button>
          ))}
        </div>
      </div>

      {/* Per-set resolution */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Output resolution per set</p>
        {DEFAULT_SETS.map(set => (
          <SetConfig
            key={set.key}
            set={set}
            config={setConfigs[set.key]}
            onChange={cfg => setSetConfigs(prev => ({ ...prev, [set.key]: cfg }))}
          />
        ))}
      </div>

      {/* Light masks */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Light effect masks (optional PNG)</p>
        <MaskUploader
          label="Roll"
          maskImg={rollMask}
          onLoad={img => loadMask(img, setRollMask)}
          onClear={() => setRollMask(null)}
        />
        <MaskUploader
          label="Select"
          maskImg={selectMask}
          onLoad={img => loadMask(img, setSelectMask)}
          onClear={() => setSelectMask(null)}
        />
        <p className="text-[9px] text-slate-600">Mask pixels are screen-blended on top of the filtered image.</p>
      </div>

      {/* Generate button */}
      {sourcePreview && (
        <Button size="sm" onClick={generate} disabled={generating} className="text-xs h-7">
          {generating
            ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Generating…</>
            : <><Wand2 className="w-3 h-3 mr-1" />Generate All</>}
        </Button>
      )}

      {/* Results grid */}
      {hasGenerated && (
        <div className="space-y-3">
          {DEFAULT_SETS.map(set => {
            const { w, h } = setConfigs[set.key];
            return (
              <div key={set.key} className="space-y-1.5">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                  {set.label} <span className="text-slate-600 normal-case">({w}×{h})</span>
                </p>
                <div className={`grid gap-2 ${set.variants.length === 4 ? 'grid-cols-4' : 'grid-cols-2'}`}>
                  {set.variants.map(variant => {
                    const id = `${set.key}_${variant}`;
                    const url = generated[id];
                    return (
                      <div key={id} className="flex flex-col items-center gap-1">
                        <div
                          className="w-full rounded border border-slate-600 bg-[url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%228%22 height=%228%22%3E%3Crect width=%224%22 height=%224%22 fill=%22%23334%22/%3E%3Crect x=%224%22 y=%224%22 width=%224%22 height=%224%22 fill=%22%23334%22/%3E%3Crect x=%224%22 y=%220%22 width=%224%22 height=%224%22 fill=%22%23223%22/%3E%3Crect x=%220%22 y=%224%22 width=%224%22 height=%224%22 fill=%22%23223%22/%3E%3C/svg%3E')] flex items-center justify-center cursor-pointer hover:border-amber-500 transition-colors overflow-hidden"
                          style={{ aspectRatio: `${w}/${h}`, minHeight: 40 }}
                          title={`Download ${tgaFilename(factionName, set.key, variant)}`}
                          onClick={() => downloadOne(set, variant)}
                        >
                          <img src={url} alt={id} className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
                        </div>
                        <span className="text-[8px] text-slate-500 text-center leading-tight">{variant}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <Button size="sm" variant="outline" onClick={downloadAll} className="w-full border-amber-600 text-amber-300 hover:bg-amber-900/20 text-xs mt-1">
            <Download className="w-3 h-3 mr-1" /> Download All as .zip
          </Button>
        </div>
      )}
    </div>
  );
}
