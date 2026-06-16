import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Upload, Download, Plus, X, AlertCircle } from 'lucide-react';
import { encodeStringsBin, parseStringsBin } from '../strings/stringsBinCodec';
import { getStringsBinStore } from '@/lib/stringsBinStore';

function parseReligionsFull(text) {
  const religions = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^religion\s+(\S+)/i);
    if (m) {
      if (current) religions.push(current);
      current = { name: m[1], pip: '', antiPip: '' };
      continue;
    }
    if (!current) continue;
    const pm = line.match(/^icon\s+(.+)/i) || line.match(/^pip\s+(.+)/i);
    if (pm) { current.pip = pm[1].trim(); continue; }
    const am = line.match(/^anti_pip\s+(.+)/i) || line.match(/^antipip\s+(.+)/i);
    if (am) { current.antiPip = am[1].trim(); continue; }
  }
  if (current) religions.push(current);
  return religions;
}

function serializeReligions(religions) {
  return religions.map(r => {
    const lines = [`religion\t${r.name}`];
    if (r.pip) lines.push(`\ticon\t${r.pip}`);
    if (r.antiPip) lines.push(`\tanti_pip\t${r.antiPip}`);
    return lines.join('\n');
  }).join('\n\n');
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function ReligionsTab() {
  const [religions, setReligions] = useState([]);
  const [names, setNames] = useState({}); // internal→display from strings.bin
  const [binMeta, setBinMeta] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const txtInputRef = useRef(null);
  const binInputRef = useRef(null);

  // Auto-load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('m2tw_religions_file');
      if (raw) {
        setReligions(parseReligionsFull(raw));
        setLoaded(true);
      }
    } catch {}
    // Auto-load strings.bin for religion display names
    try {
      const store = getStringsBinStore();
      const relBinEntry = Object.entries(store).find(([k]) => k.toLowerCase().includes('religion'));
      if (relBinEntry?.[1]) {
        const map = {};
        for (const e of relBinEntry[1].entries) if (e.key) map[e.key] = e.value;
        setNames(map);
        setBinMeta(relBinEntry[1].sourceFormat === 'txt' ? null : { magic1: relBinEntry[1].magic1 ?? 2, magic2: relBinEntry[1].magic2 ?? 2048 });
      }
    } catch {}
  }, []);

  const handleLoadTxt = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    setReligions(parseReligionsFull(text));
    try {
      sessionStorage.setItem('m2tw_religions_raw', text);
      localStorage.setItem('m2tw_religions_file', text);
    } catch {}
    setLoaded(true);
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

  const handleExportTxt = () => {
    const text = serializeReligions(religions);
    downloadBlob(new Blob([text], { type: 'text/plain' }), 'descr_religions.txt');
  };

  const handleExportLookup = () => {
    const text = religions.map(r => r.name).join('\n');
    downloadBlob(new Blob([text], { type: 'text/plain' }), 'descr_religions_lookup.txt');
  };

  const handleExportBin = () => {
    const entries = Object.entries(names).map(([key, value]) => ({ key, value }));
    const buf = encodeStringsBin(entries, binMeta?.magic1, binMeta?.magic2);
    downloadBlob(new Blob([new Uint8Array(buf)]), 'descr_religions.txt.strings.bin');
  };

  const addReligion = () => {
    setReligions(prev => [...prev, { name: 'new_religion', pip: '', antiPip: '' }]);
  };

  const updateReligion = (idx, field, value) => {
    setReligions(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const removeReligion = (idx) => {
    setReligions(prev => prev.filter((_, i) => i !== idx));
  };

  const issues = useMemo(() => {
    const iss = [];
    const seen = new Set();
    for (const r of religions) {
      if (!r.name) iss.push('Empty religion name');
      if (seen.has(r.name)) iss.push(`Duplicate: ${r.name}`);
      seen.add(r.name);
    }
    return iss;
  }, [religions]);

  return (
    <div className="space-y-3">
      <input ref={txtInputRef} type="file" accept=".txt" className="hidden" onChange={handleLoadTxt} />
      <input ref={binInputRef} type="file" accept=".bin,.strings.bin" className="hidden" onChange={handleLoadBin} />

      <div className="flex flex-wrap gap-2">
        <button onClick={() => txtInputRef.current?.click()}
          className="cursor-pointer flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-slate-800 border border-slate-600/40 text-slate-300 hover:bg-slate-700 transition-colors">
          <Upload className="w-3 h-3" /> Load descr_religions.txt
        </button>
        <button onClick={() => binInputRef.current?.click()}
          className="cursor-pointer flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-slate-800 border border-slate-600/40 text-slate-300 hover:bg-slate-700 transition-colors">
          <Upload className="w-3 h-3" /> Load .strings.bin
        </button>
        <button onClick={handleExportTxt} disabled={!religions.length}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-amber-600/20 border border-amber-500/30 text-amber-400 hover:bg-amber-600/40 disabled:opacity-40 transition-colors">
          <Download className="w-3 h-3" /> Export .txt
        </button>
        <button onClick={handleExportLookup} disabled={!religions.length}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-blue-600/20 border border-blue-500/30 text-blue-400 hover:bg-blue-600/40 disabled:opacity-40 transition-colors">
          <Download className="w-3 h-3" /> Export lookup
        </button>
        <button onClick={handleExportBin} disabled={!Object.keys(names).length}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-amber-600/20 border border-amber-500/30 text-amber-400 hover:bg-amber-600/40 disabled:opacity-40 transition-colors">
          <Download className="w-3 h-3" /> Export .strings.bin
        </button>
      </div>

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
        {religions.map((r, idx) => (
          <div key={idx} className="rounded border border-slate-700/40 bg-slate-900/20 p-2 space-y-1">
            <div className="flex items-center gap-1.5">
              <input value={r.name} onChange={e => updateReligion(idx, 'name', e.target.value)}
                className="flex-1 h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
              <button onClick={() => removeReligion(idx)} className="text-slate-600 hover:text-red-400 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <span className="text-[9px] text-slate-500">Pip icon path</span>
                <div className="flex items-center gap-1">
                  <input value={r.pip} onChange={e => updateReligion(idx, 'pip', e.target.value)}
                    className="flex-1 h-5 px-1 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
                  {r.pip && window._m2tw_religion_pips?.[r.pip.split('/').pop()?.replace(/\.tga$/i, '').toLowerCase()] && (
                    <img src={window._m2tw_religion_pips[r.pip.split('/').pop().replace(/\.tga$/i, '').toLowerCase()]} className="w-5 h-5 rounded border border-slate-600/40 object-contain" />
                  )}
                </div>
              </div>
              <div>
                <span className="text-[9px] text-slate-500">Anti-pip path</span>
                <div className="flex items-center gap-1">
                  <input value={r.antiPip} onChange={e => updateReligion(idx, 'antiPip', e.target.value)}
                    className="flex-1 h-5 px-1 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
                  {r.antiPip && window._m2tw_religion_pips?.[r.antiPip.split('/').pop()?.replace(/\.tga$/i, '').toLowerCase()] && (
                    <img src={window._m2tw_religion_pips[r.antiPip.split('/').pop().replace(/\.tga$/i, '').toLowerCase()]} className="w-5 h-5 rounded border border-slate-600/40 object-contain" />
                  )}
                </div>
              </div>
              <div className="col-span-2">
                <span className="text-[9px] text-slate-500">Display Name</span>
                <input value={names[r.name] || ''} onChange={e => setNames(prev => ({ ...prev, [r.name]: e.target.value }))}
                  className="w-full h-5 px-1 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <button onClick={addReligion}
        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-dashed border-slate-600/40 text-slate-400 hover:text-slate-200 hover:border-slate-400 transition-colors">
        <Plus className="w-3 h-3" /> Add Religion
      </button>

      {!loaded && religions.length === 0 && (
        <p className="text-[10px] text-slate-600 text-center py-4">Load descr_religions.txt to start editing</p>
      )}
    </div>
  );
}
