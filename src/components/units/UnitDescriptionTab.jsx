import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Section } from './UnitStatRow';
import { Upload, X, Download, Copy } from 'lucide-react';
import { decodeTgaToDataUrl } from '../shared/tgaDecoder';

// ── Helpers ──────────────────────────────────────────────────────────────────

function findMatchingKey(map, key) {
  if (!map || !key) return null;
  const lower = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(map, key)) return key;
  for (const k of Object.keys(map)) {
    const kl = k.toLowerCase();
    if (kl === lower || kl.endsWith(`/${lower}`)) return k;
  }
  return null;
}

function findImageSource(unitImages, key) {
  const images = { ...(typeof window !== 'undefined' ? window._m2tw_unit_images || {} : {}), ...(unitImages || {}) };
  const imageKey = findMatchingKey(images, key);
  if (imageKey && images[imageKey]) return { key: imageKey, dataUrl: images[imageKey] };

  const files = typeof window !== 'undefined' ? window._m2tw_unit_image_file_map || {} : {};
  const fileKey = findMatchingKey(files, key);
  if (fileKey && files[fileKey]) return { key: fileKey, file: files[fileKey] };

  return null;
}

function unitImageKeys(unitImages) {
  const keys = new Set(Object.keys(unitImages || {}));
  if (typeof window !== 'undefined') {
    for (const key of Object.keys(window._m2tw_unit_images || {})) keys.add(key);
    for (const key of Object.keys(window._m2tw_unit_image_file_map || {})) keys.add(key);
  }
  return [...keys];
}

function decodeUnitImageFile(file) {
  if (!file) return Promise.resolve(null);
  if (typeof window === 'undefined') {
    return file.arrayBuffer().then(buf => decodeTgaToDataUrl(buf));
  }
  if (!window._m2tw_unit_image_decode_promises) window._m2tw_unit_image_decode_promises = new WeakMap();
  const cache = window._m2tw_unit_image_decode_promises;
  if (!cache.has(file)) {
    cache.set(file, file.arrayBuffer().then(buf => decodeTgaToDataUrl(buf)));
  }
  return cache.get(file);
}

function cacheDecodedUnitImage(file, key, dataUrl) {
  if (typeof window === 'undefined' || !file || !dataUrl) return;
  const images = { ...(window._m2tw_unit_images || {}) };
  images[key] = dataUrl;
  for (const [mapKey, mappedFile] of Object.entries(window._m2tw_unit_image_file_map || {})) {
    if (mappedFile === file) images[mapKey] = dataUrl;
  }
  window._m2tw_unit_images = images;
}

// Encode canvas → TGA bytes (BGRA, uncompressed)
function encodeTGA(canvas, tw, th) {
  const off = document.createElement('canvas');
  off.width = tw; off.height = th;
  off.getContext('2d').drawImage(canvas, 0, 0, tw, th);
  const px = off.getContext('2d').getImageData(0, 0, tw, th).data;
  const header = new Uint8Array(18);
  header[2] = 2;
  header[12] = tw & 0xff; header[13] = (tw >> 8) & 0xff;
  header[14] = th & 0xff; header[15] = (th >> 8) & 0xff;
  header[16] = 32; header[17] = 0x28;
  const body = new Uint8Array(tw * th * 4);
  for (let i = 0; i < tw * th; i++) {
    body[i*4] = px[i*4+2]; body[i*4+1] = px[i*4+1];
    body[i*4+2] = px[i*4]; body[i*4+3] = px[i*4+3];
  }
  const out = new Uint8Array(18 + body.length);
  out.set(header); out.set(body, 18);
  return out;
}

