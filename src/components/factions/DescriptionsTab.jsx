import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseStringsBin, encodeStringsBin } from '@/components/strings/stringsBinCodec';

const GLOBAL_STRINGS_KEY = 'm2tw_strings_bin_global';

export default function DescriptionsTab({ factionName }) {
  const [stringsBinEntries, setStringsBinEntries] = useState([]);
  const [allEntries, setAllEntries] = useState([]);
  const [magicValues, setMagicValues] = useState({ magic1: 2, magic2: 2048 });
  const stringsBinRef = useRef();

  const loadStringsBin = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const arrayBuffer = await file.arrayBuffer();
    const parsed = parseStringsBin(arrayBuffer);
    if (parsed && parsed.entries) {
      // Store all entries globally
      setAllEntries(parsed.entries);
      setMagicValues({ magic1: parsed.magic1, magic2: parsed.magic2 });
      localStorage.setItem(GLOBAL_STRINGS_KEY, JSON.stringify({
        entries: parsed.entries,
        magic1: parsed.magic1,
        magic2: parsed.magic2
      }));
    }
    e.target.value = '';
  }, []);

  const exportStringsBin = () => {
    if (allEntries.length === 0) return;
    const buffer = encodeStringsBin(allEntries, magicValues.magic1, magicValues.magic2);
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'strings.bin';
    a.click();
  };

  const updateStringValue = (key, newValue) => {
    // Update the filtered entry
    setStringsBinEntries(prev => 
      prev.map(entry => entry.key === key ? { ...entry, value: newValue } : entry)
    );
    // Also update the full stored data
    const updatedEntries = allEntries.map(entry => 
      entry.key === key ? { ...entry, value: newValue } : entry
    );
    setAllEntries(updatedEntries);
    localStorage.setItem(GLOBAL_STRINGS_KEY, JSON.stringify({
      entries: updatedEntries,
      magic1: magicValues.magic1,
      magic2: magicValues.magic2
    }));
  };

  useEffect(() => {
    // Load global strings.bin data
    try {
      const stored = localStorage.getItem(GLOBAL_STRINGS_KEY);
      if (stored) {
        const { entries, magic1, magic2 } = JSON.parse(stored);
        setAllEntries(entries);
        setMagicValues({ magic1, magic2 });
        // Filter entries for current faction
        const factionUpper = factionName.toUpperCase();
        const filtered = entries.filter(entry => 
          entry.key && entry.key.toUpperCase().includes(factionUpper)
        );
        setStringsBinEntries(filtered);
      }
    } catch {}
  }, [factionName]);

  return (
    <div className="space-y-4">
      <div className="border-b border-slate-600 pb-2">
        <p className="text-sm font-semibold text-slate-200">Strings.bin Editor</p>
        <p className="text-xs text-slate-400">Edit strings.bin entries for {factionName}</p>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-[10px] text-slate-300">strings.bin file</label>
        <div className="flex gap-2">
          <input ref={stringsBinRef} type="file" accept=".bin" className="hidden" onChange={loadStringsBin} />
          <Button variant="outline" size="sm" className="text-[10px]" onClick={() => stringsBinRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" /> Load
          </Button>
          {allEntries.length > 0 && (
            <Button variant="outline" size="sm" className="text-[10px]" onClick={exportStringsBin}>
              <Download className="w-3 h-3 mr-1" /> Export
            </Button>
          )}
        </div>
      </div>

      {stringsBinEntries.length > 0 ? (
        <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
          {stringsBinEntries.map((entry, idx) => (
            <div key={idx} className="bg-slate-800 border border-slate-600 rounded p-3">
              <div className="text-[9px] font-mono text-slate-500 mb-2 select-all">
                {'{'}{entry.key}{'}'}
              </div>
              <textarea
                className="w-full bg-slate-700 border border-slate-600 rounded p-2 text-[10px] text-slate-100 resize-none"
                rows={2}
                value={entry.value}
                onChange={(e) => updateStringValue(entry.key, e.target.value)}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-6 text-slate-500 border border-dashed border-slate-700 rounded">
          <p className="text-xs">No strings.bin loaded - upload to see entries for {factionName}</p>
        </div>
      )}
    </div>
  );
}