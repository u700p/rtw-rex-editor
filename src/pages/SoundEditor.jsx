import React, { useState, useRef, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Volume2, FolderOpen, Download, Search, Plus, Trash2,
  ChevronDown, ChevronRight, FileText, RefreshCw, Save
} from 'lucide-react';
import JSZip from 'jszip';
import { textBlob, toCRLF } from '@/lib/lineEndings';

// Known M2TW sound script files
const KNOWN_SOUND_FILES = [
  'descr_sounds_animals.txt',
  'descr_sounds_battles.txt',
  'descr_sounds_building_battle.txt',
  'descr_sounds_building_construction.txt',
  'descr_sounds_environment.txt',
  'descr_sounds_frontend.txt',
  'descr_sounds_missiles.txt',
  'descr_sounds_music.txt',
  'descr_sounds_strat.txt',
  'descr_sounds_units.txt',
  'descr_sounds_units_voice.txt',
  'descr_sounds_weapons.txt',
  'descr_sounds_siege.txt',
  'descr_sounds_ui.txt',
];

function parseSoundFile(text) {
  // Each entry starts with a label line, followed by key value lines, ends on blank or next label
  const lines = text.split('\n');
  const entries = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed || trimmed.startsWith(';')) {
      if (current) {
        if (!trimmed.startsWith(';')) {
          entries.push(current);
          current = null;
        } else {
          current.comments = (current.comments || '') + raw + '\n';
        }
      } else if (trimmed.startsWith(';')) {
        // top-level comment
        entries.push({ type: 'comment', raw });
      }
      continue;
    }

    // Check if this looks like a block start (no leading spaces / tabs, not a key=value)
    if (!raw.startsWith('\t') && !raw.startsWith(' ') && !trimmed.includes(' ') && trimmed !== '{' && trimmed !== '}') {
      if (current) entries.push(current);
      current = { type: 'entry', label: trimmed, lines: [], raw: raw + '\n', comments: '' };
    } else if (current) {
      current.lines.push({ key: trimmed, raw });
      current.raw += raw + '\n';
    } else {
      entries.push({ type: 'raw', raw });
    }
  }
  if (current) entries.push(current);
  return entries;
}

