import React, { useState, useRef, useCallback } from 'react';
import { Upload, Plus, Download, Trash2, ImagePlus, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { parseSdXml, serialiseSdXml } from './sdXmlParser';
import SpriteCanvas from './SpriteCanvas';
import { decodeTgaToDataUrl } from '@/components/shared/tgaDecoder';

async function loadImageAsDataUrl(file) {
  const isTga = file.name.toLowerCase().endsWith('.tga');
  if (isTga) {
    const buf = await file.arrayBuffer();
    const url = decodeTgaToDataUrl(buf);
    if (!url) throw new Error('Could not decode TGA file');
    return url;
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}

export default function SpriteSheetEditor({ label, storageKey }) {
  const [data, setData] = useState(null);        // { version, enumName, pages, sprites }
  const [pageImages, setPageImages] = useState({}); // { pageIndex: dataUrl }
  const [activePageIdx, setActivePageIdx] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [pendingRect, setPendingRect] = useState(null);
  const [newSpriteName, setNewSpriteName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddPage, setShowAddPage] = useState(false);
  const [newPageFile, setNewPageFile] = useState('');
  const [newPageW, setNewPageW] = useState(512);
  const [newPageH, setNewPageH] = useState(512);
  const [imageError, setImageError] = useState({});
  const xmlInputRef = useRef();

  // --- Load XML ---
  const handleXmlFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseSdXml(text);
    setData(parsed);
    setActivePageIdx(0);
    setPendingRect(null);
    setSelectionMode(false);
    setSelectedIdx(null);
  }, []);

  // --- Load TGA image for a page ---
  const handlePageImage = useCallback(async (e, pageIdx) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-selected
    e.target.value = '';
    setImageError(prev => ({ ...prev, [pageIdx]: null }));
    try {
      const url = await loadImageAsDataUrl(file);
      setPageImages(prev => ({ ...prev, [pageIdx]: url }));
    } catch (err) {
      setImageError(prev => ({ ...prev, [pageIdx]: err.message }));
    }
  }, []);

  // --- Add a new TGA page entry ---
  const addPage = () => {
    if (!newPageFile.trim()) return;
    setData(prev => ({
      ...prev,
      pages: [...prev.pages, { 
        file: newPageFile.trim(), 
        width: newPageW, 
        height: newPageH, 
        force32bit: '0' 
      }],
    }));
    setNewPageFile('');
    setShowAddPage(false);
  };

  // --- Remove a page (and reassign sprite page indices) ---
  const removePage = (idx) => {
    setData(prev => {
      const pages = prev.pages.filter((_, i) => i !== idx);
      const sprites = prev.sprites
        .filter(s => s.page !== idx)
        .map(s => ({ ...s, page: s.page > idx ? s.page - 1 : s.page }));
      return { ...prev, pages, sprites };
    });
    setPageImages(prev => {
      const next = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = parseInt(k);
        if (ki !== idx) next[ki > idx ? ki - 1 : ki] = v;
      });
      return next;
    });
    setActivePageIdx(p => Math.min(p, Math.max(0, (data?.pages.length ?? 1) - 2)));
  };

  // --- Confirm new sprite from drawn rect ---
  const confirmNewSprite = () => {
    if (!newSpriteName.trim() || !pendingRect) return;
    setData(prev => {
      const nextIndex = prev.sprites.length;
      const sprite = {
        index: nextIndex,
        name: newSpriteName.trim().toUpperCase(),
        page: activePageIdx,
        ...pendingRect,
        x_offset: 0,
        y_offset: 0,
        alpha: '1',
        cursor: '0',
      };
      return { ...prev, sprites: [...prev.sprites, sprite] };
    });
    setPendingRect(null);
    setNewSpriteName('');
    setSelectionMode(false);
  };

  // --- Duplicate a sprite ---
  const duplicateSprite = (index) => {
    setData(prev => {
      const src = prev.sprites.find(s => s.index === index);
      if (!src) return prev;
      const newSprite = { 
        ...src, 
        index: prev.sprites.length, 
        name: src.name + '_COPY' 
      };
      return { ...prev, sprites: [...prev.sprites, newSprite] };
    });
  };

  // --- Delete a sprite ---
  const deleteSprite = (index) => {
    setData(prev => ({
      ...prev,
      sprites: prev.sprites.filter(s => s.index !== index).map((s, i) => ({ ...s, index: i })),
    }));
    setSelectedIdx(prev => (prev === index ? null : prev));
  };

  // --- Update sprite field inline ---
  const updateSprite = (index, field, value) => {
    setData(prev => ({
      ...prev,
      sprites: prev.sprites.map(s => s.index === index ? { ...s, [field]: isNaN(Number(value)) ? value : Number(value) } : s),
    }));
  };

  // --- Export XML ---
  const exportXml = () => {
    if (!data) return;
    const xml = serialiseSdXml(data);
    const blob = new Blob([xml], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${data.enumName?.toLowerCase() ?? 'sprites'}.sd.xml`;
    a.click();
  };

  const activePage = data?.pages?.[activePageIdx];
  const pageSprites = data?.sprites?.filter(s => s.page === activePageIdx) ?? [];
  const filteredSprites = (data?.sprites ?? []).filter(s =>
    !searchTerm || s.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Upload className="w-10 h-10 text-slate-500" />
        <p className="text-sm text-slate-400">Load a <span className="font-mono text-amber-400">{label}</span> file</p>
        <Button variant="outline" size="sm" onClick={() => xmlInputRef.current?.click()}>
          Load {label}
        </Button>
        <input ref={xmlInputRef} type="file" accept=".xml,.txt" className="hidden" onChange={handleXmlFile} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Top toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => xmlInputRef.current?.click()}>
          <Upload className="w-3.5 h-3.5 mr-1" /> Reload XML
        </Button>
        <input ref={xmlInputRef} type="file" accept=".xml,.txt" className="hidden" onChange={handleXmlFile} />
        {data.format && (
          <>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${data.format === 'm2ex' ? 'bg-purple-900/30 text-purple-400 border border-purple-700' : 'bg-blue-900/30 text-blue-400 border border-blue-700'}`}>
              {data.format === 'm2ex' ? 'M2EX' : 'M2TW'}
            </span>
            <span className="text-[10px] text-slate-600">•</span>
          </>
        )}
        <span className="text-[10px] font-mono text-slate-500">{data.enumName}</span>
        <span className="text-[10px] text-slate-600">•</span>
        <span className="text-[10px] text-slate-500">{data.sprites.length} sprites / {data.pages.length} pages</span>
        <div className="flex-1" />
        <Button size="sm" onClick={exportXml}>
          <Download className="w-3.5 h-3.5 mr-1" /> Export XML
        </Button>
      </div>

      <div className="flex gap-2 flex-1 min-h-0 overflow-hidden">
        {/* LEFT: page list + canvas */}
        <div className="flex flex-col gap-2 w-auto flex-1 min-w-0">
          {/* Page tabs */}
          <div className="flex gap-1 flex-wrap items-center">
            {data.pages.map((p, i) => (
              <div key={i} className="flex items-center gap-0.5 group">
                <button
                  onClick={() => setActivePageIdx(i)}
                  className={`px-2 py-1 rounded text-[10px] font-mono transition-colors ${
                    activePageIdx === i ? 'bg-amber-600/30 text-amber-300' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  [{i}] {p.file}
                </button>
                <button onClick={() => removePage(i)}
                  className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 text-[9px] p-0.5 transition-opacity">
                  ✕
                </button>
              </div>
            ))}
            <button onClick={() => setShowAddPage(v => !v)}
              className="px-2 py-1 rounded text-[10px] bg-slate-800 text-green-400 hover:bg-slate-700 transition-colors">
              <Plus className="w-3 h-3 inline mr-0.5" />Add Page
            </button>
          </div>

          {/* Add page form */}
          {showAddPage && (
            <div className="flex gap-1 items-center flex-wrap p-2 bg-slate-800/60 rounded border border-slate-700">
              <Input className="h-6 text-[10px] w-48" placeholder="filename.tga" value={newPageFile}
                onChange={e => setNewPageFile(e.target.value)} />
              <Input className="h-6 text-[10px] w-16" type="number" placeholder="W" value={newPageW}
                onChange={e => setNewPageW(parseInt(e.target.value))} />
              <Input className="h-6 text-[10px] w-16" type="number" placeholder="H" value={newPageH}
                onChange={e => setNewPageH(parseInt(e.target.value))} />
              <Button size="sm" className="h-6 text-[10px]" onClick={addPage}>Add</Button>
            </div>
          )}

          {/* Active page info + image upload */}
          {activePage && (
            <div className="flex items-center gap-2 text-[10px] text-slate-400">
              <span className="font-mono">{activePage.file}</span>
              <span>{activePage.width}×{activePage.height}</span>
              <label className="cursor-pointer flex items-center gap-1 px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition-colors">
                <ImagePlus className="w-3 h-3" />
                {pageImages[activePageIdx] ? 'Replace TGA/PNG' : 'Upload TGA/PNG'}
                <input type="file" accept="image/png,image/jpeg,image/bmp,.tga" className="hidden"
                  onChange={e => handlePageImage(e, activePageIdx)} />
              </label>
              {imageError[activePageIdx] && (
                <span className="text-red-400 text-[9px]">⚠ {imageError[activePageIdx]}</span>
              )}
              {pageImages[activePageIdx] && (
                <span className="text-green-500 text-[9px]">✓ loaded</span>
              )}
              <button
                onClick={() => setSelectionMode(v => !v)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${
                  selectionMode
                    ? 'bg-orange-600/30 border-orange-500 text-orange-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                }`}
              >
                <Plus className="w-3 h-3" /> {selectionMode ? 'Drawing...' : 'New Sprite'}
              </button>
            </div>
          )}

          {/* Pending rect → name + confirm */}
          {pendingRect && (
            <div className="flex items-center gap-2 p-2 bg-orange-900/20 border border-orange-700/50 rounded text-[10px]">
              <span className="text-orange-400 font-mono">
                {pendingRect.left},{pendingRect.top} → {pendingRect.right},{pendingRect.bottom}
              </span>
              <Input className="h-6 text-[10px] flex-1 uppercase"
                placeholder="SPRITE_NAME"
                value={newSpriteName}
                onChange={e => setNewSpriteName(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && confirmNewSprite()} />
              <Button size="sm" className="h-6 text-[10px]" onClick={confirmNewSprite}>Confirm</Button>
              <button onClick={() => { setPendingRect(null); setSelectionMode(false); }}
                className="text-slate-500 hover:text-red-400">✕</button>
            </div>
          )}

          {/* Canvas */}
          <div className="overflow-auto border border-slate-700 rounded bg-slate-900/60 flex-1">
            <SpriteCanvas
              imageUrl={pageImages[activePageIdx] ?? null}
              pageWidth={activePage?.width ?? 512}
              pageHeight={activePage?.height ?? 512}
              sprites={pageSprites}
              hoveredIdx={hoveredIdx}
              onHover={setHoveredIdx}
              selectionMode={selectionMode}
              onSelect={(rect) => { setPendingRect(rect); setSelectionMode(false); }}
            />
          </div>
        </div>

        {/* RIGHT: sprite list */}
        <div className="w-72 shrink-0 flex flex-col gap-2">
          <Input
            className="h-7 text-[10px]"
            placeholder="Search sprites…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
          <ScrollArea className="flex-1 border border-slate-700 rounded bg-slate-900/40">
            <div className="p-1 space-y-0.5">
              {filteredSprites.map(sp => (
                <div
                   key={sp.index}
                   onMouseEnter={() => { setHoveredIdx(sp.index); setActivePageIdx(sp.page); }}
                   onMouseLeave={() => setHoveredIdx(null)}
                   onClick={() => { setSelectedIdx(sp.index); setActivePageIdx(sp.page); }}
                   className={`flex items-center gap-1 px-1.5 py-1 rounded cursor-pointer transition-colors text-[9px] group ${
                     selectedIdx === sp.index ? 'bg-amber-600/30 text-amber-200 ring-1 ring-amber-600/50' :
                     hoveredIdx === sp.index ? 'bg-amber-600/20 text-amber-300' : 'text-slate-400 hover:bg-slate-800'
                   }`}
                 >
                  <span className="font-mono text-slate-500 w-6 shrink-0">{sp.index}</span>
                  <span className="flex-1 truncate font-mono">{sp.name}</span>
                  <span className="text-slate-600 shrink-0">p{sp.page}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); duplicateSprite(sp.index); }}
                    title="Duplicate"
                    className="opacity-0 group-hover:opacity-100 text-blue-400 hover:text-blue-300 shrink-0 transition-opacity">
                    <Copy className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSprite(sp.index); }}
                    title="Delete"
                    className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 shrink-0 transition-opacity">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {filteredSprites.length === 0 && (
                <p className="text-[9px] text-slate-600 text-center py-4">No sprites match</p>
              )}
            </div>
          </ScrollArea>

          {/* Selected sprite detail */}
          {selectedIdx !== null && (() => {
            const sp = data.sprites.find(s => s.index === selectedIdx);
            if (!sp) return null;
            return (
              <div className="p-2 bg-slate-800/60 border border-slate-700 rounded text-[9px] space-y-1.5">
                <input
                  className="w-full bg-transparent border-b border-amber-600/50 outline-none text-amber-400 font-mono font-semibold text-[10px]"
                  value={sp.name}
                  onChange={e => updateSprite(sp.index, 'name', e.target.value.toUpperCase())}
                  title="Rename sprite"
                />
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-slate-400 font-mono">
                  <span>page:</span><span className="text-slate-300">{sp.page}</span>
                  {[['left','left'],['top','top'],['right','right'],['bottom','bottom'],['x_offset','x_offset'],['y_offset','y_offset']].map(([label, field]) => (
                    <React.Fragment key={field}>
                      <span>{label}:</span>
                      <input className="bg-transparent border-b border-slate-600 w-full outline-none text-slate-300"
                        value={sp[field] ?? 0} onChange={e => updateSprite(sp.index, field, e.target.value)} />
                    </React.Fragment>
                  ))}
                  <span>alpha:</span>
                  <input className="bg-transparent border-b border-slate-600 w-full outline-none text-slate-300"
                    value={sp.alpha ?? '1'} onChange={e => updateSprite(sp.index, 'alpha', e.target.value)} />
                  <span>size:</span><span className="text-slate-300">{sp.right - sp.left}×{sp.bottom - sp.top}</span>
                </div>
                <button onClick={() => duplicateSprite(sp.index)}
                  className="w-full mt-1 flex items-center justify-center gap-1 px-2 py-1 rounded bg-blue-900/30 border border-blue-700/40 text-blue-400 hover:bg-blue-800/40 transition-colors text-[9px]">
                  <Copy className="w-3 h-3" /> Duplicate Sprite
                </button>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}