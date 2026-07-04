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

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Upload, Download, Wand2, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import JSZip from 'jszip';

// ---------------------------------------------------------------------------
// Image loading
// ---------------------------------------------------------------------------

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      img._preview = url;
      img._previewObjectUrl = url;
      img._trimBounds = alphaBounds(img);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image'));
    };
    img.src = url;
  });
}

function revokeImagePreview(img) {
  if (img?._previewObjectUrl) URL.revokeObjectURL(img._previewObjectUrl);
}

function alphaBounds(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (data[(y * img.width + x) * 4 + 3] <= 8) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// ---------------------------------------------------------------------------
// Canvas / pixel helpers
// ---------------------------------------------------------------------------

function fittedRect(img, w, h, fitMode, { trim = true, padding = 0 } = {}) {
  const bounds = trim && img._trimBounds ? img._trimBounds : { x: 0, y: 0, w: img.width, h: img.height };
  const innerW = Math.max(1, w - padding * 2);
  const innerH = Math.max(1, h - padding * 2);
  if (fitMode === 'stretch') return { sx: bounds.x, sy: bounds.y, sw: bounds.w, sh: bounds.h, dx: padding, dy: padding, dw: innerW, dh: innerH };
  if (fitMode === 'fit-width') {
    const scale = innerW / bounds.w;
    const dh = bounds.h * scale;
    return { sx: bounds.x, sy: bounds.y, sw: bounds.w, sh: bounds.h, dx: padding, dy: padding + (innerH - dh) / 2, dw: innerW, dh };
  }
  if (fitMode === 'fit-height') {
    const scale = innerH / bounds.h;
    const dw = bounds.w * scale;
    return { sx: bounds.x, sy: bounds.y, sw: bounds.w, sh: bounds.h, dx: padding + (innerW - dw) / 2, dy: padding, dw, dh: innerH };
  }
  const scale = Math.min(innerW / bounds.w, innerH / bounds.h);
  const dw = bounds.w * scale;
  const dh = bounds.h * scale;
  return { sx: bounds.x, sy: bounds.y, sw: bounds.w, sh: bounds.h, dx: padding + (innerW - dw) / 2, dy: padding + (innerH - dh) / 2, dw, dh };
}

/** Draw src image into w×h canvas using supersampled browser resampling, returns ImageData */
function drawToImageData(img, w, h, fitMode, options = {}) {
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
  const padding = options.padding ?? (options.trim === false || fitMode === 'stretch' ? 0 : Math.max(1, Math.round(Math.min(w, h) * 0.04)));
  const rect = fittedRect(img, w, h, fitMode, { trim: options.trim !== false, padding });
  wctx.drawImage(
    img,
    rect.sx,
    rect.sy,
    rect.sw,
    rect.sh,
    rect.dx * sampleScale,
    rect.dy * sampleScale,
    rect.dw * sampleScale,
    rect.dh * sampleScale
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
    maskData = drawToImageData(maskImg, w, h, 'stretch', { trim: false, padding: 0 }).data;
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

function bleedTransparentEdges(imageData, iterations = 2) {
  const { width, height, data } = imageData;
  for (let pass = 0; pass < iterations; pass++) {
    const previous = new Uint8ClampedArray(data);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        if (previous[index + 3] > 4) continue;
        let r = 0, g = 0, b = 0, count = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = (ny * width + nx) * 4;
            if (previous[ni + 3] <= 4) continue;
            r += previous[ni];
            g += previous[ni + 1];
            b += previous[ni + 2];
            count++;
          }
        }
        if (!count) continue;
        data[index] = Math.round(r / count);
        data[index + 1] = Math.round(g / count);
        data[index + 2] = Math.round(b / count);
      }
    }
  }
  return imageData;
}

