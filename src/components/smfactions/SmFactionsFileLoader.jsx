import React, { useRef } from 'react';
import { useSmFactions } from './SmFactionsContext';
import { Button } from '@/components/ui/button';
import { Upload, Download, Save, RotateCcw } from 'lucide-react';

function downloadText(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function SmFactionsFileLoader() {
  const { factions, filename, isDirty, loaded, loadFile, exportFile, save, revert } = useSmFactions();
  const inputRef = useRef();

  const handleFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => loadFile(ev.target.result, file.name);
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-2 border-b border-border bg-card text-xs shrink-0">
      <input ref={inputRef} type="file" accept=".txt" className="hidden" onChange={handleFile} />

      <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-white"
        onClick={() => inputRef.current?.click()}>
        <Upload className="w-3 h-3" /> Load descr_sm_factions.txt
      </Button>

      {loaded && (
        <>
          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-48">{filename}</span>
          <span className="text-[10px] text-muted-foreground">({factions.length} factions)</span>

          <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-white"
            onClick={() => downloadText(exportFile(), filename)}>
            <Download className="w-3 h-3" /> Export
          </Button>

          {isDirty && (
            <>
              <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-green-400 border-green-700"
                onClick={save}>
                <Save className="w-3 h-3" /> Save
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 gap-1 text-muted-foreground"
                onClick={revert}>
                <RotateCcw className="w-3 h-3" /> Revert
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}
