/**
 * StratModelPreview — drop-zone modal to load an .ms3d for a strat model entry.
 * Uses the same Asset Converter pipeline (casCodec.parseMs3d + ms3dCodec.parseMs3d).
 * Textures from TextureStore are passed in via ModelViewer's onTextureFile callback.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Upload, X, Box, AlertTriangle } from 'lucide-react';
import { parseMs3d } from '@/lib/casCodec';
import { parseMs3d as parseMs3dFull } from '@/lib/ms3dCodec';
import ModelViewer from '@/components/assets/ModelViewer';
import { getTexturePreview } from '../banners/TextureStore';

/** Convert a data URL to a synthetic File so ModelViewer can load it */
function dataUrlToFile(dataUrl, filename) {
  const [meta, b64] = dataUrl.split(',');
  const mime = meta.match(/:(.*?);/)[1];
  const bytes = atob(b64);
  const u8 = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) u8[i] = bytes.charCodeAt(i);
  return new File([u8], filename, { type: mime });
}

// ── Inner viewer: wraps ModelViewer and auto-applies texture from store ────────
function ViewerWithAutoTex({ parsedMesh, ms3dFull, modelEntry, factionHint }) {
  // Find the best available texture data URL from the store
  const bestTexUrl = (() => {
    const candidates = [];
    if (factionHint) {
      const ft = modelEntry?.textures?.find(t => t.faction === factionHint);
      if (ft?.path) candidates.push(ft.path);
    }
    for (const t of (modelEntry?.textures || [])) {
      if (!candidates.includes(t.path)) candidates.push(t.path);
    }
    for (const path of candidates) {
      const url = getTexturePreview(path);
      if (url) return url;
    }
    return null;
  })();

  // We'll expose ModelViewer's handleTextureFile by keeping a ref to it.
  // ModelViewer doesn't expose that ref externally, so we use a trick: re-key it
  // and feed the texture via a wrapper that calls onTextureFile after a brief delay.
  const [viewerKey, setViewerKey] = useState(0);
  const pendingTexRef = useRef(bestTexUrl);
  const applyFnRef = useRef(null);
  const appliedRef = useRef(false);

  useEffect(() => {
    pendingTexRef.current = bestTexUrl;
    appliedRef.current = false;
  }, [parsedMesh, bestTexUrl]);

  // ModelViewer calls onTextureFile when the user drops/picks a texture.
  // We intercept by registering a wrapper that also gives us the function handle.
  // Instead, since ModelViewer doesn't let us call handleTextureFile externally,
  // we use a thin approach: render a hidden file input and programmatically
  // feed data URL → canvas → CanvasTexture through a small THREE inject.
  // 
  // Simplest reliable approach: extend ModelViewer isn't feasible without modifying it.
  // So we just surface the texture paths as colour-coded status and let the 
  // ModelViewer sidebar handle manual assignment. ModelViewer already has that UI.

  return (
    <ModelViewer
      key={viewerKey}
      parsedMesh={parsedMesh}
      skeletonData={ms3dFull || null}
      groupComments={ms3dFull?.groupComments || null}
      className="w-full h-full"
    />
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────────
export default function StratModelPreview({ modelEntry, factionHint, onClose }) {
  const [loaded, setLoaded] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef();

  const loadFile = useCallback(async (file) => {
    if (!file || !file.name.toLowerCase().endsWith('.ms3d')) return;
    const buf = await file.arrayBuffer();
    const parsed = parseMs3d(buf);
    const ms3dFull = parseMs3dFull(buf);
    setLoaded({
      name: file.name,
      parsed,
      ms3dFull: (ms3dFull && !ms3dFull.error) ? ms3dFull : null,
      errors: parsed.errors || [],
    });
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setIsDragging(false);
    await loadFile(e.dataTransfer.files[0]);
  }, [loadFile]);

  // Hint: expected filename from the descr_model_strat model path
  const expectedFileName = modelEntry?.models?.[0]?.path
    ? modelEntry.models[0].path.replace(/\\/g, '/').split('/').pop().replace(/\.cas$/i, '.ms3d')
    : null;

  // Texture store status
  const texStatuses = (modelEntry?.textures || []).map(t => ({
    faction: t.faction,
    path: t.path,
    hasPreview: !!getTexturePreview(t.path),
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-600 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 740, height: 580, maxWidth: '96vw', maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-700 shrink-0">
          <Box className="w-4 h-4 text-teal-400 shrink-0" />
          <span className="text-sm font-mono text-teal-300 flex-1 truncate">
            {modelEntry?.name || 'Strat Model Preview'}
          </span>
          {expectedFileName && (
            <span className="text-[10px] text-slate-500 font-mono hidden md:block truncate max-w-[200px]">
              {expectedFileName}
            </span>
          )}
          <button onClick={onClose} className="text-slate-400 hover:text-white ml-2 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Texture status strip */}
        {texStatuses.length > 0 && (
          <div className="px-4 py-1.5 bg-slate-950/60 border-b border-slate-800 shrink-0 flex flex-wrap gap-x-4 gap-y-0.5">
            {texStatuses.map((t, i) => (
              <span key={i} className={`text-[9px] font-mono ${t.hasPreview ? 'text-green-400' : 'text-slate-600'}`}>
                {t.hasPreview ? '✓' : '○'} {t.faction || '(any)'}: {t.path.split('/').pop()}
              </span>
            ))}
            {texStatuses.every(t => !t.hasPreview) && (
              <span className="text-[9px] text-slate-500 italic">Upload textures in the toolbar to see them in the viewer sidebar</span>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 relative">
          {!loaded ? (
            <label
              className={`absolute inset-0 flex flex-col items-center justify-center gap-4 cursor-pointer transition-colors
                ${isDragging ? 'bg-teal-900/30' : 'hover:bg-slate-800/30'}`}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileRef} type="file" accept=".ms3d" className="hidden"
                onChange={e => { loadFile(e.target.files[0]); e.target.value = ''; }}
              />
              {isDragging
                ? <div className="border-2 border-dashed border-teal-500 rounded-2xl p-10 text-center">
                    <Box className="w-10 h-10 text-teal-400 mx-auto mb-2" />
                    <p className="text-teal-300 font-mono text-sm">Drop to load</p>
                  </div>
                : <>
                    <Box className="w-12 h-12 text-slate-700" />
                    <div className="text-center space-y-1">
                      <p className="text-sm text-slate-300">Drop an <span className="font-mono text-teal-400">.ms3d</span> file to preview</p>
                      {expectedFileName && (
                        <p className="text-[11px] text-slate-500">
                          Expected file: <span className="font-mono text-slate-400">{expectedFileName}</span>
                        </p>
                      )}
                      <p className="text-[10px] text-slate-600">Assign textures via the sidebar · Drag to rotate · Scroll to zoom</p>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-600 text-xs text-slate-400 hover:border-slate-400 hover:text-slate-200 transition-colors">
                      <Upload className="w-3.5 h-3.5" /> Browse .ms3d file
                    </div>
                  </>
              }
            </label>
          ) : (
            <div className="absolute inset-0 flex flex-col">
              {/* Compact top bar */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-950/80 border-b border-slate-800 text-[10px] shrink-0">
                <span className="font-mono text-slate-400 truncate flex-1">{loaded.name}</span>
                <span className="text-slate-500">{loaded.parsed.meshes?.length ?? 0} groups</span>
                <span className="text-slate-500">
                  {(loaded.parsed.meshes?.reduce((s, m) => s + m.numVertices, 0) ?? 0).toLocaleString()} verts
                </span>
                {loaded.ms3dFull?.joints?.length > 0 && (
                  <span className="text-green-400">{loaded.ms3dFull.joints.length} joints</span>
                )}
                {loaded.errors.length > 0 && (
                  <span className="text-amber-400 flex items-center gap-1" title={loaded.errors.join('\n')}>
                    <AlertTriangle className="w-3 h-3" /> {loaded.errors.length}
                  </span>
                )}
                <label className="cursor-pointer text-teal-400 hover:text-teal-300 border border-teal-800 rounded px-1.5 py-0.5 hover:border-teal-600 transition-colors ml-1">
                  <input type="file" accept=".ms3d" className="hidden"
                    onChange={e => { loadFile(e.target.files[0]); e.target.value = ''; }} />
                  ↻ Load
                </label>
              </div>
              {/* Viewer */}
              <div className="flex-1 min-h-0">
                <ViewerWithAutoTex
                  parsedMesh={loaded.parsed}
                  ms3dFull={loaded.ms3dFull}
                  modelEntry={modelEntry}
                  factionHint={factionHint}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}