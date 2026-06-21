import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, Download, FileText, Maximize2, Search, Box, ArrowLeftRight, X, Play, Pause } from 'lucide-react';
import { parseCasAnim, casAnimToText, encodeCasAnim, scaleCasAnim, textToCasAnim } from '@/lib/casAnimCodec';
import { parseMs3d } from '@/lib/ms3dCodec';
import CasFileInfo from '@/components/animation/CasFileInfo';
import BoneDataTable from '@/components/animation/BoneDataTable';
import ScalePanel from '@/components/animation/ScalePanel';
import SurveyPanel from '@/components/animation/SurveyPanel';
import SkeletonViewer from '@/components/animation/SkeletonViewer';
import { textBlob } from '@/lib/lineEndings';

function downloadBuffer(buf, filename) {
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function downloadText(text, filename) {
  const blob = textBlob(text);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const TABS = [
  { id: '3d',      label: '3D Preview',        icon: Box },
  { id: 'view',    label: 'View / Convert',    icon: ArrowLeftRight },
  { id: 'scale',   label: 'Scale',             icon: Maximize2 },
  { id: 'txt',     label: 'Text Edit',         icon: FileText },
  { id: 'survey',  label: 'Survey Directory',  icon: Search },
];

export default function AnimationEditor() {
  const [tab, setTab] = useState('3d');
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState(0);
  const [txtContent, setTxtContent] = useState('');
  const [ms3dData, setMs3dData] = useState(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef(null);

  useEffect(() => {
    if (playing) {
      playRef.current = setInterval(() => {
        setFrameIdx(prev => {
          const total = files[selected]?.parsed?.nFrames || ms3dData?.totalFrames || 1;
          return (prev + 1) % Math.max(total, 1);
        });
      }, 50);
    } else {
      clearInterval(playRef.current);
    }
    return () => clearInterval(playRef.current);
  }, [playing, files, selected, ms3dData]);

  const current = files[selected] || null;

  const loadFile = async (file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    const buf = await file.arrayBuffer();
    let parsed = null;
    let sourceText = null;

    if (ext === 'cas') {
      parsed = parseCasAnim(buf);
      if (!parsed.errors?.length) {
        sourceText = casAnimToText(parsed);
      }
    } else if (ext === 'txt') {
      sourceText = new TextDecoder().decode(buf);
      parsed = textToCasAnim(sourceText);
    } else if (ext === 'ms3d') {
      const ms3d = parseMs3d(buf);
      if (!ms3d.error) {
        setMs3dData(ms3d);
        setFrameIdx(0);
      }
      return;
    } else {
      return;
    }

    const entry = { name: file.name, ext, parsed, sourceText: sourceText || '', rawBuffer: buf };
    setFiles(prev => {
      const next = prev.filter(f => f.name !== file.name);
      return [...next, entry];
    });
    setSelected(0);
    if (sourceText) setTxtContent(sourceText);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    for (const f of e.dataTransfer.files) await loadFile(f);
  };

  const handleInput = async (e) => {
    for (const f of e.target.files) await loadFile(f);
    e.target.value = '';
  };

  const handleSelectFile = (i) => {
    setSelected(i);
    if (files[i]?.sourceText) setTxtContent(files[i].sourceText);
  };

  const exportTxt = () => {
    if (!current?.parsed) return;
    const txt = casAnimToText(current.parsed);
    downloadText(txt, current.name.replace(/\.cas$/i, '.txt'));
  };

  const exportCas = () => {
    if (!current?.parsed) return;
    const buf = encodeCasAnim(current.parsed);
    downloadBuffer(buf, current.name.replace(/\.txt$/i, '_modified.cas'));
  };

  const handleScale = (sx, sy, sz) => {
    if (!current?.parsed) return;
    const scaled = scaleCasAnim(current.parsed, sx, sy, sz);
    const newEntry = { ...current, parsed: scaled, name: current.name.replace(/\.cas$/i, '_scaled.cas') };
    setFiles(prev => {
      const next = [...prev];
      next[selected] = newEntry;
      return next;
    });
  };

  const applyTxtEdit = () => {
    if (!txtContent) return;
    const parsed = textToCasAnim(txtContent);
    const newEntry = { ...current, parsed, sourceText: txtContent };
    setFiles(prev => { const next = [...prev]; next[selected] = newEntry; return next; });
  };

  const removeFile = (i) => {
    setFiles(prev => prev.filter((_, idx) => idx !== i));
    setSelected(prev => Math.max(0, prev - (i <= prev ? 1 : 0)));
  };

  return (
    <div className="min-h-screen bg-background p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
          <ArrowLeftRight className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">Animation Utilities</h1>
          <p className="text-[11px] text-muted-foreground">Rome .cas animation viewer, scaler, and text converter</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${tab === t.id ? 'bg-blue-900/40 border-blue-600 text-blue-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
          >
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {/* Survey tab has no file requirement */}
      {tab === 'survey' && <SurveyPanel />}

      {tab !== 'survey' && (
        <>
          {/* Upload zone */}
          <label
            className="block cursor-pointer border-2 border-dashed border-slate-600 rounded-xl p-5 text-center hover:border-blue-500 transition-colors"
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
          >
            <input type="file" className="hidden" multiple accept=".cas,.txt,.ms3d" onChange={handleInput} />
            <Upload className="w-5 h-5 mx-auto mb-1.5 text-slate-400" />
            <p className="text-sm text-slate-300">Drop <code className="text-xs bg-slate-700 px-1 rounded">.cas</code>, <code className="text-xs bg-slate-700 px-1 rounded">.ms3d</code> or <code className="text-xs bg-slate-700 px-1 rounded">.txt</code> files</p>
            <p className="text-[10px] text-slate-500 mt-0.5">.cas = binary animation · .ms3d = MilkShape model+skeleton · .txt = text dump</p>
          </label>

          {/* File tabs */}
          {files.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {files.map((f, i) => (
                <div key={f.name} className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors ${i === selected ? 'bg-blue-700 border-blue-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'}`}>
                  <button onClick={() => handleSelectFile(i)} className="truncate max-w-[180px]">{f.name}</button>
                  <button onClick={() => removeFile(i)} className="opacity-50 hover:opacity-100 ml-0.5"><X className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}

          {/* 3D preview can show ms3d even without a cas file loaded */}
          {tab === '3d' && !current && ms3dData && (
            <div className="space-y-3">
              <SkeletonViewer ms3d={ms3dData} frameIdx={frameIdx} totalFrames={ms3dData.totalFrames || 1} />
              <div className="bg-slate-900 rounded-xl border border-slate-700 p-4 space-y-2">
                <div className="flex items-center gap-3">
                  <button onClick={() => setPlaying(v => !v)} className="w-8 h-8 rounded-lg bg-blue-700 hover:bg-blue-600 flex items-center justify-center shrink-0">
                    {playing ? <Pause className="w-3.5 h-3.5 text-white" /> : <Play className="w-3.5 h-3.5 text-white" />}
                  </button>
                  <input type="range" min={0} max={Math.max(ms3dData.totalFrames - 1, 0)} value={frameIdx}
                    onChange={e => { setPlaying(false); setFrameIdx(Number(e.target.value)); }} className="flex-1 accent-blue-500" />
                  <span className="text-[11px] text-slate-400 font-mono w-20 text-right">{frameIdx} / {ms3dData.totalFrames - 1}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                  <span className="w-2 h-2 rounded-full bg-orange-400 inline-block"></span>
                  MS3D: {ms3dData.joints.length} joints · {ms3dData.vertices.length} verts · {ms3dData.totalFrames} frames
                  <button onClick={() => setMs3dData(null)} className="ml-auto text-slate-600 hover:text-slate-400"><X className="w-3 h-3" /></button>
                </div>
              </div>
            </div>
          )}

          {current && (
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Left: info + actions */}
              <div className="w-full lg:w-64 shrink-0 space-y-3">
                <CasFileInfo parsed={current.parsed} />

                {/* Download actions */}
                <div className="bg-slate-900 rounded-xl border border-slate-700 p-4 space-y-2">
                  <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Export</p>
                  {current.ext === 'cas' && (
                    <Button size="sm" variant="outline" className="w-full gap-2 border-slate-600 text-slate-200 hover:bg-slate-700" onClick={exportTxt}>
                      <FileText className="w-3.5 h-3.5" /> Export as .txt
                    </Button>
                  )}
                  <Button size="sm" className="w-full gap-2 bg-blue-700 hover:bg-blue-600 text-white" onClick={exportCas}>
                    <Download className="w-3.5 h-3.5" /> Export as .cas
                  </Button>
                  <Button size="sm" variant="outline" className="w-full gap-2 border-slate-600 text-slate-200 hover:bg-slate-700"
                    onClick={() => downloadBuffer(current.rawBuffer, current.name)}>
                    <Download className="w-3.5 h-3.5" /> Download original
                  </Button>
                </div>

                {tab === 'scale' && <ScalePanel onScale={handleScale} />}
              </div>

              {/* Right: main content */}
              <div className="flex-1 min-w-0 space-y-3">
                {tab === '3d' && (
                  <div className="space-y-3">
                    <SkeletonViewer
                      casAnim={current?.parsed}
                      ms3d={ms3dData}
                      frameIdx={frameIdx}
                      totalFrames={current?.parsed?.nFrames || ms3dData?.totalFrames || 1}
                    />
                    {/* Playback scrubber */}
                    <div className="bg-slate-900 rounded-xl border border-slate-700 p-4 space-y-2">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setPlaying(v => !v)}
                          className="w-8 h-8 rounded-lg bg-blue-700 hover:bg-blue-600 flex items-center justify-center shrink-0"
                        >
                          {playing ? <Pause className="w-3.5 h-3.5 text-white" /> : <Play className="w-3.5 h-3.5 text-white" />}
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={Math.max((current?.parsed?.nFrames || ms3dData?.totalFrames || 1) - 1, 0)}
                          value={frameIdx}
                          onChange={e => { setPlaying(false); setFrameIdx(Number(e.target.value)); }}
                          className="flex-1 accent-blue-500"
                        />
                        <span className="text-[11px] text-slate-400 font-mono w-20 text-right">
                          {frameIdx} / {Math.max((current?.parsed?.nFrames || ms3dData?.totalFrames || 1) - 1, 0)}
                        </span>
                      </div>
                      {ms3dData && (
                        <div className="flex items-center gap-2 text-[10px] text-slate-500">
                          <span className="w-2 h-2 rounded-full bg-orange-400 inline-block"></span>
                          MS3D: {ms3dData.joints.length} joints · {ms3dData.vertices.length} verts · {ms3dData.totalFrames} frames
                          <button onClick={() => setMs3dData(null)} className="ml-auto text-slate-600 hover:text-slate-400"><X className="w-3 h-3" /></button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {(tab === 'view' || tab === 'scale') && (
                  <BoneDataTable parsed={current.parsed} />
                )}

                {tab === 'txt' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-slate-400">Edit the text representation, then apply back to binary.</p>
                      <Button size="sm" className="bg-green-700 hover:bg-green-600 text-white gap-1.5 text-[11px]" onClick={applyTxtEdit}>
                        Apply changes
                      </Button>
                    </div>
                    <textarea
                      value={txtContent}
                      onChange={e => setTxtContent(e.target.value)}
                      className="w-full h-[600px] bg-slate-900 border border-slate-700 rounded-xl p-3 text-[10px] font-mono text-slate-200 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                      spellCheck={false}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
