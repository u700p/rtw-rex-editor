import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Download, Settings, CheckCircle, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

const LS_KEY = 'm2tw_offmap_models';

export const NAVY_ENTRY_TEMPLATE = (name) =>
  `\n\tfaction ${name}\n\t{\n\t\tlarge \tdata/models_off_map/bireme_OFF_MAP.CAS\t100 0\n\t\tmedium\tdata/models_off_map/bireme_OFF_MAP.CAS\t100 0\n\t\tsmall\tdata/models_off_map/bireme_OFF_MAP.CAS\t100 0\n\t}`;

export function hasFactionNavyEntry(text, name) {
  const m = text.match(/navy\s*\{([\s\S]*?)\n\}/);
  if (!m) return false;
  return new RegExp(`\\bfaction\\s+${name}\\b`).test(m[1]);
}

export function insertFactionNavyEntry(text, name) {
  return text.replace(/(navy\s*\{[\s\S]*?)(\n\})/, `$1${NAVY_ENTRY_TEMPLATE(name)}$2`);
}

export default function MiscTab({ factionName }) {
  const [fileData, setFileData] = useState('');
  const fileRef = useRef();

  useEffect(() => {
    try {
      const data = localStorage.getItem(LS_KEY);
      if (data) setFileData(data);
    } catch {}

    // Listen for external updates (e.g. auto-insert from addFaction)
    const onUpdate = () => {
      try {
        const data = localStorage.getItem(LS_KEY);
        if (data) setFileData(data);
      } catch {}
    };
    window.addEventListener('offmap-models-updated', onUpdate);
    return () => window.removeEventListener('offmap-models-updated', onUpdate);
  }, []);

  const loadFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setFileData(text);
    localStorage.setItem(LS_KEY, text);
    e.target.value = '';
  }, []);

  const exportFile = () => {
    if (!fileData) return;
    const blob = new Blob([fileData], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'descr_offmap_models.txt';
    a.click();
  };

  const addNavyEntry = () => {
    const updated = insertFactionNavyEntry(fileData, factionName);
    setFileData(updated);
    localStorage.setItem(LS_KEY, updated);
  };

  const present = fileData ? hasFactionNavyEntry(fileData, factionName) : false;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-slate-600 pb-2">
        <div>
          <p className="text-sm font-semibold text-slate-200">Miscellaneous Files</p>
          <p className="text-xs text-slate-400">descr_offmap_models.txt — navy entry for {factionName}</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".txt" className="hidden" onChange={loadFile} />
          <Button variant="outline" size="sm" className="text-[10px]" onClick={() => fileRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" /> Load
          </Button>
          {fileData && (
            <Button variant="outline" size="sm" className="text-[10px]" onClick={exportFile}>
              <Download className="w-3 h-3 mr-1" /> Export
            </Button>
          )}
        </div>
      </div>

      {fileData ? (
        <>
          <div className="flex items-center gap-3 p-2 rounded border bg-slate-800/50 border-slate-700">
            {present ? (
              <div className="flex items-center gap-2 text-green-400 text-xs">
                <CheckCircle className="w-4 h-4" />
                <span>Navy entry present for <span className="font-mono text-amber-400">{factionName}</span></span>
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-1">
                <span className="text-xs text-slate-400">No navy entry for <span className="font-mono text-amber-400">{factionName}</span></span>
                <Button
                  variant="outline" size="sm"
                  className="text-[10px] h-7 text-blue-300 border-blue-600 hover:bg-blue-900/30 ml-auto"
                  onClick={addNavyEntry}>
                  <PlusCircle className="w-3 h-3 mr-1" /> Add Entry
                </Button>
              </div>
            )}
          </div>
          <textarea
            className="w-full h-80 bg-slate-800 border border-slate-600 rounded p-3 text-[10px] font-mono text-slate-200"
            value={fileData}
            onChange={(e) => {
              setFileData(e.target.value);
              localStorage.setItem(LS_KEY, e.target.value);
            }}
          />
        </>
      ) : (
        <div className="text-center py-12 text-slate-500 border-2 border-dashed border-slate-700 rounded-lg">
          <Settings className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No file loaded</p>
          <p className="text-xs mt-1">Click "Load" to import descr_offmap_models.txt</p>
        </div>
      )}
    </div>
  );
}