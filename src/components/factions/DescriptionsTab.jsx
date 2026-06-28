import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Upload, Download, Copy, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseTextLocFile, serializeTextLocEntries, textLocMapToEntries } from '@/lib/textLocParser';
import { textBlob } from '@/lib/lineEndings';
import { ensureRtwFactionLocEntries, extractFactionIdsFromLocEntries } from '@/lib/factionLoc';
import { getTextLocalizationStore, hydrateTextLocalizationStore, updateTextLocalizationFile } from '@/lib/textLocalizationStore';

const GLOBAL_STRINGS_KEY = 'rtw_expanded_text_global';
const EXPANDED_BI_FILE = 'expanded_bi.txt';

function normalizeLocKey(key) {
  return String(key || '').trim().replace(/^\{/, '').replace(/\}$/, '');
}

function titleCaseFactionName(name) {
  const clean = String(name || '').replace(/_\d+$/i, '').replace(/_/g, ' ').trim();
  return clean
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function defaultAdjective(displayName) {
  if (!displayName) return '';
  if (/a$/i.test(displayName)) return `${displayName}n`;
  return displayName;
}

export default function DescriptionsTab({ factionName }) {
  const [localizationEntries, setLocalizationEntries] = useState([]);
  const [allEntries, setAllEntries] = useState([]);
  const [rawText, setRawText] = useState('');
  const localizationRef = useRef();

  const persistExpandedEntries = useCallback((entries, nextRawText = rawText) => {
    const normalizedEntries = (entries || []).map((entry) => ({
      key: normalizeLocKey(entry.key),
      value: entry.value ?? '',
    })).filter(entry => entry.key);
    updateTextLocalizationFile(EXPANDED_BI_FILE, {
      entries: normalizedEntries,
      rawText: nextRawText,
      sourceFormat: 'txt',
    });
    try { localStorage.setItem(GLOBAL_STRINGS_KEY, JSON.stringify({ entries: normalizedEntries, rawText: nextRawText })); } catch {}
  }, [rawText]);

  const loadLocalizationText = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const entries = textLocMapToEntries(parseTextLocFile(text))
      .map((entry) => ({ key: normalizeLocKey(entry.key), value: entry.value }));
    if (entries.length) {
      setAllEntries(entries);
      setRawText(text);
      persistExpandedEntries(entries, text);
    }
    e.target.value = '';
  }, [persistExpandedEntries]);

  const exportLocalizationText = () => {
    if (allEntries.length === 0) return;
    const blob = textBlob(serializeTextLocEntries(allEntries, { rawText }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'expanded_bi.txt';
    a.click();
  };

  const updateStringValue = (key, newValue) => {
    // Update the filtered entry
    setLocalizationEntries((prev) =>
    prev.map((entry) => entry.key === key ? { ...entry, value: newValue } : entry)
    );
    // Also update the full stored data
    const updatedEntries = allEntries.map((entry) =>
    entry.key === key ? { ...entry, value: newValue } : entry
    );
    setAllEntries(updatedEntries);
    persistExpandedEntries(updatedEntries);
  };

  useEffect(() => {
    // Load global text localization data
    const loadStrings = () => {
      try {
        const store = getTextLocalizationStore();
        const expanded = store[EXPANDED_BI_FILE] || store['expanded.txt'];
        if (expanded?.entries?.length) {
          const entries = expanded.entries.map((entry) => ({
            key: normalizeLocKey(entry.key),
            value: entry.value ?? '',
          }));
          setAllEntries(entries);
          setRawText(expanded.rawText || '');
          const factionUpper = factionName.toUpperCase();
          setLocalizationEntries(entries.filter((entry) =>
            entry.key && entry.key.toUpperCase().includes(factionUpper)
          ));
          return;
        }
        const stored = localStorage.getItem(GLOBAL_STRINGS_KEY);
        if (stored) {
          const { entries, rawText: storedRawText = '' } = JSON.parse(stored);
          setAllEntries(entries);
          setRawText(storedRawText);
          // Filter entries for current faction
          const factionUpper = factionName.toUpperCase();
          const filtered = entries.filter((entry) =>
          entry.key && entry.key.toUpperCase().includes(factionUpper)
          );
          setLocalizationEntries(filtered);
        }
      } catch {}
    };

    loadStrings();
    hydrateTextLocalizationStore().then(loadStrings);

    // Listen for updates from other editors
    window.addEventListener('text-localization-updated', loadStrings);
    return () => window.removeEventListener('text-localization-updated', loadStrings);
  }, [factionName]);

  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copySource, setCopySource] = useState('');
  const [copyStrings, setCopyStrings] = useState({
    sourceAdjective: '', adjective: '', displayName: '',
    leaderTitle: '', heirTitle: '', strengths: '', weaknesses: '', customUnit: ''
  });

  // Distinct faction names present in the loaded strings, excluding current
  const sourceFactions = useMemo(() => {
    const names = new Set(extractFactionIdsFromLocEntries(allEntries));
    names.delete(factionName.toLowerCase());
    return [...names].sort();
  }, [allEntries, factionName]);

  const openCopyModal = () => {
    setCopySource('');
    setCopyStrings({ sourceAdjective: '', adjective: '', displayName: '', leaderTitle: '', heirTitle: '', strengths: '', weaknesses: '', customUnit: '' });
    setShowCopyModal(true);
  };

  const generateRtwEntries = () => {
    const displayName = titleCaseFactionName(factionName);
    const adjective = defaultAdjective(displayName);
    const updated = ensureRtwFactionLocEntries(allEntries, factionName, { displayName, adjective });
    const factionUpper = factionName.toUpperCase();
    setAllEntries(updated);
    setLocalizationEntries(updated.filter(entry => entry.key?.toUpperCase().includes(factionUpper)));
    persistExpandedEntries(updated);
  };

  const confirmCopyFromFaction = () => {
    if (!copySource) return;
    const srcUpper = copySource.toUpperCase();
    const dstUpper = factionName.toUpperCase();
    const { sourceAdjective, adjective, displayName, leaderTitle, heirTitle, strengths, weaknesses, customUnit } = copyStrings;
    const srcAdj = sourceAdjective.trim();
    const newAdj = adjective.trim();

    const srcEntries = allEntries.filter(e => e.key?.toUpperCase().includes(srcUpper));
    const copiedEntries = srcEntries.map(e => {
      const newKey = e.key.replace(new RegExp(srcUpper, 'g'), dstUpper);
      let newValue = e.value;

      if (srcAdj && newAdj) newValue = newValue.replace(new RegExp(srcAdj, 'g'), newAdj);
      if (displayName) {
        newValue = newValue
          .replace(new RegExp(copySource, 'gi'), displayName)
          .replace(new RegExp(copySource.toLowerCase(), 'gi'), displayName.toLowerCase());
      }

      if (newKey === dstUpper && displayName.trim()) newValue = displayName.trim();
      else if (newKey === `EMT_${dstUpper}_FACTION_LEADER` && leaderTitle.trim()) newValue = leaderTitle.trim();
      else if (newKey === `EMT_${dstUpper}_FACTION_HEIR` && heirTitle.trim()) newValue = heirTitle.trim();
      else if (newKey === `EMT_${dstUpper}_FACTION_LEADER_TITLE` && leaderTitle.trim()) newValue = leaderTitle.trim();
      else if (newKey === `EMT_${dstUpper}_FACTION_HEIR_TITLE` && heirTitle.trim()) newValue = heirTitle.trim();
      else if (newKey === `EMT_${dstUpper}_FACTION_LEADER_NAME` && leaderTitle.trim()) newValue = `${leaderTitle.trim()} %S`;
      else if (newKey === `EMT_${dstUpper}_FACTION_HEIR_NAME` && heirTitle.trim()) newValue = `${heirTitle.trim()} %S`;
      else if (newKey === `${dstUpper}_STRENGTH` && strengths.trim()) newValue = strengths.trim();
      else if (newKey === `${dstUpper}_WEAKNESS` && weaknesses.trim()) newValue = weaknesses.trim();
      else if (newKey === `${dstUpper}_UNIT` && customUnit.trim()) newValue = customUnit.trim();

      return { key: newKey, value: newValue };
    });
    const newEntries = ensureRtwFactionLocEntries(copiedEntries, factionName, {
      displayName,
      adjective: newAdj,
      leaderTitle,
      heirTitle,
    });

    const filtered = allEntries.filter(e => !e.key?.toUpperCase().includes(dstUpper));
    const updated = [...filtered, ...newEntries];
    setAllEntries(updated);
    setLocalizationEntries(newEntries);
    persistExpandedEntries(updated);
    setShowCopyModal(false);
  };

  return (
    <div className="space-y-4">
      <div className="border-b border-slate-600 pb-2">
        <p className="text-sm font-semibold text-slate-200">expanded_bi.txt Editor</p>
        <p className="text-xs text-slate-400">Edit RTW BI text localization entries for {factionName}</p>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-[10px] text-slate-300">expanded_bi.txt file</label>
        <div className="flex gap-2">
          <input ref={localizationRef} type="file" accept=".txt,text/plain" className="hidden" onChange={loadLocalizationText} />
          <Button variant="outline" size="sm" className="text-[10px]" onClick={() => localizationRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" /> Load
          </Button>
          {allEntries.length > 0 &&
          <Button variant="outline" size="sm" className="text-[10px]" onClick={exportLocalizationText}>
              <Download className="w-3 h-3 mr-1" /> Export
            </Button>
          }
          <Button variant="outline" size="sm" className="text-[10px]" onClick={generateRtwEntries}>
            <Copy className="w-3 h-3 mr-1" /> Generate RTW entries
          </Button>
        </div>
      </div>

      {/* Copy-from-faction modal */}
      {showCopyModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-600 rounded-lg p-4 w-96 max-h-[85vh] overflow-y-auto space-y-3 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">Copy Entries From Faction</h3>
              <button onClick={() => setShowCopyModal(false)} className="text-slate-500 hover:text-slate-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Copy all string entries from another faction and remap the keys to <span className="font-mono text-amber-400">{factionName}</span>.
            </p>

            <div className="space-y-1.5">
              <label className="text-[10px] text-slate-500 uppercase font-semibold">Source Faction</label>
              {sourceFactions.length > 0 ? (
                <select value={copySource} onChange={e => setCopySource(e.target.value)}
                  className="w-full h-7 px-2 text-[11px] bg-slate-900 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-blue-500">
                  <option value="">— select faction —</option>
                  {sourceFactions.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              ) : (
                <p className="text-[10px] text-slate-500 italic">No other factions found in text localization.</p>
              )}
            </div>

            <div className="border-t border-slate-700 pt-3 space-y-3">
              <p className="text-[10px] text-slate-500 uppercase font-semibold">String Replacements</p>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] text-slate-400 block mb-1">Source Adjective</label>
                  <input value={copyStrings.sourceAdjective}
                    onChange={e => setCopyStrings(s => ({ ...s, sourceAdjective: e.target.value }))}
                    placeholder="e.g. Milanese"
                    className="w-full h-7 px-2 text-[10px] bg-slate-900 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-blue-500" />
                  <p className="text-[9px] text-slate-500 mt-0.5">Adjective to replace from source</p>
                </div>
                <div>
                  <label className="text-[9px] text-slate-400 block mb-1">New Adjective</label>
                  <input value={copyStrings.adjective}
                    onChange={e => setCopyStrings(s => ({ ...s, adjective: e.target.value }))}
                    placeholder="e.g. Mantuan"
                    className="w-full h-7 px-2 text-[10px] bg-slate-900 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-blue-500" />
                  <p className="text-[9px] text-slate-500 mt-0.5">New adjective to use</p>
                </div>
              </div>

              <div>
                <label className="text-[9px] text-slate-400 block mb-1">Faction Display Name</label>
                <input value={copyStrings.displayName}
                  onChange={e => setCopyStrings(s => ({ ...s, displayName: e.target.value }))}
                  placeholder="e.g. Marquisate of Mantua"
                  className="w-full h-7 px-2 text-[10px] bg-slate-900 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-blue-500" />
                <p className="text-[9px] text-slate-500 mt-0.5">Used for key {'{' + factionName.toUpperCase() + '}'}</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] text-slate-400 block mb-1">Leader Title (optional)</label>
                  <input value={copyStrings.leaderTitle}
                    onChange={e => setCopyStrings(s => ({ ...s, leaderTitle: e.target.value }))}
                    placeholder="e.g. Great Khan"
                    className="w-full h-7 px-2 text-[10px] bg-slate-900 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-[9px] text-slate-400 block mb-1">Heir Title (optional)</label>
                  <input value={copyStrings.heirTitle}
                    onChange={e => setCopyStrings(s => ({ ...s, heirTitle: e.target.value }))}
                    placeholder="e.g. Khan"
                    className="w-full h-7 px-2 text-[10px] bg-slate-900 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-blue-500" />
                </div>
              </div>

              <div>
                <label className="text-[9px] text-slate-400 block mb-1">{'{' + factionName.toUpperCase() + '_STRENGTH}'} (optional)</label>
                <textarea value={copyStrings.strengths}
                  onChange={e => setCopyStrings(s => ({ ...s, strengths: e.target.value }))}
                  placeholder="e.g. Expert horse archers, fast movement"
                  className="w-full h-14 px-2 py-1.5 text-[10px] bg-slate-900 border border-slate-600 rounded text-slate-200 resize-none focus:outline-none focus:border-blue-500" />
              </div>

              <div>
                <label className="text-[9px] text-slate-400 block mb-1">{'{' + factionName.toUpperCase() + '_WEAKNESS}'} (optional)</label>
                <textarea value={copyStrings.weaknesses}
                  onChange={e => setCopyStrings(s => ({ ...s, weaknesses: e.target.value }))}
                  placeholder="e.g. Weak in siege defense"
                  className="w-full h-14 px-2 py-1.5 text-[10px] bg-slate-900 border border-slate-600 rounded text-slate-200 resize-none focus:outline-none focus:border-blue-500" />
              </div>

              <div>
                <label className="text-[9px] text-slate-400 block mb-1">{'{' + factionName.toUpperCase() + '_UNIT}'} (optional)</label>
                <input value={copyStrings.customUnit}
                  onChange={e => setCopyStrings(s => ({ ...s, customUnit: e.target.value }))}
                  placeholder="e.g. Keshik Guard"
                  className="w-full h-7 px-2 text-[10px] bg-slate-900 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-blue-500" />
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setShowCopyModal(false)}
                className="px-3 py-1 rounded text-[11px] border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 transition-colors">
                Cancel
              </button>
              <button onClick={confirmCopyFromFaction} disabled={!copySource}
                className="px-3 py-1 rounded text-[11px] bg-blue-600/30 border border-blue-500/50 text-blue-300 hover:bg-blue-600/50 disabled:opacity-40 transition-colors">
                Copy
              </button>
            </div>
          </div>
        </div>
      )}

      {localizationEntries.length > 0 ?
      <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
          {localizationEntries.map((entry, idx) =>
        <div key={idx} className="bg-slate-800 border border-slate-600 rounded p-3">
              <div className="text-[9px] font-mono text-slate-500 mb-2 select-all">
                {'{'}{entry.key}{'}'}
              </div>
              <textarea
            className="w-full bg-slate-700 border border-slate-600 rounded p-2 text-[10px] text-slate-100 resize-none"
            rows={2}
            value={entry.value}
            onChange={(e) => updateStringValue(entry.key, e.target.value)} />
            </div>
        )}
        </div> :

      <div className="flex flex-col items-center gap-3 py-8 text-slate-500 border border-dashed border-slate-700 rounded">
          <p className="text-xs">No entries for <span className="font-mono text-amber-400">{factionName}</span> in the loaded text file.</p>
          {allEntries.length > 0 && (
            <Button variant="outline" size="sm" className="text-[10px] text-blue-300 border-blue-600 hover:bg-blue-900/30"
              onClick={openCopyModal}>
              <Copy className="w-3 h-3 mr-1" /> Copy from another faction…
            </Button>
          )}
          {allEntries.length === 0 && (
            <Button variant="outline" size="sm" className="text-[10px] text-blue-300 border-blue-600 hover:bg-blue-900/30"
              onClick={generateRtwEntries}>
              <Copy className="w-3 h-3 mr-1" /> Generate RTW entries
            </Button>
          )}
        </div>
      }
    </div>);

}
