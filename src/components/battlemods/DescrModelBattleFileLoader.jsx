import React, { useRef } from 'react';
import { useDescrModelBattle } from './DescrModelBattleContext';
import { Button } from '@/components/ui/button';
import { Upload, Download, Save, RotateCcw } from 'lucide-react';

function downloadText(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function DescrModelBattleFileLoader() {
  const {
    dmbData, dmbFilename, dmbDirty,
    bmdbData, bmdbFilename, bmdbDirty,
    loadDmbFile, loadBmdbFile,
    exportDmbFile, exportBmdbFile,
    saveDmb, revertDmb,
    saveBmdb, revertBmdb,
  } = useDescrModelBattle();

  const dmbRef  = useRef();
  const bmdbRef = useRef();

  const handleDmbFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => loadDmbFile(ev.target.result, file.name);
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleBmdbFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => loadBmdbFile(ev.target.result, file.name);
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-2 border-b border-border bg-card text-xs shrink-0">
      <input ref={dmbRef} type="file" accept=".txt" className="hidden" onChange={handleDmbFile} />
      <input ref={bmdbRef} type="file" accept=".db,.modeldb,.txt" className="hidden" onChange={handleBmdbFile} />

      {/* ── descr_model_battle.txt ── */}
      <span className="text-muted-foreground font-medium hidden sm:inline">descr_model_battle.txt:</span>
      <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-white"
        onClick={() => dmbRef.current?.click()}>
        <Upload className="w-3 h-3" /> Load
      </Button>
      {dmbData && (
        <>
          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-36">{dmbFilename}</span>
          <span className="text-[10px] text-muted-foreground">({dmbData.entries.length} entries)</span>
          <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-white"
            onClick={() => { const c = exportDmbFile(); if (c) downloadText(c, dmbFilename); }}>
            <Download className="w-3 h-3" /> Export
          </Button>
          {dmbDirty && (
            <>
              <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-green-400 border-green-700"
                onClick={saveDmb}>
                <Save className="w-3 h-3" /> Save
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 gap-1 text-muted-foreground"
                onClick={revertDmb}>
                <RotateCcw className="w-3 h-3" /> Revert
              </Button>
            </>
          )}
        </>
      )}

      <div className="w-px h-5 bg-border mx-1 hidden sm:block" />

      {/* ── battlemodel.db ── */}
      <span className="text-muted-foreground font-medium hidden sm:inline">battlemodel.db:</span>
      <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-white"
        onClick={() => bmdbRef.current?.click()}>
        <Upload className="w-3 h-3" /> Load
      </Button>
      {bmdbData && (
        <>
          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-36">{bmdbFilename}</span>
          <span className="text-[10px] text-muted-foreground">({bmdbData.entries?.length ?? 0} entries)</span>
          <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-white"
            onClick={() => { const c = exportBmdbFile(); if (c) downloadText(c, bmdbFilename); }}>
            <Download className="w-3 h-3" /> Export
          </Button>
          {bmdbDirty && (
            <>
              <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-green-400 border-green-700"
                onClick={saveBmdb}>
                <Save className="w-3 h-3" /> Save
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 gap-1 text-muted-foreground"
                onClick={revertBmdb}>
                <RotateCcw className="w-3 h-3" /> Revert
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}
