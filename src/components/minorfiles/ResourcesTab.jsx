import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Upload, Download, Plus, X, AlertCircle, ImageIcon } from 'lucide-react';
import { encodeStringsBin, parseStringsBin } from '../strings/stringsBinCodec';
import { getStringsBinStore } from '@/lib/stringsBinStore';
import { decodeTgaToDataUrl } from '@/components/shared/tgaDecoder';
import { parseTextLocFile } from '@/lib/textLocParser';

function parseResourcesFull(text) {
  const resources = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^type\s+(\S+)/i);
    if (m) {
      if (current) resources.push(current);
      current = { name: m[1], tradeValue: 0, model: '', icon: '', hasMine: false };
      continue;
    }
    if (!current) continue;
    let pm;
    if ((pm = line.match(/^trade_value\s+(\d+)/i))) { current.tradeValue = parseInt(pm[1]); continue; }
    if ((pm = line.match(/^model\s+(.+)/i))) { current.model = pm[1].trim(); continue; }
    if ((pm = line.match(/^icon\s+(.+)/i))) { current.icon = pm[1].trim(); continue; }
    if (/^has_mine/i.test(line)) { current.hasMine = true; continue; }
  }
  if (current) resources.push(current);
  return resources;
}

function serializeResources(resources) {
  return resources.map(r => {
    const lines = [`type\t\t\t${r.name}`];
    lines.push(`trade_value\t\t${r.tradeValue}`);
    if (r.model) lines.push(`model\t\t\t${r.model}`);
    if (r.icon) lines.push(`icon\t\t\t${r.icon}`);
    if (r.hasMine) lines.push('has_mine');
    return lines.join('\n');
  }).join('\n\n');
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

/** Derive the window._m2tw_resource_icons key from an icon path or resource name.
 *  icon path e.g. "data/ui/resources/resource_silver.tga" → key "resource_silver"
 *  fallback: try just the resource name e.g. "silver"
 */
function getIconKey(iconPath, resourceName) {
  if (iconPath) {
    const parts = iconPath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1].replace(/\.tga$/i, '').toLowerCase();
  }
  return resourceName?.toLowerCase() || '';
}

function useResourceIcons() {
  const [icons, setIcons] = useState(() => window._m2tw_resource_icons || {});
  useEffect(() => {
    const handler = (e) => setIcons(prev => ({ ...prev, ...(e.detail || {}) }));
    window.addEventListener('load-resource-icons', handler);
    return () => window.removeEventListener('load-resource-icons', handler);
  }, []);
  return icons;
}