function serializeEntries(entries) {
  return entries.map(e => {
    if (e.type === 'comment' || e.type === 'raw') return e.raw;
    if (e.type === 'entry') {
      let out = e.comments || '';
      out += e.label + '\n';
      out += e.lines.map(l => l.raw).join('\n');
      return out;
    }
    return '';
  return toCRLF(entries.map(e => {
    if (e.type === 'comment' || e.type === 'raw') return e.raw;
    if (e.type === 'entry') {
      let out = e.comments || '';
      out += e.label + '\n';
      out += e.lines.map(l => l.raw).join('\n');
      return out;
    }
    return '';
  }).join('\n'));
}

function SoundEntry({ entry, onUpdate, onDelete }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState(entry.lines.map(l => l.raw));

  const handleLineChange = (i, val) => {
    const updated = [...lines];
    updated[i] = val;
    setLines(updated);
  };

  const handleSave = () => {
    onUpdate({ ...entry, lines: lines.map(raw => ({ key: raw.trim(), raw })) });
  };

  const handleAddLine = () => {
    setLines(prev => [...prev, '\t']);
  };

  if (entry.type === 'comment') {
    return <div className="text-[10px] font-mono text-muted-foreground/50 px-3 py-0.5">{entry.raw}</div>;
  }
  if (entry.type === 'raw') {
    return <div className="text-[10px] font-mono text-muted-foreground/40 px-3 py-0.5">{entry.raw}</div>;
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden mb-1">
      <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/20 cursor-pointer" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
        <code className="text-xs font-mono text-primary flex-1 truncate">{entry.label}</code>
        <span className="text-[10px] text-muted-foreground shrink-0">{entry.lines.length} line{entry.lines.length !== 1 ? 's' : ''}</span>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="ml-1 text-muted-foreground hover:text-destructive transition-colors">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      {open && (
        <div className="border-t border-border bg-accent/10 p-3 space-y-2">
          <div className="space-y-1">
            {lines.map((line, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={line}
                  onChange={e => handleLineChange(i, e.target.value)}
                  className="flex-1 h-6 px-2 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={handleAddLine}>
              <Plus className="w-3 h-3" /> Add line
            </Button>
            <Button size="sm" className="h-6 text-[10px] gap-1" onClick={handleSave}>
              <Save className="w-3 h-3" /> Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SoundEditor() {
  const [files, setFiles] = useState({}); // filename -> { text, entries }
  const [activeFile, setActiveFile] = useState(null);
  const [search, setSearch] = useState('');
  const [newEntryLabel, setNewEntryLabel] = useState('');
  const folderRef = useRef();

  const handleFolderLoad = (e) => {
    const fileList = Array.from(e.target.files || []);
    e.target.value = '';
    const soundFiles = fileList.filter(f => f.name.toLowerCase().startsWith('descr_sounds') && f.name.toLowerCase().endsWith('.txt'));
    if (soundFiles.length === 0) return;

    const readers = soundFiles.map(f => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = ev => resolve({ name: f.name.toLowerCase(), text: ev.target.result });
      reader.readAsText(f);
    }));

    Promise.all(readers).then(results => {
      const newFiles = {};
      results.forEach(({ name, text }) => {
        newFiles[name] = { text, entries: parseSoundFile(text) };
      });
      setFiles(prev => ({ ...prev, ...newFiles }));
      if (!activeFile && results.length > 0) setActiveFile(results[0].name);
    });
  };

  const currentFile = activeFile ? files[activeFile] : null;

  const filteredEntries = useMemo(() => {
    if (!currentFile) return [];
    if (!search) return currentFile.entries;
    return currentFile.entries.filter(e => {
      if (e.type !== 'entry') return false;
      return e.label.toLowerCase().includes(search.toLowerCase()) ||
        e.lines.some(l => l.raw.toLowerCase().includes(search.toLowerCase()));
    });
  }, [currentFile, search]);

  const handleUpdateEntry = (idx, updated) => {
    if (!activeFile) return;
    setFiles(prev => {
      const entries = [...prev[activeFile].entries];
      // find real index
      const real = prev[activeFile].entries.indexOf(currentFile.entries[idx]);
      if (real !== -1) entries[real] = updated;
      return { ...prev, [activeFile]: { ...prev[activeFile], entries } };
    });
  };

  const handleDeleteEntry = (idx) => {
    if (!activeFile) return;
    setFiles(prev => {
      const entries = prev[activeFile].entries.filter((_, i) => i !== idx);
      return { ...prev, [activeFile]: { ...prev[activeFile], entries } };
    });
  };

  const handleAddEntry = () => {
    if (!newEntryLabel.trim() || !activeFile) return;
    const newEntry = { type: 'entry', label: newEntryLabel.trim(), lines: [], raw: newEntryLabel.trim() + '\n', comments: '' };
    setFiles(prev => ({
      ...prev,
      [activeFile]: { ...prev[activeFile], entries: [...prev[activeFile].entries, newEntry] }
    }));
    setNewEntryLabel('');
  };

  const handleExportAll = async () => {
    const zip = new JSZip();
    const folder = zip.folder('data/sounds/');
    Object.entries(files).forEach(([name, { entries }]) => {
      folder.file(name, toCRLF(serializeEntries(entries)));
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'descr_sounds_modified.zip';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportSingle = () => {
    if (!activeFile || !currentFile) return;
    const text = serializeEntries(currentFile.entries);
    const blob = textBlob(text);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadedCount = Object.keys(files).length;

  return (
    <div className="h-screen flex flex-col">
      {/* Toolbar */}
      <div className="h-10 border-b border-border flex items-center px-4 gap-3 shrink-0 bg-card/50">
        <Volume2 className="w-4 h-4 text-primary shrink-0" />
        <span className="text-xs font-semibold text-foreground">Sound Files Editor</span>
        <span className="text-[10px] text-muted-foreground">— descr_sounds_*.txt</span>
        <div className="ml-auto flex items-center gap-2">
          {loadedCount > 0 && (
            <>
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={handleExportSingle} disabled={!activeFile}>
                <Download className="w-3 h-3" /> This file
              </Button>
              <Button size="sm" className="h-7 text-[11px] gap-1" onClick={handleExportAll}>
                <Download className="w-3 h-3" /> Export all (.zip)
              </Button>
            </>
          )}
          <label className="cursor-pointer">
            <input ref={folderRef} type="file" className="hidden" webkitdirectory="" directory="" multiple onChange={handleFolderLoad} />
            <Button asChild variant="outline" size="sm" className="h-7 text-[11px] gap-1 pointer-events-none">
              <span><FolderOpen className="w-3 h-3" /> Load sounds folder</span>
            </Button>
          </label>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left: file list */}
        <div className="w-52 border-r border-border flex flex-col shrink-0">
          <div className="p-2 border-b border-border">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1">Sound Files</p>
            {loadedCount === 0 && (
              <p className="text-[10px] text-muted-foreground px-1">Load your mod's <code className="font-mono bg-accent px-1 rounded">sounds/</code> folder to begin.</p>
            )}
          </div>
          <ScrollArea className="flex-1">
            <div className="p-1.5 space-y-0.5">
              {/* Loaded files */}
              {Object.keys(files).map(fname => (
                <button
                  key={fname}
                  onClick={() => setActiveFile(fname)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[11px] transition-colors ${activeFile === fname ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent/30'}`}
                >
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="truncate font-mono">{fname.replace('descr_sounds_', '').replace('.txt', '')}</span>
                </button>
              ))}
              {/* Known files not yet loaded */}
              {KNOWN_SOUND_FILES.filter(f => !files[f]).map(fname => (
                <div
                  key={fname}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] text-muted-foreground/40"
                >
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="truncate font-mono">{fname.replace('descr_sounds_', '').replace('.txt', '')}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Right: editor */}
        <div className="flex-1 flex flex-col min-h-0">
          {!currentFile ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 p-8">
              <Volume2 className="w-12 h-12 opacity-15" />
              <p className="text-sm font-medium">No sound file loaded</p>
              <p className="text-xs text-center max-w-sm">
                Click <strong>Load sounds folder</strong> and browse to your mod's <code className="font-mono bg-accent px-1 rounded">data/sounds/</code> directory. The M2TW base sound files are available at{' '}
                <a href="https://github.com/RiritoNinigaya/M2TW-TextSoundFiles" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  github.com/RiritoNinigaya/M2TW-TextSoundFiles
                </a>.
              </p>
            </div>
          ) : (
            <>
              {/* Search + add */}
              <div className="border-b border-border px-3 py-2 flex items-center gap-2 shrink-0">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search entries…"
                    className="w-full h-7 pl-7 pr-3 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {filteredEntries.filter(e => e.type === 'entry').length} entries
                </span>
              </div>

              {/* Add entry */}
              <div className="border-b border-border px-3 py-2 flex items-center gap-2 shrink-0">
                <input
                  value={newEntryLabel}
                  onChange={e => setNewEntryLabel(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddEntry()}
                  placeholder="New entry label…"
                  className="flex-1 h-7 px-2 text-[11px] font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <Button size="sm" className="h-7 text-[10px] gap-1" onClick={handleAddEntry} disabled={!newEntryLabel.trim()}>
                  <Plus className="w-3 h-3" /> Add
                </Button>
              </div>

              {/* Entries */}
              <ScrollArea className="flex-1">
                <div className="p-3">
                  {filteredEntries.map((entry, i) => (
                    <SoundEntry
                      key={i}
                      entry={entry}
                      onUpdate={(updated) => handleUpdateEntry(i, updated)}
                      onDelete={() => handleDeleteEntry(currentFile.entries.indexOf(entry))}
                    />
                  ))}
                </div>
              </ScrollArea>

              {/* Footer */}
              <div className="h-7 border-t border-border flex items-center px-3 shrink-0 bg-card/30">
                <span className="text-[10px] font-mono text-muted-foreground">{activeFile}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {currentFile.entries.filter(e => e.type === 'entry').length} entries
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