function downloadTGA(dataUrl, filename, tw, th) {
  const img = new window.Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const bytes = encodeTGA(c, tw, th);
    const blob = new Blob([bytes], { type: 'image/x-tga' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = filename; a.click(); URL.revokeObjectURL(a.href);
  };
  img.src = dataUrl;
}

// CARD: 48×56 px   INFO: 260×350 px  (approximate M2TW sizes)
const SLOT_SIZES = { card: [48, 56], info: [260, 350] };

/**
 * Detect faction/culture sub-folders available for a given unit dictionary.
 * M2TW stores faction cards like: units/<faction>/#unit_name.tga
 * and info images like: unit_info/<faction>/unit_name_info.tga
 * We scan all keys in unitImages for any that contain the dictLower substring
 * and extract path segments that indicate sub-variants.
 */
function detectVariants(unitImages, dictLower) {
  const bare = dictLower.replace(/^#/, '');
  if (typeof window !== 'undefined') {
    const indexed = window._m2tw_unit_image_variant_index?.[bare];
    if (indexed?.length) return [...indexed].sort();
  }
  const variants = new Set();
  for (const key of unitImageKeys(unitImages)) {
    const kl = key.toLowerCase();
    // Match patterns like: .../something/unit_name or unit_name_info
    if (!kl.includes(bare)) continue;
    // Extract subfolder: split by /
    const parts = kl.split('/');
    if (parts.length >= 2) {
      // The segment just before the filename is likely a faction/culture folder
      const folder = parts[parts.length - 2];
      if (folder && folder !== 'units' && folder !== 'unit_info') {
        variants.add(folder);
      }
    }
  }
  return Array.from(variants).sort();
}

// ── UnitImageSlot ────────────────────────────────────────────────────────────

function UnitImageSlot({ label, imageKey, source, onUpload, onDelete, targetSize }) {
  const fileRef = useRef();
  const [preview, setPreview] = useState(null);
  const [loadedImg, setLoadedImg] = useState(source?.dataUrl || null);
  const [loading, setLoading] = useState(false);
  const [tw, th] = targetSize;

  useEffect(() => {
    let cancelled = false;
    setLoadedImg(source?.dataUrl || null);
    setLoading(false);

    if (!source?.file || source.dataUrl) return () => { cancelled = true; };

    setLoading(true);
    decodeUnitImageFile(source.file)
      .then(dataUrl => {
        if (cancelled || !dataUrl) return;
        setLoadedImg(dataUrl);
        cacheDecodedUnitImage(source.file, source.key, dataUrl);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [source?.key, source?.file, source?.dataUrl]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    let dataUrl;
    if (file.name.toLowerCase().endsWith('.tga')) {
      const buf = await file.arrayBuffer();
      dataUrl = decodeTgaToDataUrl(buf);
    } else {
      dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(file); });
    }
    if (!dataUrl) return;
    setPreview({ dataUrl, fileName: file.name });
  };

  const handleSave = () => {
    if (!preview) return;
    const baseName = imageKey.replace(/^#/, '');
    downloadTGA(preview.dataUrl, `${baseName}.tga`, tw, th);
    onUpload(imageKey, preview.dataUrl);
    setPreview(null);
  };

  return (
    <div className="flex flex-col items-center gap-1 group shrink-0">
      <span className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wide">{label}</span>
      {preview ? (
        <div className="flex flex-col items-center gap-1">
          <img src={preview.dataUrl} alt={label}
            className="border border-border rounded bg-black object-contain"
            style={{ maxWidth: tw * 2, maxHeight: th * 1.5, imageRendering: 'pixelated' }} />
          <p className="text-[9px] text-muted-foreground">→ {tw}×{th}px</p>
          <div className="flex gap-1">
            <button onClick={handleSave}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] rounded bg-primary text-primary-foreground hover:bg-primary/90">
              <Download className="w-2 h-2" /> Save .tga
            </button>
            <button onClick={() => setPreview(null)} className="text-[9px] text-muted-foreground hover:text-destructive px-1">✕</button>
          </div>
        </div>
      ) : loadedImg ? (
        <div className="relative">
          <img src={loadedImg} alt={label} className="border border-border rounded bg-black object-contain"
            style={{ imageRendering: 'pixelated', maxWidth: tw * 2, maxHeight: th * 1.5 }} />
          <button
            className="absolute -top-1 -right-1 bg-destructive/80 hover:bg-destructive rounded-full w-3.5 h-3.5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onDelete(imageKey)} title="Remove">
            <X className="w-2 h-2 text-white" />
          </button>
          <button
            className="absolute bottom-0 right-0 bg-black/60 rounded-tl text-[8px] text-white px-1 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => fileRef.current?.click()} title="Replace">↑</button>
          <button
            className="absolute bottom-0 left-0 bg-black/60 rounded-tr text-[8px] text-white px-1 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => downloadTGA(loadedImg, `${imageKey.replace(/^#/, '')}.tga`, tw, th)} title="Export .tga">↓</button>
        </div>
      ) : loading ? (
        <div className="border border-border rounded flex items-center justify-center text-[9px] text-muted-foreground bg-black/20"
          style={{ width: Math.min(tw, 80), height: Math.min(th, 96) }}>
          Loading…
        </div>
      ) : (
        <button onClick={() => fileRef.current?.click()}
          className="border border-dashed border-border rounded flex flex-col items-center justify-center gap-0.5 hover:border-primary/40 hover:bg-primary/5 transition-colors text-muted-foreground"
          style={{ width: Math.min(tw, 80), height: Math.min(th, 96) }}>
          <Upload className="w-3 h-3" />
          <span className="text-[7px] text-center leading-tight">Upload</span>
          <span className="text-[7px] opacity-60">{tw}×{th}</span>
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*,.tga,.dds" className="hidden" onChange={handleFile} />
    </div>
  );
}

// ── ImagesPanel — images for a given variant (or default) ────────────────────

function ImagesPanel({ dictLower, variant, unitImages, onImageUpload, onImageDelete }) {
  // Build keys depending on variant
  // Default: #dictLower (card), dictLower_info (info)
  // Faction/culture variant: units/<variant>/#dictLower (card), unit_info/<variant>/dictLower_info (info)
  const cardKey = variant ? `units/${variant}/#${dictLower}` : `#${dictLower}`;
  const infoKey = variant ? `unit_info/${variant}/${dictLower}_info` : `${dictLower}_info`;

  const cardSource = findImageSource(unitImages, cardKey) || findImageSource(unitImages, `#${dictLower}`);
  const infoSource = findImageSource(unitImages, infoKey) || findImageSource(unitImages, `${dictLower}_info`);

  return (
    <div className="flex items-end justify-center gap-8 py-4 border border-border rounded-lg bg-card/40">
      <UnitImageSlot
        label="Unit Card"
        imageKey={cardKey}
        source={cardSource}
        onUpload={onImageUpload}
        onDelete={onImageDelete}
        targetSize={SLOT_SIZES.card}
      />
      <UnitImageSlot
        label="Unit Info"
        imageKey={infoKey}
        source={infoSource}
        onUpload={onImageUpload}
        onDelete={onImageDelete}
        targetSize={SLOT_SIZES.info}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UnitDescriptionTab({ dictionary, descr, onDescrChange, unitImages, onImageUpload, onImageDelete }) {
  const [imageTab, setImageTab] = useState('default');
  const [copiedString, setCopiedString] = useState(false);
  // Sub-tab for descriptions (future: per-culture if needed)
  // For now description editing stays single; images are per-variant.

  const name  = descr?.name  ?? '';
  const long  = descr?.long  ?? '';
  const short = descr?.short ?? '';

  const set = (key, val) => onDescrChange({ ...(descr || {}), [key]: val });

  const dictLower = (dictionary || '').toLowerCase();
  const unitString = [
    `{${dictionary}}\t${name}`,
    `{${dictionary}_descr}`,
    long,
    `{${dictionary}_descr_short}`,
    short,
  ].join('\n');

  const copyUnitString = async () => {
    await navigator.clipboard.writeText(unitString);
    setCopiedString(true);
    setTimeout(() => setCopiedString(false), 1600);
  };

  // Detect what faction/culture image variants are available in the loaded images
  const variants = useMemo(() => detectVariants(unitImages, dictLower), [unitImages, dictLower]);

  const allImageTabs = ['default', ...variants];

  return (
    <div className="p-4 space-y-4">

      {/* ── Images section with sub-tabs ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mr-1">Images:</span>
          {allImageTabs.map(tab => (
            <button
              key={tab}
              onClick={() => setImageTab(tab)}
              className={`px-2 py-0.5 text-[10px] rounded border transition-colors capitalize ${
                imageTab === tab
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              {tab === 'default' ? 'Default' : tab}
            </button>
          ))}
          {variants.length === 0 && (
            <span className="text-[9px] text-muted-foreground italic ml-1">
              (load UI images folder to see faction/culture variants)
            </span>
          )}
        </div>

        <ImagesPanel
          dictLower={dictLower}
          variant={imageTab === 'default' ? null : imageTab}
          unitImages={unitImages}
          onImageUpload={onImageUpload}
          onImageDelete={onImageDelete}
        />
      </div>

      {/* ── Name & Descriptions ── */}
      <Section title="Name & Descriptions">
        <p className="text-[10px] text-muted-foreground mb-2">
          Editing <code className="font-mono bg-accent px-1 rounded">{`{${dictionary}}`}</code> entries in{' '}
          <code className="font-mono bg-accent px-1 rounded">data/text/export_units.txt</code>
        </p>

        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground font-medium block">Display Name</label>
          <input
            value={name}
            onChange={e => set('name', e.target.value)}
            placeholder="Unit display name"
            className="w-full h-8 px-2 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground font-medium block">
            Full Description <span className="opacity-60 font-mono text-[9px]">{`{${dictionary}_descr}`}</span>
          </label>
          <textarea
            value={long}
            onChange={e => set('long', e.target.value)}
            rows={6}
            placeholder="Full description shown in the unit info panel..."
            className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary text-foreground font-sans resize-y leading-relaxed"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground font-medium block">
            Short Description <span className="opacity-60 font-mono text-[9px]">{`{${dictionary}_descr_short}`}</span>
          </label>
          <textarea
            value={short}
            onChange={e => set('short', e.target.value)}
            rows={3}
            placeholder="Short description shown in recruitment and custom battles..."
            className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary text-foreground font-sans resize-y leading-relaxed"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label className="text-[10px] text-muted-foreground font-medium block">RTW text string</label>
            <button
              onClick={copyUnitString}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <Copy className="w-3 h-3" />
              {copiedString ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 text-[10px] leading-relaxed text-muted-foreground font-mono">
            {unitString}
          </pre>
        </div>
      </Section>
    </div>
  );
}
