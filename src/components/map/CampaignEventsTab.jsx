import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Download, Upload, Image, X } from 'lucide-react';
import { EVENT_TYPES, serializeCampaignEvents } from './campaignEventsParser';
import { downloadBlob, exportTGA } from './tgaExporter';
import PositionPickerButton from './PositionPickerButton';
import ImageCropModal from '../edb/ImageCropModal';
import { getTextLocalizationStore } from '../../lib/textLocalizationStore';
import { serializeTextLocFile } from '../../lib/textLocParser';

const toCRLF = (text) => text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');

const EVENT_ICONS = {
  historic: '📜', earthquake: '🌋', volcano: '🌋', flood: '🌊',
  storm: '⛈️', horde: '⚔️', dustbowl: '🌪️', locusts: '🦗', plague: '☣️',
};

// Read historic_events.txt from the shared localization store
function getHistoricEventStrings() {
  try {
    const store = getTextLocalizationStore();
    for (const [fname, binData] of Object.entries(store)) {
      if (fname.toLowerCase().includes('historic_events')) {
        const map = {};
        for (const { key, value } of (binData.entries || [])) {
          if (key) map[key.toUpperCase()] = value;
        }
        return { map, fname, entries: binData.entries || [] };
      }
    }
  } catch {}
  return { map: {}, fname: null, entries: [] };
}

// Parse culture list from loaded descr_sm_factions.txt
function getCultureList() {
  try {
    const raw = sessionStorage.getItem('m2tw_factions_raw') || localStorage.getItem('m2tw_factions_file') || '';
    const cultures = [...raw.matchAll(/^culture\s+(\S+)/gim)].map(m => m[1]);
    return [...new Set(cultures)].filter(Boolean);
  } catch {}
  return [];
}

// Get existing event pic data url for a given event name / culture from window store
function getEventPic(eventName, culture) {
  try {
    const store = window._m2tw_event_pics || {};
    const key = `${culture}/${eventName}`.toLowerCase();
    return store[key] || store[eventName.toLowerCase()] || null;
  } catch {}
  return null;
}

