import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Download, FileText, Trash2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function StringsTab({ factionName, onStringsUpdate }) {
  const [stringsData, setStringsData] = useState('');
  const fileRef = useRef();

  const loadStrings = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setStringsData(text);
    localStorage.setItem(`m2tw_strings_${factionName}`, text);
    e.target.value = '';
  }, [factionName]);

  const exportStrings = () => {
    if (!stringsData) return;
    const blob = new Blob([stringsData], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'expanded.txt';
    a.click();
  };

  useEffect(() => {
    try {
      const data = localStorage.getItem(`m2tw_strings_${factionName}`);
      if (data) {
        setStringsData(data);
      } else {
        setStringsData('');
      }
    } catch {}
  }, [factionName]);

  // Listen for strings update event from duplication
  useEffect(() => {
    const handleStringsUpdate = (e) => {
      if (e.detail?.factionName === factionName && e.detail?.entries) {
        // Build strings from entries
        let newData = stringsData || '';
        const factionNameUpper = factionName.toUpperCase();
        
        // Remove existing entries for this faction
        const lines = newData.split('\n').filter(line => {
          const match = line.match(/^\{([^}]+)\}/);
          if (!match) return true;
          const key = match[1];
          return !key.includes(factionNameUpper);
        });
        
        // Add new entries
        e.detail.entries.forEach(({ key, value }) => {
          if (value && value.trim()) {
            lines.push(`{${key}}${value}`);
          }
        });
        
        newData = lines.join('\n') + '\n';
        setStringsData(newData);
        localStorage.setItem(`m2tw_strings_${factionName}`, newData);
      }
    };
    window.addEventListener('strings-update-request', handleStringsUpdate);
    return () => window.removeEventListener('strings-update-request', handleStringsUpdate);
  }, [factionName, stringsData]);

  const addEntry = (key, value) => {
    if (!value.trim()) return stringsData;
    const newEntry = `{${key}}${value}\n`;
    return stringsData + newEntry;
  };

  const removeEntriesForFaction = (data, factionNameUpper) => {
    const lines = data.split('\n');
    return lines.filter(line => {
      if (!line.trim()) return false;
      const match = line.match(/^\{([^}]+)\}/);
      if (!match) return true;
      const key = match[1];
      return !key.includes(factionNameUpper);
    }).join('\n');
  };

  const handleUpdateStrings = (entries) => {
    const factionNameUpper = factionName.toUpperCase();
    let newData = stringsData ? removeEntriesForFaction(stringsData, factionNameUpper) : '';
    
    entries.forEach(({ key, value }) => {
      if (value && value.trim()) {
        newData += `{${key}}${value}\n`;
      }
    });
    
    setStringsData(newData);
    localStorage.setItem(`m2tw_strings_${factionName}`, newData);
    
    window.dispatchEvent(new CustomEvent('strings-updated', { 
      detail: { factionName, data: newData } 
    }));
  };

  const filteredEntries = stringsData ? 
    stringsData.split('\n').filter(line => {
      const match = line.match(/^\{([^}]+)\}/);
      return match && match[1].includes(factionName.toUpperCase());
    }) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-slate-600 pb-2">
        <div>
          <p className="text-sm font-semibold text-slate-200">Text Localization Entries</p>
          <p className="text-xs text-slate-400">Manage expanded.txt entries for {factionName}</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".txt,text/plain" className="hidden" onChange={loadStrings} />
          <Button variant="outline" size="sm" className="text-[10px]" onClick={() => fileRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" /> Load
          </Button>
          {stringsData && (
            <Button variant="outline" size="sm" className="text-[10px]" onClick={exportStrings}>
              <Download className="w-3 h-3 mr-1" /> Export
            </Button>
          )}
        </div>
      </div>

      {stringsData ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-slate-300">
              Faction-specific entries ({filteredEntries.length})
            </label>
            <Button 
              variant="outline" 
              size="sm" 
              className="text-[10px]"
              onClick={() => onStringsUpdate?.()}
            >
              <Copy className="w-3 h-3 mr-1" /> Generate Entries
            </Button>
          </div>
          <textarea
            className="w-full h-64 bg-slate-800 border border-slate-600 rounded p-3 text-[10px] font-mono text-slate-200"
            value={stringsData}
            onChange={(e) => {
              setStringsData(e.target.value);
              localStorage.setItem(`m2tw_strings_${factionName}`, e.target.value);
            }}
          />
        </div>
      ) : (
        <div className="text-center py-12 text-slate-500 border-2 border-dashed border-slate-700 rounded-lg">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No strings file loaded</p>
          <p className="text-xs mt-1">Load expanded.txt or generate entries during duplication</p>
        </div>
      )}
    </div>
  );
}