function imageDataToDataUrl(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function renderSymbolVariant(sourceImg, set, variant, setConfigs, fitMode, rollMask, selectMask) {
  const { w, h } = setConfigs[set.key];
  const base = drawToImageData(sourceImg, w, h, fitMode);
  const mask = variant === 'roll' ? rollMask : variant === 'select' ? selectMask : null;
  return bleedTransparentEdges(applyFilter(base, variant, mask, w, h));
}

function renderAllSymbols(sourceImg, setConfigs, fitMode, rollMask, selectMask) {
  const result = {};
  const frames = {};
  for (const set of DEFAULT_SETS) {
    const { w, h } = setConfigs[set.key];
    const base = drawToImageData(sourceImg, w, h, fitMode);
    for (const variant of set.variants) {
      const id = `${set.key}_${variant}`;
      const mask = variant === 'roll' ? rollMask : variant === 'select' ? selectMask : null;
      const filtered = bleedTransparentEdges(applyFilter(base, variant, mask, w, h));
      frames[id] = filtered;
      result[id] = imageDataToDataUrl(filtered);
    }
  }
  return { result, frames };
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
  { key: '24',  minW: 32, minH: 41,  label: 'FE_buttons_24',  folder: 'data/menu/symbols/FE_buttons_24',  variants: ['standard', 'grey', 'roll', 'select'] },
  { key: '48',  minW: 59, minH: 59,  label: 'FE_buttons_48',  folder: 'data/menu/symbols/FE_buttons_48',  variants: ['standard', 'grey', 'roll', 'select'] },
  { key: 'loading128', minW: 128, minH: 128, label: 'loading_screen/symbols', folder: 'data/loading_screen/symbols', variants: ['standard'] },
];

function tgaFilename(factionName, setKey, variant) {
  if (setKey === 'loading128') return `symbol128_${factionName}.tga`;
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
    const w = Math.max(set.minW, Number(val) || set.minW);
    const h = config.lockAspect ? Math.max(set.minH, Math.round(w * aspectH / aspectW)) : config.h;
    onChange({ ...config, w, h });
  };

  const handleH = (val) => {
    const h = Math.max(set.minH, Number(val) || set.minH);
    const w = config.lockAspect ? Math.max(set.minW, Math.round(h * aspectW / aspectH)) : config.w;
    onChange({ ...config, w, h });
  };

  const setNative = () => onChange({ ...config, w: set.minW, h: set.minH });
  const setSquare256 = () => onChange({ ...config, w: 256, h: 256, lockAspect: false });
  const toggleLock = () => {
    const lockAspect = !config.lockAspect;
    onChange({
      ...config,
      lockAspect,
      h: lockAspect ? Math.max(set.minH, Math.round(config.w * aspectH / aspectW)) : config.h,
    });
  };

  return (
    <div className="flex items-center gap-2 text-[10px] text-slate-400 flex-wrap">
      <span className="font-semibold text-slate-300 w-24">{set.label}</span>
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
      <button type="button" onClick={toggleLock} className={`px-1.5 py-0.5 rounded border ${config.lockAspect ? 'border-amber-600/60 text-amber-300' : 'border-slate-600 text-slate-400 hover:text-slate-200'}`}>
        {config.lockAspect ? 'locked' : 'free'}
      </button>
      <button type="button" onClick={setNative} className="px-1.5 py-0.5 rounded border border-slate-600 text-slate-400 hover:text-slate-200">native</button>
      <button type="button" onClick={setSquare256} className="px-1.5 py-0.5 rounded border border-slate-600 text-slate-400 hover:text-slate-200">256x256</button>
      <span className="text-slate-600">native {set.minW}x{set.minH}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SymbolGenerator({ factionName, onGeneratedSymbols }) {
  const [sourceImg, setSourceImg]     = useState(null);
  const [sourcePreview, setSourcePreview] = useState(null);
  const [generated, setGenerated]     = useState({});
  const [generating, setGenerating]   = useState(false);
  const [fitMode, setFitMode]         = useState('contain');
  const [rollMask, setRollMask]       = useState(null);   // HTMLImageElement + _preview
  const [selectMask, setSelectMask]   = useState(null);
  const generatedFramesRef = useRef({});

  // Per-set resolution configs
  const [setConfigs, setSetConfigs] = useState(() =>
    Object.fromEntries(DEFAULT_SETS.map(s => [s.key, { w: s.minW, h: s.minH, lockAspect: true }]))
  );

  const fileRef = useRef();

  useEffect(() => {
    generatedFramesRef.current = {};
    setGenerated({});
  }, [sourceImg, fitMode, setConfigs, rollMask, selectMask]);

  useEffect(() => () => revokeImagePreview(sourceImg), [sourceImg]);
  useEffect(() => () => revokeImagePreview(rollMask), [rollMask]);
  useEffect(() => () => revokeImagePreview(selectMask), [selectMask]);

  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const img = await loadImageFromFile(file);
      setSourceImg(img);
      setSourcePreview(img._preview);
      generatedFramesRef.current = {};
      setGenerated({});
    } catch (err) { console.error(err.message); }
    e.target.value = '';
  }, []);

  const loadMask = useCallback(async (img, setter) => {
    setter(img);
  }, []);

  const generate = useCallback(async () => {
    if (!sourceImg) return;
    setGenerating(true);
    try {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const { result, frames } = renderAllSymbols(sourceImg, setConfigs, fitMode, rollMask, selectMask);
      generatedFramesRef.current = frames;
      setGenerated(result);
      onGeneratedSymbols?.(result);
    } finally {
      setGenerating(false);
    }
  }, [sourceImg, fitMode, setConfigs, rollMask, selectMask, onGeneratedSymbols]);

  const downloadOne = useCallback((set, variant) => {
    if (!sourceImg) return;
    const id = `${set.key}_${variant}`;
    const filtered = generatedFramesRef.current[id] || renderSymbolVariant(sourceImg, set, variant, setConfigs, fitMode, rollMask, selectMask);
    const blob = encodeRgbaTga(filtered);
    downloadBlob(blob, tgaFilename(factionName, set.key, variant));
  }, [sourceImg, factionName, setConfigs, fitMode, rollMask, selectMask]);

  const downloadAll = useCallback(async () => {
    if (!sourceImg) return;
    const zip = new JSZip();
    const frames = Object.keys(generatedFramesRef.current).length
      ? generatedFramesRef.current
      : renderAllSymbols(sourceImg, setConfigs, fitMode, rollMask, selectMask).frames;
    for (const set of DEFAULT_SETS) {
      for (const variant of set.variants) {
        const id = `${set.key}_${variant}`;
        const frame = frames[id];
        if (!generated[id] || !frame) continue;
        const buf = tgaArrayBuffer(frame);
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