function EventRow({ event, idx, onChange, onDelete, onPickFromMap }) {
  const [expanded, setExpanded] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [pendingDataUrl, setPendingDataUrl] = useState(null);
  const [imgW, setImgW] = useState(367);
  const [imgH, setImgH] = useState(148);
  // Selected cultures for image visibility — empty set = all cultures
  const [selectedCultures, setSelectedCultures] = useState(new Set());
  const fileRef = useRef();

  const ev = event;
  const set = (key, val) => onChange(idx, { ...ev, [key]: val });

  const addPos = (val) => { if (!val) return; onChange(idx, { ...ev, positions: [...(ev.positions || []), val] }); };
  const removePos = (val) => onChange(idx, { ...ev, positions: ev.positions.filter(p => p !== val) });

  // Strings from text localization store
  const { map: stringsMap } = useMemo(() => getHistoricEventStrings(), []);
  const cultureList = useMemo(() => getCultureList(), []);

  // Toggle a culture in the selectedCultures set
  const toggleCulture = (culture) => {
    setSelectedCultures(prev => {
      const next = new Set(prev);
      if (next.has(culture)) next.delete(culture); else next.add(culture);
      return next;
    });
  };

  // allCultures selected = empty set (means all); otherwise specific cultures
  const effectiveCultures = selectedCultures.size === 0 ? ['all'] : [...selectedCultures];

  const nameUpper = (ev.name || '').toUpperCase();
  const titleKey = `${nameUpper}_TITLE`;
  const bodyKey = `${nameUpper}_BODY`;

  const titleFromText = stringsMap[titleKey] || '';
  const bodyFromText = stringsMap[bodyKey] || '';

  const titleValue = ev._title !== undefined ? ev._title : titleFromText;
  const bodyValue = ev._body !== undefined ? ev._body : bodyFromText;

  const handleImageFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (ev2) => {
      setPendingDataUrl(ev2.target.result);
      setCropOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const handleCropConfirm = (dataUrl, canvas) => {
    setCropOpen(false);
    setPendingDataUrl(null);
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    set('_imageData', { data: Array.from(imgData.data), width: canvas.width, height: canvas.height, dataUrl });
  };

  const handleExportImage = (culture) => {
    const img = ev._imageData;
    if (!img) return;
    const clampedData = new Uint8ClampedArray(img.data);
    const blob = exportTGA(clampedData, img.width, img.height);
    const fname = `${ev.name || 'event'}.tga`;
    downloadBlob(blob, fname);
  };

  // Existing pic from the imported eventpics store — refresh when pics are loaded
  const [picTick, setPicTick] = useState(0);
  useEffect(() => {
    const h = () => setPicTick(t => t + 1);
    window.addEventListener('load-event-pics', h);
    return () => window.removeEventListener('load-event-pics', h);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const existingPic = useMemo(() => getEventPic(ev.name || '', 'all'), [ev.name, picTick]);

  // Derive export path hint
  const exportPathHint = useMemo(() => {
    const name = ev.name || 'event_name';
    if (selectedCultures.size === 0) {
      return `data\\ui\\[culture]\\eventpics\\${name}.tga  ← copy to each culture folder`;
    }
    return [...selectedCultures].map(c => `data\\ui\\${c}\\eventpics\\${name}.tga`).join('\n');
  }, [selectedCultures, ev.name]);

  return (
    <div className="rounded border border-slate-700/40 bg-slate-900/20">
      <div className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer" onClick={() => setExpanded(v => !v)}>
        {expanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
        <span className="text-base shrink-0">{EVENT_ICONS[ev.eventType] || '📌'}</span>
        <span className={`text-[9px] font-mono shrink-0 ${ev.eventType === 'historic' ? 'text-amber-500' : 'text-red-400'}`}>{ev.eventType}</span>
        <span className="text-[11px] font-mono flex-1 truncate text-slate-200">{ev.name || '—'}</span>
        <span className="text-[9px] text-slate-500 font-mono shrink-0">turn {ev.date}</span>
        <button onClick={e => { e.stopPropagation(); onDelete(idx); }}
          className="p-0.5 text-slate-600 hover:text-red-400 transition-colors">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-700/40 px-2 py-2 space-y-1.5">
          {/* Type + Name */}
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <span className="text-[9px] text-slate-500">Event Type</span>
              <select value={ev.eventType} onChange={e => set('eventType', e.target.value)}
                className="w-full h-6 px-1 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200">
                {EVENT_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <span className="text-[9px] text-slate-500">Internal Name</span>
              <input value={ev.name} onChange={e => set('name', e.target.value)}
                placeholder="event_name"
                className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
            </div>
          </div>

          {/* Title and Body from text localization */}
          <div>
            <div className="flex items-center gap-1 mb-0.5">
              <span className="text-[9px] text-slate-500">Title</span>
              <span className="text-[8px] text-cyan-600 font-mono">{titleKey}</span>
            </div>
            <input
              value={titleValue}
              onChange={e => set('_title', e.target.value)}
              placeholder={titleFromText || 'Load historic_events.txt...'}
              className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200"
            />
          </div>
          <div>
            <div className="flex items-center gap-1 mb-0.5">
              <span className="text-[9px] text-slate-500">Body</span>
              <span className="text-[8px] text-cyan-600 font-mono">{bodyKey}</span>
            </div>
            <textarea
              value={bodyValue}
              onChange={e => set('_body', e.target.value)}
              placeholder={bodyFromText || 'Enter event text...'}
              rows={3}
              className="w-full px-1.5 py-1 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 resize-y font-mono"
            />
          </div>

          {/* Turn number */}
          <div>
            <span className="text-[9px] text-slate-500">Turn number</span>
            <input value={ev.date} onChange={e => set('date', e.target.value)}
              placeholder="50"
              className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
          </div>

          {/* Movie */}
          <div>
            <span className="text-[9px] text-slate-500">Movie (optional, relative to data/fmv/)</span>
            <input value={ev.movie || ''} onChange={e => set('movie', e.target.value)}
              placeholder="event/gunpowder_invented.bik"
              className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
          </div>

          {/* Picture / Image */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-slate-500 uppercase font-semibold flex-1">Picture (.tga)</span>
              <input type="number" value={imgW} onChange={e => setImgW(parseInt(e.target.value) || 367)} min={1} max={1024}
                className="w-12 h-5 px-1 text-[9px] bg-slate-800 border border-slate-600/40 rounded text-slate-300 font-mono text-center" title="Width" />
              <span className="text-[9px] text-slate-600">×</span>
              <input type="number" value={imgH} onChange={e => setImgH(parseInt(e.target.value) || 148)} min={1} max={1024}
                className="w-12 h-5 px-1 text-[9px] bg-slate-800 border border-slate-600/40 rounded text-slate-300 font-mono text-center" title="Height" />
              <span className="text-[8px] text-slate-700 font-mono">px</span>
            </div>

            {/* Culture toggle buttons */}
            {cultureList.length > 0 && (
              <div className="space-y-0.5">
                <span className="text-[9px] text-slate-500">Visible to cultures <span className="text-slate-700">(none selected = all)</span></span>
                <div className="flex flex-wrap gap-1">
                  {cultureList.map(c => {
                    const active = selectedCultures.has(c);
                    return (
                      <button key={c} onClick={() => toggleCulture(c)}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-mono border transition-colors ${active ? 'bg-cyan-600/30 border-cyan-500/60 text-cyan-300' : 'bg-slate-800/60 border-slate-600/40 text-slate-500 hover:text-slate-300'}`}>
                        {c}
                      </button>
                    );
                  })}
                </div>
                {selectedCultures.size > 0 && selectedCultures.size < cultureList.length && (
                  <p className="text-[8px] text-amber-400 leading-tight">⚠ Image must exist in ALL culture folders or the game will crash.</p>
                )}
              </div>
            )}

            {/* Image area with upload inside */}
            <div className="relative rounded border border-dashed border-slate-600/50 bg-slate-800/20 overflow-hidden" style={{ minHeight: '72px' }}>
              {ev._imageData ? (
                <>
                  <img src={ev._imageData.dataUrl} alt="event" className="w-full object-contain" style={{ maxHeight: '100px' }} />
                  <div className="absolute top-1 right-1 flex gap-1">
                    <button onClick={() => handleExportImage()}
                      className="flex items-center gap-0.5 h-5 px-1.5 rounded bg-amber-600/80 border border-amber-500/60 text-amber-100 hover:bg-amber-600 text-[9px] transition-colors shadow">
                      <Download className="w-2.5 h-2.5" /> .tga
                    </button>
                    <label className="cursor-pointer flex items-center gap-0.5 h-5 px-1.5 rounded bg-slate-700/80 border border-slate-500/60 text-slate-200 hover:text-white text-[9px] shadow">
                      <Upload className="w-2.5 h-2.5" /> Replace
                      <input ref={fileRef} type="file" accept="image/*,.tga" className="hidden" onChange={handleImageFile} />
                    </label>
                    <button onClick={() => set('_imageData', null)}
                      className="h-5 w-5 flex items-center justify-center rounded bg-red-800/80 border border-red-600/60 text-red-200 hover:bg-red-700 shadow">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </>
              ) : existingPic ? (
                <>
                  <img src={existingPic} alt="event (imported)" className="w-full object-contain opacity-70" style={{ maxHeight: '100px' }} />
                  <div className="absolute top-1 right-1 flex gap-1">
                    <label className="cursor-pointer flex items-center gap-0.5 h-5 px-1.5 rounded bg-slate-700/80 border border-slate-500/60 text-slate-200 hover:text-white text-[9px] shadow">
                      <Upload className="w-2.5 h-2.5" /> Replace
                      <input ref={fileRef} type="file" accept="image/*,.tga" className="hidden" onChange={handleImageFile} />
                    </label>
                  </div>
                  <p className="absolute bottom-0.5 left-1 text-[8px] text-slate-500 italic">from imported files</p>
                </>
              ) : (
                <label className="cursor-pointer flex flex-col items-center justify-center gap-1 h-[72px] w-full text-slate-600 hover:text-slate-400 transition-colors">
                  <Image className="w-5 h-5" />
                  <span className="text-[9px]">Click to upload image</span>
                  <input ref={fileRef} type="file" accept="image/*,.tga" className="hidden" onChange={handleImageFile} />
                </label>
              )}
            </div>

            {/* Export path hint */}
            {(ev._imageData || existingPic) && (
              <p className="text-[8px] text-slate-600 font-mono leading-tight break-all whitespace-pre-line">{exportPathHint}</p>
            )}
          </div>

          {/* Positions */}
          <div>
            <span className="text-[9px] text-slate-500">Positions (x, y — optional)</span>
            <div className="space-y-0.5 mb-0.5">
              {(ev.positions || []).map((p, i) => (
                <div key={i} className="flex items-center gap-1">
                  <span className="text-[9px] text-slate-300 font-mono flex-1">{p}</span>
                  <button onClick={() => removePos(p)} className="text-slate-600 hover:text-red-400"><Trash2 className="w-2.5 h-2.5" /></button>
                </div>
              ))}
            </div>
            <PositionPickerButton onAdd={addPos} onPickFromMap={onPickFromMap} />
          </div>
        </div>
      )}

      {/* Image crop modal */}
      {cropOpen && pendingDataUrl && (
        <ImageCropModal
          open={cropOpen}
          onClose={() => { setCropOpen(false); setPendingDataUrl(null); }}
          onConfirm={handleCropConfirm}
          sourceDataUrl={pendingDataUrl}
          targetW={imgW}
          targetH={imgH}
          slotLabel={`${ev.name || 'event'} picture`}
        />
      )}
    </div>
  );
}

export default function CampaignEventsTab({ events, onEventsChange, onPickFromMap }) {
  const handleChange = (idx, updated) => {
    const arr = [...events];
    arr[idx] = updated;
    onEventsChange(arr);
  };

  const handleDelete = (idx) => onEventsChange(events.filter((_, i) => i !== idx));

  const handleAdd = () => {
    onEventsChange([...(events || []), {
      eventType: 'historic',
      name: 'new_event',
      date: '100',
      positions: [],
      movie: '',
    }]);
  };

  const handleExport = () => {
    const text = toCRLF(serializeCampaignEvents(events));
    downloadBlob(new Blob([text], { type: 'text/plain' }), 'descr_events.txt');
  };

  const handleExportStringsText = () => {
    const { map: existing, fname } = getHistoricEventStrings();
    const updated = { ...existing };
    for (const ev of (events || [])) {
      const nameUpper = (ev.name || '').toUpperCase();
      if (ev._title !== undefined) updated[`${nameUpper}_TITLE`] = ev._title;
      if (ev._body !== undefined) updated[`${nameUpper}_BODY`] = ev._body;
    }
    const filename = fname?.toLowerCase().endsWith('.txt') ? fname : 'historic_events.txt';
    downloadBlob(new Blob([serializeTextLocFile(updated)], { type: 'text/plain' }), filename);
  };

  const hasStringsEdits = (events || []).some(ev => ev._title !== undefined || ev._body !== undefined);

  const sorted = [...(events || [])].sort((a, b) => (parseInt(a.date) || 0) - (parseInt(b.date) || 0));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Campaign Events</p>
          <p className="text-[9px] text-slate-600 mt-0.5">descr_events.txt — turn-triggered events</p>
        </div>
        <div className="flex gap-1 flex-wrap justify-end">
          {hasStringsEdits && (
            <button onClick={handleExportStringsText}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] bg-cyan-600/20 hover:bg-cyan-600/40 border-cyan-500/30 text-cyan-400 transition-colors">
              <Download className="w-2.5 h-2.5" /> Text
            </button>
          )}
          <button onClick={handleExport} disabled={!events?.length}
            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${events?.length ? 'bg-amber-600/20 hover:bg-amber-600/40 border-amber-500/30 text-amber-400' : 'border-slate-700/30 text-slate-600 cursor-not-allowed opacity-40'}`}>
            <Download className="w-2.5 h-2.5" /> Export
          </button>
          <button onClick={handleAdd}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-slate-600/40 text-slate-300 hover:text-slate-100 text-[10px] bg-slate-700/40 transition-colors">
            <Plus className="w-2.5 h-2.5" /> Add
          </button>
        </div>
      </div>

      {(!events || events.length === 0) && (
        <div className="text-[10px] text-slate-600 text-center py-4 italic">
          No events loaded. Load descr_events.txt from the Campaign Files tab or add a new one.
        </div>
      )}

      <div className="space-y-1">
        {sorted.map((ev) => {
          const originalIdx = events.indexOf(ev);
          return (
            <EventRow
              key={originalIdx}
              event={ev}
              idx={originalIdx}
              onChange={handleChange}
              onDelete={handleDelete}
              onPickFromMap={onPickFromMap}
            />
          );
        })}
      </div>
    </div>
  );
}
