import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Download, Upload, Trash2, Check, Edit2 } from 'lucide-react';
import { getTextLocalizationStore } from '../../lib/textLocalizationStore';
import { parseTextLocFile, serializeTextLocFile } from '../../lib/textLocParser';
import { downloadBlob } from './tgaExporter';

/**
 * Reads / writes campaign_descriptions.txt
 * Keys follow the pattern: [CAMPAIGNNAME]_TITLE, [CAMPAIGNNAME]_[FACTION]_TITLE, [CAMPAIGNNAME]_[FACTION]_DESCR
 *
 * Auto-loads from the shared localization store when a matching file is present.
 */

function getCampaignDescStrings() {
  try {
    const raw = sessionStorage.getItem('m2tw_campaign_desc_strings');
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function setCampaignDescStrings(map) {
  try { sessionStorage.setItem('m2tw_campaign_desc_strings', JSON.stringify(map)); } catch {}
}

// Try to auto-load from the text localization store (loaded via Home/folder import)
function tryAutoLoadFromStore() {
  try {
    const store = getTextLocalizationStore();
    for (const [fname, binData] of Object.entries(store)) {
      if (fname.toLowerCase().includes('campaign_descriptions')) {
        const map = {};
        for (const { key, value } of (binData.entries || [])) {
          if (key) map[key] = value;
        }
        return {
          map,
          meta: {
            sourceFormat: 'txt',
            filename: fname,
          }
        };
      }
    }
  } catch {}
  return null;
}

export default function CampaignDescriptionsStrings({ stratData, onCampaignNameChange }) {
  const fileRef = useRef();

  const [stringsMap, setStringsMap] = useState(() => {
    // Prefer manually loaded data from session, then auto-load from store
    const session = getCampaignDescStrings();
    if (session && Object.keys(session).length > 0) return session;
    const auto = tryAutoLoadFromStore();
    if (auto) {
      setCampaignDescStrings(auto.map);
      return auto.map;
    }
    return {};
  });

  const [locMeta, setLocMeta] = useState(() => {
    const auto = tryAutoLoadFromStore();
    return auto?.meta ?? { sourceFormat: 'txt', filename: 'campaign_descriptions.txt' };
  });

  // Campaign name editing
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const rawCampaignName = stratData?.campaignName || 'imperial_campaign';
  const campaignName = rawCampaignName.toUpperCase();

  // Auto-load from store when it changes (e.g. after folder import)
  useEffect(() => {
    const auto = tryAutoLoadFromStore();
    if (auto && Object.keys(auto.map).length > 0) {
      // Only overwrite if session is empty (don't stomp manual edits)
      const session = getCampaignDescStrings();
      if (!session || Object.keys(session).length === 0) {
        setStringsMap(auto.map);
        setCampaignDescStrings(auto.map);
        setLocMeta(auto.meta);
      }
    }
  }, []);

  // Listen for text-localization-updated events (fired when folder is imported)
  useEffect(() => {
    const handler = () => {
      const auto = tryAutoLoadFromStore();
      if (auto && Object.keys(auto.map).length > 0) {
        setStringsMap(auto.map);
        setCampaignDescStrings(auto.map);
        setLocMeta(auto.meta);
      }
    };
    window.addEventListener('text-localization-updated', handler);
    return () => window.removeEventListener('text-localization-updated', handler);
  }, []);

  const allFactions = useMemo(() => {
    const from = (stratData?.factions || []).map(f => f.name).filter(Boolean);
    const fromLists = [
      ...(stratData?.playable || []),
      ...(stratData?.unlockable || []),
      ...(stratData?.nonplayable || []),
    ];
    return [...new Set([...from, ...fromLists])];
  }, [stratData]);

  const titleKey = `${campaignName}_TITLE`;
  const factionKeys = useMemo(() => {
    return allFactions.map(f => {
      const fu = f.toUpperCase();
      return { faction: f, titleKey: `${campaignName}_${fu}_TITLE`, descrKey: `${campaignName}_${fu}_DESCR` };
    });
  }, [allFactions, campaignName]);

  const autoKeySet = useMemo(() => {
    const s = new Set([titleKey]);
    for (const { titleKey: tk, descrKey: dk } of factionKeys) { s.add(tk); s.add(dk); }
    return s;
  }, [titleKey, factionKeys]);

  const extraKeys = useMemo(() => Object.keys(stringsMap).filter(k => !autoKeySet.has(k)), [stringsMap, autoKeySet]);

  const set = (key, value) => {
    const next = { ...stringsMap, [key]: value };
    setStringsMap(next);
    setCampaignDescStrings(next);
  };
  const del = (key) => {
    const next = { ...stringsMap };
    delete next[key];
    setStringsMap(next);
    setCampaignDescStrings(next);
  };

  const handleLoadLocalization = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const text = await file.text();
    const map = parseTextLocFile(text);
    setStringsMap(map);
    setCampaignDescStrings(map);
    setLocMeta({ sourceFormat: 'txt', filename: file.name });
    try { localStorage.setItem('m2tw_campaign_descriptions_raw', text); } catch {}
  };

  const handleExportLocalization = () => {
    const text = serializeTextLocFile(stringsMap);
    downloadBlob(new Blob([text], { type: 'text/plain' }), 'campaign_descriptions.txt');
  };

  const startEditName = () => {
    setNameDraft(rawCampaignName);
    setEditingName(true);
  };
  const commitName = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) { setEditingName(false); return; }

    // Duplicate existing keys with old prefix → new prefix (content preserved)
    if (trimmed !== rawCampaignName && Object.keys(stringsMap).length > 0) {
      const oldPrefix = rawCampaignName.toUpperCase();
      const newPrefix = trimmed.toUpperCase();
      const next = { ...stringsMap };
      for (const [key, value] of Object.entries(stringsMap)) {
        if (key.startsWith(oldPrefix + '_') || key === oldPrefix) {
          const newKey = key.startsWith(oldPrefix + '_')
            ? newPrefix + '_' + key.slice(oldPrefix.length + 1)
            : newPrefix;
          if (!next[newKey]) next[newKey] = value; // only create if not already present
        }
      }
      setStringsMap(next);
      setCampaignDescStrings(next);
    }

    if (onCampaignNameChange) onCampaignNameChange(trimmed);
    setEditingName(false);
  };

  const fieldClass = "w-full px-1.5 py-1 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono resize-none";

  return (
    <div className="space-y-2">
      {/* Campaign internal name */}
      <div className="rounded border border-amber-500/30 bg-amber-900/10 p-2 space-y-1">
        <p className="text-[9px] text-amber-400 uppercase font-semibold">Campaign Internal Name</p>
        <p className="text-[8px] text-slate-500 leading-tight">
          Used as the key prefix for all campaign description strings. Change it before creating new content.
        </p>
        {editingName ? (
          <div className="flex gap-1 items-center">
            <input
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && commitName()}
              className="flex-1 h-6 px-1.5 text-[11px] bg-slate-800 border border-amber-500/50 rounded text-amber-200 font-mono"
              autoFocus
            />
            <button onClick={commitName}
              className="h-6 px-2 rounded bg-green-700/60 border border-green-600/40 text-green-300 hover:bg-green-700/80 text-[10px] flex items-center gap-0.5">
              <Check className="w-3 h-3" /> Apply
            </button>
            <button onClick={() => setEditingName(false)}
              className="h-6 px-1.5 rounded bg-slate-700/60 border border-slate-600/40 text-slate-400 hover:text-slate-200 text-[10px]">
              ✕
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-mono text-amber-300 flex-1">{rawCampaignName}</span>
            <button onClick={startEditName}
              className="h-5 px-1.5 rounded bg-slate-700/60 border border-slate-600/40 text-slate-400 hover:text-slate-200 text-[9px] flex items-center gap-0.5">
              <Edit2 className="w-2.5 h-2.5" /> Edit
            </button>
          </div>
        )}
      </div>

      {/* Header */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <p className="text-[9px] text-slate-500 uppercase font-semibold flex-1">
          Campaign Descriptions ({locMeta?.filename || 'campaign_descriptions.txt'})
        </p>
        <label className="cursor-pointer flex items-center gap-0.5 h-5 px-1.5 rounded bg-slate-700/60 border border-slate-600/40 text-slate-300 hover:text-slate-100 text-[9px]">
          <Upload className="w-2.5 h-2.5" /> Load text
          <input ref={fileRef} type="file" accept=".txt,text/plain" className="hidden" onChange={handleLoadLocalization} />
        </label>
        <button onClick={handleExportLocalization} disabled={Object.keys(stringsMap).length === 0}
          className={`flex items-center gap-0.5 h-5 px-1.5 rounded border text-[9px] transition-colors ${Object.keys(stringsMap).length > 0 ? 'bg-amber-600/20 hover:bg-amber-600/40 border-amber-500/30 text-amber-400' : 'border-slate-700/30 text-slate-600 opacity-40 cursor-not-allowed'}`}>
          <Download className="w-2.5 h-2.5" /> Export .txt
        </button>
      </div>

      {Object.keys(stringsMap).length === 0 && (
        <p className="text-[9px] text-slate-600 italic text-center py-1">
          Auto-loaded when campaign folder is imported, or load manually above.
        </p>
      )}

      {/* Campaign title */}
      <div className="space-y-0.5">
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-amber-400 font-mono">{titleKey}</span>
          <span className="text-[8px] text-slate-600">(campaign screen title)</span>
        </div>
        <input
          value={stringsMap[titleKey] || ''}
          onChange={e => set(titleKey, e.target.value)}
          placeholder="Campaign title…"
          className={fieldClass}
        />
      </div>

      {/* Per-faction entries */}
      {factionKeys.length > 0 && (
        <div className="space-y-2 pt-1 border-t border-slate-700/40">
          <p className="text-[9px] text-slate-500 uppercase font-semibold">Faction Entries ({allFactions.length})</p>
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {factionKeys.map(({ faction, titleKey: tk, descrKey: dk }) => (
              <div key={faction} className="rounded border border-slate-700/30 bg-slate-900/30 p-1.5 space-y-1">
                <span className="text-[10px] font-mono text-slate-300">{faction}</span>
                <div>
                  <span className="text-[8px] text-cyan-600 font-mono">{tk}</span>
                  <input
                    value={stringsMap[tk] || ''}
                    onChange={e => set(tk, e.target.value)}
                    placeholder="Faction title…"
                    className={fieldClass + ' h-6'}
                  />
                </div>
                <div>
                  <span className="text-[8px] text-cyan-600 font-mono">{dk}</span>
                  <textarea
                    value={stringsMap[dk] || ''}
                    onChange={e => set(dk, e.target.value)}
                    placeholder="Faction description…"
                    rows={2}
                    className={fieldClass}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Extra keys */}
      {extraKeys.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-slate-700/40">
          <p className="text-[9px] text-slate-500 uppercase font-semibold">Other Keys ({extraKeys.length})</p>
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {extraKeys.map(k => (
              <div key={k} className="flex items-center gap-1">
                <span className="text-[8px] font-mono text-slate-500 flex-1 truncate" title={k}>{k}</span>
                <input
                  value={stringsMap[k] || ''}
                  onChange={e => set(k, e.target.value)}
                  className="flex-1 h-5 px-1 text-[9px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono"
                />
                <button onClick={() => del(k)} className="text-slate-600 hover:text-red-400 shrink-0">
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
