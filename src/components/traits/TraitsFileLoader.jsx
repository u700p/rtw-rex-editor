import React, { useRef } from 'react';
import { useTraits } from './TraitsContext';
import { Button } from '@/components/ui/button';
import { Upload, Download, Save, RotateCcw } from 'lucide-react';

export default function TraitsFileLoader() {
  const {
    traitsData, textData, traitsFilename, textFilename,
    loadTraitsFile, loadTextFile,
    exportTraitsFile, exportTextFile,
    saveTraits, revertTraits,
    isDirty,
  } = useTraits();
  const traitsRef = useRef();
  const textRef = useRef();

  const handleTraitsFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => loadTraitsFile(ev.target.result, file.name);
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleTextFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = ev => loadTextFile(ev.target.result, file.name);
    reader.readAsText(file);
  };

  const downloadFile = (content, filename) => {
    const safeName = filename
      .replace(/\.txt\.strings\.bin$/i, '.txt')
      .replace(/\.strings\.bin$/i, '.txt')
      .replace(/\.bin$/i, '.txt');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = safeName; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border bg-card">
      <input ref={traitsRef} type="file" accept=".txt" className="hidden" onChange={handleTraitsFile} />
      <input ref={textRef} type="file" accept=".txt" className="hidden" onChange={handleTextFile} />

      {/* Load buttons */}
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1.5 text-white"
        onClick={() => traitsRef.current?.click()}>
        <Upload className="w-3 h-3" />
        Load Traits
      </Button>
      {traitsData && <span className="text-[10px] text-muted-foreground font-mono truncate max-w-32">{traitsFilename}</span>}

      <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1.5 text-white"
        onClick={() => textRef.current?.click()}>
        <Upload className="w-3 h-3" />
        Load VnVs Text
      </Button>
      {textData && <span className="text-[10px] text-muted-foreground font-mono truncate max-w-32">{textFilename}</span>}

      {/* Save / Revert */}
      {traitsData && isDirty && (
        <>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1.5 text-white ml-auto"
            onClick={saveTraits}>
            <Save className="w-3 h-3" />
            Save
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1.5 text-white"
            onClick={revertTraits}>
            <RotateCcw className="w-3 h-3" />
            Revert
          </Button>
        </>
      )}

      {/* Export */}
      {traitsData && (
        <Button size="sm" className="h-7 px-2 text-xs gap-1.5 text-white ml-auto"
          onClick={() => downloadFile(exportTraitsFile(), traitsFilename)}>
          <Download className="w-3 h-3" />
          Export Traits{isDirty && ' *'}
        </Button>
      )}
      {textData && (
        <Button size="sm" variant="secondary" className="h-7 px-2 text-xs gap-1.5 text-white"
          onClick={() => downloadFile(exportTextFile(), textFilename)}>
          <Download className="w-3 h-3" />
          Export Text
        </Button>
      )}
    </div>
  );
}
