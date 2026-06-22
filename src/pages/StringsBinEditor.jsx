import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { getStringsBinStore, updateStringsBinFile } from '@/lib/stringsBinStore';
import { parseTextLocFile, serializeTextLocFile, textLocMapToEntries } from '@/lib/textLocParser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Upload, Download, Plus, Trash2, Search, X, FileText, ChevronUp, ChevronDown, Save } from 'lucide-react';

function loadFilesFromStore() {
  const store = getStringsBinStore();
  return Object.entries(store).map(([name, data]) => ({
    name,
    entries: data.entries,
    magic1: data.magic1,
    magic2: data.magic2,
    sourceFormat: 'txt',
    dirty: false,
  }));
}

export default function StringsBinEditor() {
  const [files, setFiles] = useState(() => loadFilesFromStore());
  const [activeFile, setActiveFile] = useState(() => {
    const f = loadFilesFromStore();
    return f.length > 0 ? 0 : null;
  });
  const [selected, setSelected] = useState(null);
  const [editKey, setEditKey] = useState('');
  const [editValue, setEditValue] = useState('');
  const [search, setSearch] = useState('');
  const [isNew, setIsNew] = useState(false);
  const fileInputRef = useRef();

  // Re-sync when another editor or Home updates the store
  useEffect(() => {
    const handler = () => {
      const fresh = loadFilesFromStore();
      setFiles((prev) => {
        // Merge: keep local dirty edits, add new files from store, update clean files
        const prevByName = Object.fromEntries(prev.map((f) => [f.name, f]));
        const merged = fresh.map((f) => {
          const existing = prevByName[f.name];
          if (existing?.dirty) return existing; // keep local unsaved changes
          return f;
        });
        // Also keep any local-only files not yet in store (shouldn't happen but safety)
        for (const p of prev) {
          if (!merged.find((m) => m.name === p.name)) merged.push(p);
        }
        return merged;
      });
    };
    window.addEventListener('strings-bin-updated', handler);
    return () => window.removeEventListener('strings-bin-updated', handler);
  }, []);

  const currentFile = activeFile !== null ? files[activeFile] : null;

  const filteredEntries = useMemo(() => {
    if (!currentFile) return [];
    const q = search.toLowerCase();
    if (!q) return currentFile.entries.map((e, i) => ({ ...e, originalIndex: i }));
    return currentFile.entries
      .map((e, i) => ({ ...e, originalIndex: i }))
      .filter((e) => e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q));
  }, [currentFile, search]);

  const updateFiles = useCallback((updater) => {
    setFiles((prev) => {
      const next = [...prev];
      next[activeFile] = updater(next[activeFile]);
      return next;
    });
  }, [activeFile]);

  // Load from file picker (in addition to shared store)
  const handleLoad = async (e) => {
    const fileList = Array.from(e.target.files || []);
    e.target.value = '';
    for (const f of fileList) {
      if (f.name.toLowerCase().endsWith('.txt')) {
        const text = await f.text();
        const entries = textLocMapToEntries(parseTextLocFile(text));
        if (entries.length) {
          updateStringsBinFile(f.name, { entries, sourceFormat: 'txt' });
        }
      }
    }
    // Select the last loaded file
    if (fileList.length > 0) {
      setTimeout(() => {
        setFiles((prev) => {
          const idx = prev.findIndex((f) => f.name === fileList[fileList.length - 1].name);
          if (idx >= 0) setActiveFile(idx);
          return prev;
        });
        setSelected(null); setEditKey(''); setEditValue('');
      }, 50);
    }
  };

  const handleSelectEntry = (entry) => {
    setSelected(entry.originalIndex);
    setEditKey(entry.key);
    setEditValue(entry.value);
    setIsNew(false);
  };

  const handleSaveEntry = () => {
    if (!currentFile) return;
    let newEntries;
    if (isNew) {
      newEntries = [...currentFile.entries, { key: editKey, value: editValue }];
      setIsNew(false);
    } else if (selected !== null) {
      newEntries = [...currentFile.entries];
      newEntries[selected] = { key: editKey, value: editValue };
    } else return;

    updateFiles((f) => ({ ...f, entries: newEntries, dirty: true }));
    // Immediately persist to shared store so other editors see the change
    updateStringsBinFile(currentFile.name, {
      entries: newEntries,
      magic1: currentFile.magic1,
      magic2: currentFile.magic2,
      sourceFormat: currentFile.sourceFormat,
    });
  };

  const handleDelete = (idx) => {
    const newEntries = currentFile.entries.filter((_, i) => i !== idx);
    updateFiles((f) => ({ ...f, entries: newEntries, dirty: true }));
    updateStringsBinFile(currentFile.name, {
      entries: newEntries,
      magic1: currentFile.magic1,
      magic2: currentFile.magic2,
      sourceFormat: currentFile.sourceFormat,
    });
    if (selected === idx) { setSelected(null); setEditKey(''); setEditValue(''); }
    else if (selected > idx) setSelected(selected - 1);
  };

  const handleMove = (idx, dir) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= currentFile.entries.length) return;
    const newEntries = [...currentFile.entries];
    [newEntries[idx], newEntries[newIdx]] = [newEntries[newIdx], newEntries[idx]];
    updateFiles((f) => ({ ...f, entries: newEntries, dirty: true }));
    updateStringsBinFile(currentFile.name, {
      entries: newEntries,
      magic1: currentFile.magic1,
      magic2: currentFile.magic2,
      sourceFormat: currentFile.sourceFormat,
    });
    if (selected === idx) setSelected(newIdx);
  };

  const handleExport = () => {
    if (!currentFile) return;
    const map = Object.fromEntries(currentFile.entries.map(e => [e.key, e.value]));
    const text = serializeTextLocFile(map);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const outName = currentFile.name
      .replace(/\.txt\.strings\.bin$/i, '.txt')
      .replace(/\.strings\.bin$/i, '.txt')
      .replace(/\.bin$/i, '.txt');
    a.href = url; a.download = outName; a.click();
    URL.revokeObjectURL(url);
    updateFiles((f) => ({ ...f, dirty: false }));
  };

  const handleCloseFile = (idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    if (activeFile === idx) {
      setActiveFile(files.length > 1 ? (idx > 0 ? idx - 1 : 0) : null);
      setSelected(null); setEditKey(''); setEditValue('');
    } else if (activeFile > idx) {
      setActiveFile(activeFile - 1);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700 bg-slate-900 shrink-0">
        <FileText className="w-4 h-4 text-blue-400 shrink-0" />
        <h1 className="text-sm font-bold text-white">Text Localization Editor</h1>
        <span className="text-[11px] text-slate-400">plain .txt</span>
        <div className="flex-1" />
        <label className="cursor-pointer">
          <input ref={fileInputRef} type="file" className="hidden" multiple accept=".txt" onChange={handleLoad} />
          <Button asChild variant="outline" size="sm" className="gap-1.5 pointer-events-none h-8 border-slate-500 text-slate-200 hover:bg-slate-700">
            <span><Upload className="w-3.5 h-3.5" /> Open File(s)</span>
          </Button>
        </label>
        {currentFile && (
          <Button size="sm" onClick={handleExport} className="gap-1.5 h-8 bg-blue-600 hover:bg-blue-500 text-white">
            <Download className="w-3.5 h-3.5" /> Export .txt
          </Button>
        )}
      </div>

      {/* File tabs */}
      {files.length > 0 && (
        <div className="flex gap-1 px-3 pt-2 pb-0 border-b border-slate-700 bg-slate-900 overflow-x-auto">
          {files.map((f, i) => (
            <button
              key={f.name}
              onClick={() => { setActiveFile(i); setSelected(null); setEditKey(''); setEditValue(''); setSearch(''); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-md text-[11px] font-medium border border-b-0 transition-all shrink-0 ${i === activeFile ? 'bg-slate-800 text-white border-slate-600' : 'bg-slate-900 text-slate-400 border-transparent hover:bg-slate-800 hover:text-slate-200'}`}
            >
              {f.dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
              {f.name}
              <X className="w-3 h-3 ml-0.5 opacity-50 hover:opacity-100" onClick={(e) => { e.stopPropagation(); handleCloseFile(i); }} />
            </button>
          ))}
        </div>
      )}

      {/* Main area */}
      {!currentFile ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-400 p-8">
          <FileText className="w-14 h-14 opacity-20" />
          <p className="text-sm font-medium text-slate-300">No file loaded</p>
          <p className="text-xs text-slate-500 text-center max-w-xs">
            Load your <code className="font-mono bg-slate-800 text-slate-300 px-1 rounded">text\</code> folder from the Home page,
            or open a plain <code className="font-mono bg-slate-800 text-slate-300 px-1 rounded">.txt</code> localization file directly.
          </p>
          <label className="cursor-pointer">
            <input type="file" className="hidden" multiple accept=".txt" onChange={handleLoad} />
            <Button asChild variant="outline" className="gap-2 pointer-events-none border-slate-600 text-slate-200 hover:bg-slate-700">
              <span><Upload className="w-4 h-4" /> Open Text File</span>
            </Button>
          </label>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Left: entry list */}
          <div className="w-80 shrink-0 border-r border-slate-700 flex flex-col bg-slate-900">
            <div className="p-2 border-b border-slate-700 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search keys or values…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full h-7 pl-7 pr-2 text-[11px] bg-slate-800 border border-slate-600 rounded text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0 border-slate-600 text-slate-300">{filteredEntries.length}</Badge>
            </div>

            <div className="flex-1 overflow-y-auto" id="strings-entry-list">
              {filteredEntries.map((entry) => (
                <div
                  key={entry.originalIndex}
                  onClick={() => handleSelectEntry(entry)}
                  className={`group flex items-center gap-1 px-3 py-2 cursor-pointer border-b border-slate-800 transition-colors ${selected === entry.originalIndex ? 'bg-blue-900/40 text-blue-300' : 'hover:bg-slate-800'}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-mono font-semibold truncate text-slate-200">{entry.key || <span className="opacity-30">(empty key)</span>}</p>
                    <p className="text-[10px] text-slate-400 truncate">{entry.value || <span className="opacity-30">(no value)</span>}</p>
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                    <button onClick={(e) => { e.stopPropagation(); handleMove(entry.originalIndex, -1); }} className="p-0.5 rounded hover:bg-slate-600 text-slate-300">
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleMove(entry.originalIndex, 1); }} className="p-0.5 rounded hover:bg-slate-600 text-slate-300">
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(entry.originalIndex); }} className="p-0.5 rounded hover:bg-red-900 text-red-400">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-2 border-t border-slate-700">
              <Button size="sm" variant="outline" className="w-full gap-1.5 h-8 border-slate-600 text-slate-200 hover:bg-slate-700"
                onClick={() => { setIsNew(true); setSelected(null); setEditKey(''); setEditValue(''); }}>
                <Plus className="w-3.5 h-3.5" /> New Entry
              </Button>
            </div>
          </div>

          {/* Right: editor */}
          <div className="flex-1 flex flex-col p-4 gap-4 bg-slate-950">
            {(selected !== null || isNew) ? (
              <>
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Internal Key (identifier)</label>
                  <Input
                    value={editKey}
                    onChange={(e) => setEditKey(e.target.value)}
                    className="font-mono text-sm h-9 bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500"
                    placeholder="KEY_NAME"
                  />
                </div>
                <div className="space-y-1 flex-1 flex flex-col">
                  <label className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Display Text (value)</label>
                  <Textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="flex-1 font-mono text-sm resize-none min-h-[200px] bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500"
                    placeholder="Text displayed in-game…"
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSaveEntry} className="gap-1.5 bg-blue-600 hover:bg-blue-500 text-white">
                    <Save className="w-3.5 h-3.5" />
                    {isNew ? 'Add Entry' : 'Save Changes'}
                  </Button>
                  <Button variant="outline" className="border-slate-600 text-slate-200 hover:bg-slate-700"
                    onClick={() => { setSelected(null); setIsNew(false); setEditKey(''); setEditValue(''); }}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-500">
                <FileText className="w-10 h-10 opacity-20" />
                <p className="text-sm text-slate-400">Select an entry to edit, or create a new one.</p>
                <p className="text-[11px] text-slate-600">{currentFile.entries.length} entries in {currentFile.name}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