export default function ResourcesTab() {
  const [resources, setResources] = useState([]);
  const [names, setNames] = useState({});
  const [binMeta, setBinMeta] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const txtInputRef = useRef(null);
  const binInputRef = useRef(null);
  const stratTxtInputRef = useRef(null);
  const resourceIcons = useResourceIcons();
  // Per-resource upload refs (keyed by index)
  const imgUploadRefs = useRef({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem('m2tw_resources_file');
      if (raw) { setResources(parseResourcesFull(raw)); setLoaded(true); }
    } catch {}
    try {
      const store = getStringsBinStore();
      const stratBinEntry = Object.entries(store).find(([k]) => {
        const lk = k.toLowerCase();
        return lk === 'strat.txt.strings.bin' || lk === 'strat.txt' || (lk.includes('strat') && (lk.endsWith('.bin') || lk.endsWith('.txt')));
      });
      if (stratBinEntry?.[1]) {
        const map = {};
        for (const e of stratBinEntry[1].entries) if (e.key) map[e.key] = e.value;
        setNames(map);
        setBinMeta(stratBinEntry[1].sourceFormat === 'txt' ? null : { magic1: stratBinEntry[1].magic1 ?? 2, magic2: stratBinEntry[1].magic2 ?? 2048 });
      }
    } catch {}
  }, []);

  const handleLoadTxt = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    setResources(parseResourcesFull(text));
    try { sessionStorage.setItem('m2tw_sm_resources_raw', text); localStorage.setItem('m2tw_resources_file', text); } catch {}
    setLoaded(true);
    e.target.value = '';
  };

  const handleLoadStratTxt = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    setNames(parseTextLocFile(text));
    setBinMeta(null);
    e.target.value = '';
  };

  const handleLoadBin = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const buf = await file.arrayBuffer();
    const decoded = parseStringsBin(buf);
    if (decoded?.entries) {
      const map = {};
      for (const { key, value } of decoded.entries) if (key) map[key] = value;
      setNames(map);
      setBinMeta({ magic1: decoded.magic1, magic2: decoded.magic2 });
    }
    e.target.value = '';
  };

  // Handle per-resource TGA image upload
  const handleImageUpload = async (e, idx) => {
    const file = e.target.files?.[0]; if (!file) return;
    const isTga = file.name.toLowerCase().endsWith('.tga');
    let dataUrl = null;
    if (isTga) {
      const buf = await file.arrayBuffer();
      dataUrl = decodeTgaToDataUrl(buf);
    } else {
      // Accept PNG/JPG as preview only (can't re-encode as TGA here, but store as dataUrl)
      dataUrl = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result);
        reader.readAsDataURL(file);
      });
    }
    if (!dataUrl) return;

    // Derive the icon key from the resource's icon path, or build a default path
    const r = resources[idx];
    let iconPath = r.icon;
    if (!iconPath) {
      iconPath = `data/ui/resources/resource_${r.name}.tga`;
      updateResource(idx, 'icon', iconPath);
    }
    const key = getIconKey(iconPath, r.name);

    // Inject into the global icons store so StratOverlay picks it up too
    window._m2tw_resource_icons = { ...(window._m2tw_resource_icons || {}), [key]: dataUrl };
    window.dispatchEvent(new CustomEvent('load-resource-icons', { detail: { [key]: dataUrl } }));

    e.target.value = '';
  };

  const resourceBinKey = (name) => `{SMT_RESOURCE_${name.toUpperCase()}}`;
  const getDisplayName = (name) => names[resourceBinKey(name)] ?? '';
  const setDisplayName = (name, displayName) => {
    setNames(prev => ({ ...prev, [resourceBinKey(name)]: displayName }));
  };

  const handleExportTxt = () => {
    downloadBlob(new Blob([serializeResources(resources)], { type: 'text/plain' }), 'descr_sm_resources.txt');
  };

  const handleExportBin = () => {
    const entries = Object.entries(names).map(([key, value]) => ({ key, value }));
    const buf = encodeStringsBin(entries, binMeta?.magic1, binMeta?.magic2);
    downloadBlob(new Blob([new Uint8Array(buf)]), 'strat.txt.strings.bin');
  };

  const addResource = () => {
    const newName = 'new_resource';
    setResources(prev => [...prev, { name: newName, tradeValue: 0, model: '', icon: '', hasMine: false }]);
    setNames(prev => ({ ...prev, [resourceBinKey(newName)]: 'New Resource' }));
  };

  const updateResource = (idx, field, value) => {
    setResources(prev => {
      const old = prev[idx];
      if (field === 'name' && old) {
        const oldKey = resourceBinKey(old.name);
        const newKey = resourceBinKey(value);
        if (oldKey !== newKey) {
          setNames(p => {
            const next = { ...p };
            next[newKey] = next[oldKey] ?? value;
            delete next[oldKey];
            return next;
          });
        }
      }
      return prev.map((r, i) => i === idx ? { ...r, [field]: value } : r);
    });
  };

  const removeResource = (idx) => {
    setResources(prev => prev.filter((_, i) => i !== idx));
  };

  const issues = useMemo(() => {
    const iss = [];
    const seen = new Set();
    for (const r of resources) {
      if (!r.name) iss.push('Empty resource name');
      if (seen.has(r.name)) iss.push(`Duplicate: ${r.name}`);
      seen.add(r.name);
    }
    return iss;
  }, [resources]);

  return (
    <div className="space-y-3">
      <input ref={txtInputRef} type="file" accept=".txt" className="hidden" onChange={handleLoadTxt} />
      <input ref={binInputRef} type="file" accept=".bin,.strings.bin" className="hidden" onChange={handleLoadBin} />
      <input ref={stratTxtInputRef} type="file" accept=".txt" className="hidden" onChange={handleLoadStratTxt} />

      {/* Top toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Add Resource — prominent at top */}
        <button onClick={addResource}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-semibold bg-amber-500/20 border border-amber-400/50 text-amber-300 hover:bg-amber-500/35 hover:border-amber-400 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Resource
        </button>

        <div className="w-px h-4 bg-slate-700" />

        <button onClick={() => txtInputRef.current?.click()}
          className="cursor-pointer flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-slate-800 border border-slate-600/40 text-slate-300 hover:bg-slate-700 transition-colors">
          <Upload className="w-3 h-3" /> Load resources.txt
        </button>
        <button onClick={() => binInputRef.current?.click()}
          className="cursor-pointer flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-slate-800 border border-slate-600/40 text-slate-300 hover:bg-slate-700 transition-colors">
          <Upload className="w-3 h-3" /> Load strat.strings.bin
        </button>
        <button onClick={() => stratTxtInputRef.current?.click()}
          className="cursor-pointer flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-slate-800 border border-slate-600/40 text-slate-300 hover:bg-slate-700 transition-colors">
          <Upload className="w-3 h-3" /> Load strat.txt
        </button>
        <button onClick={handleExportTxt} disabled={!resources.length}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-amber-600/20 border border-amber-500/30 text-amber-400 hover:bg-amber-600/40 disabled:opacity-40 transition-colors">
          <Download className="w-3 h-3" /> Export .txt
        </button>
        <button onClick={handleExportBin} disabled={!Object.keys(names).length}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-amber-600/20 border border-amber-500/30 text-amber-400 hover:bg-amber-600/40 disabled:opacity-40 transition-colors">
          <Download className="w-3 h-3" /> Export .strings.bin
        </button>
      </div>

      <p className="text-[9px] text-slate-500 italic">
        Bin keys format: <code className="text-slate-400">{'{SMT_RESOURCE_<NAME>}'}Display Name</code> — e.g. <code className="text-slate-400">{'{SMT_RESOURCE_GOLD}'}Gold</code>.
      </p>

      {issues.length > 0 && (
        <div className="rounded border border-red-500/30 bg-red-900/10 p-2 space-y-0.5">
          {issues.map((iss, i) => (
            <div key={i} className="flex items-center gap-1 text-[10px] text-red-400">
              <AlertCircle className="w-3 h-3 shrink-0" /> {iss}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        {resources.map((r, idx) => {
          const iconKey = getIconKey(r.icon, r.name);
          const iconUrl = resourceIcons[iconKey]
            || resourceIcons[`resource_${r.name.toLowerCase()}`]
            || null;

          return (
            <div key={idx} className="rounded border border-slate-700/40 bg-slate-900/20 p-2 space-y-1.5">
              {/* Row 1: icon preview + name + mine + delete */}
              <div className="flex items-center gap-2">
                {/* Icon preview / upload button */}
                <div className="relative shrink-0">
                  <input
                    type="file"
                    accept=".tga,.png,.jpg,.jpeg"
                    className="hidden"
                    ref={el => imgUploadRefs.current[idx] = el}
                    onChange={e => handleImageUpload(e, idx)}
                  />
                  <button
                    title="Upload icon (.tga)"
                    onClick={() => imgUploadRefs.current[idx]?.click()}
                    className="w-9 h-9 rounded border border-slate-600/50 bg-slate-800 hover:border-amber-400/60 hover:bg-slate-700 transition-colors flex items-center justify-center overflow-hidden"
                  >
                    {iconUrl ? (
                      <img src={iconUrl} alt={r.name} className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
                    ) : (
                      <ImageIcon className="w-4 h-4 text-slate-500" />
                    )}
                  </button>
                </div>

                <input value={r.name} onChange={e => updateResource(idx, 'name', e.target.value)}
                  className="flex-1 h-7 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono"
                  placeholder="Internal name" />
                <label className="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer shrink-0">
                  <input type="checkbox" checked={r.hasMine}
                    onChange={e => updateResource(idx, 'hasMine', e.target.checked)}
                    className="w-3 h-3 accent-amber-500" />
                  mine
                </label>
                <button onClick={() => removeResource(idx)} className="text-slate-600 hover:text-red-400 transition-colors shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Row 2: trade value / model / icon path */}
              <div className="grid grid-cols-3 gap-1.5">
                <div>
                  <span className="text-[9px] text-slate-500">Trade Value</span>
                  <input type="number" value={r.tradeValue} onChange={e => updateResource(idx, 'tradeValue', parseInt(e.target.value) || 0)}
                    className="w-full h-5 px-1 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
                </div>
                <div>
                  <span className="text-[9px] text-slate-500">Model (.cas)</span>
                  <input value={r.model} onChange={e => updateResource(idx, 'model', e.target.value)}
                    className="w-full h-5 px-1 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
                </div>
                <div>
                  <span className="text-[9px] text-slate-500">Icon path (.tga)</span>
                  <input value={r.icon} onChange={e => updateResource(idx, 'icon', e.target.value)}
                    className="w-full h-5 px-1 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
                </div>
              </div>

              {/* Row 3: bin key + display name */}
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <span className="text-[9px] text-slate-500">Bin Key (auto)</span>
                  <input value={resourceBinKey(r.name)} readOnly
                    className="w-full h-5 px-1 text-[10px] bg-slate-800/50 border border-slate-700/30 rounded text-slate-500 font-mono cursor-default" />
                </div>
                <div>
                  <span className="text-[9px] text-slate-500">Display Name</span>
                  <input value={getDisplayName(r.name)}
                    onChange={e => setDisplayName(r.name, e.target.value)}
                    className="w-full h-5 px-1 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!loaded && resources.length === 0 && (
        <p className="text-[10px] text-slate-600 text-center py-4">Load descr_sm_resources.txt to start editing</p>
      )}
    </div>
  );
}
