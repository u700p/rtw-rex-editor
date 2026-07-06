import React, { useState } from 'react';
import JSZip from 'jszip';
import { parseMeshFile, parseCasFile, meshesToMs3d, parseMs3d, encodeMeshFile, encodeCasFile } from '@/lib/casCodec';
import { parseMs3d as parseMs3dFull } from '@/lib/ms3dCodec';
import ModelViewer from './ModelViewer';
import { Button } from '@/components/ui/button';
import { Download, Box, AlertTriangle, X, Link2 } from 'lucide-react';
import { toCRLF } from '@/lib/lineEndings';

function downloadBuffer(buf, filename) {
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── sub-panel shared across both mesh types ────────────────────────────────────
function ModelSubPanel({ accept, label, hint, onToMs3d, onFromMs3d }) {
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState(0);

  const current = files[selected] || null;

  const loadFile = async (file) => {
    const buf = await file.arrayBuffer();
    const ext = file.name.split('.').pop().toLowerCase();
    let result;

    let ms3dFull = null;
    if (ext === 'ms3d') {
      result = parseMs3d(buf);
      result.sourceFormat = 'ms3d';
      // Also parse with full ms3d codec to get skeleton + group comments
      const full = parseMs3dFull(buf);
      if (full && !full.error) ms3dFull = full;
    } else if (ext === 'mesh') {
      result = parseMeshFile(buf);
      result.sourceFormat = 'mesh';
    } else if (ext === 'cas') {
      result = parseCasFile(buf);
      result.sourceFormat = 'cas';
    } else {
      return;
    }

    if (!result.meshes || result.meshes.length === 0) {
      const errMsg = result.errors?.join('\n') || 'Unknown parse error';
      alert(`Could not parse "${file.name}":\n\n${errMsg}`);
      return;
    }

    const totalVerts = result.meshes.reduce((s, m) => s + m.numVertices, 0);
    const totalFaces = result.meshes.reduce((s, m) => s + m.numFaces, 0);

    setFiles(prev => {
      const next = prev.filter(f => f.name !== file.name);
      return [...next, { name: file.name, parsed: result, sourceFormat: result.sourceFormat, totalVerts, totalFaces, rawBuffer: buf, ms3dFull }];
    });
    setSelected(0);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    for (const f of e.dataTransfer.files) await loadFile(f);
  };

  const handleInput = async (e) => {
    for (const f of e.target.files) await loadFile(f);
    e.target.value = '';
  };

  const exportMs3d = () => {
    if (!current) return;
    const buf = meshesToMs3d(current.parsed.meshes);
    downloadBuffer(buf, current.name.replace(/\.(cas|mesh)$/i, '.ms3d'));
  };

  const exportNative = () => {
    if (!current) return;
    if (onFromMs3d) {
      const buf = onFromMs3d(current.parsed.meshes);
      const outExt = accept.includes('cas') ? '.cas' : '.mesh';
      downloadBuffer(buf, current.name.replace(/\.ms3d$/i, outExt));
    }
  };

  const removeFile = (i) => {
    setFiles(prev => prev.filter((_, idx) => idx !== i));
    setSelected(prev => Math.max(0, prev - (i <= prev ? 1 : 0)));
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* When no model loaded: drop zone centered */}
      {!current && (
        <div className="flex flex-col items-center gap-3">
          <label
            className="w-full max-w-md cursor-pointer border-2 border-dashed border-slate-600 rounded-xl p-6 text-center hover:border-blue-500 transition-colors"
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
          >
            <input type="file" className="hidden" multiple accept={accept} onChange={handleInput} />
            <Box className="w-6 h-6 mx-auto mb-2 text-slate-400" />
            <p className="text-sm text-slate-300">{label}</p>
            <p className="text-[11px] text-slate-500 mt-1">{hint}</p>
          </label>
        </div>
      )}

      {/* When model loaded: 3D preview fills space, info panel on top */}
      {current && (
        <>
          {/* Compact top bar: drop new + file tabs + info + export */}
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <label
              className="shrink-0 cursor-pointer border border-dashed border-slate-600 rounded-lg px-3 py-1.5 text-center hover:border-blue-500 transition-colors"
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
            >
              <input type="file" className="hidden" multiple accept={accept} onChange={handleInput} />
              <span className="flex items-center gap-1.5 text-slate-400 text-[11px]"><Box className="w-3 h-3" /> Drop / Add</span>
            </label>

            {files.map((f, i) => (
              <div key={f.name} className={`flex items-center gap-1 px-2 py-1 rounded border transition-colors ${i === selected ? 'bg-blue-700 border-blue-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'}`}>
                <button onClick={() => setSelected(i)} className="truncate max-w-[120px]">{f.name}</button>
                <button onClick={() => removeFile(i)} className="opacity-50 hover:opacity-100 ml-0.5"><X className="w-3 h-3" /></button>
              </div>
            ))}

            <div className="h-4 w-px bg-slate-700 mx-1" />

            <span className="text-slate-500">{current.sourceFormat}</span>
            <span className="text-slate-500">{current.parsed.meshes.length}g</span>
            <span className="text-slate-500">{current.totalVerts.toLocaleString()}v</span>
            <span className="text-slate-500">{current.totalFaces.toLocaleString()}f</span>
            {current.ms3dFull?.joints?.length > 0 && (
              <span className="text-green-400">{current.ms3dFull.joints.length}j</span>
            )}

            <div className="h-4 w-px bg-slate-700 mx-1" />

            {(current.sourceFormat === 'cas' || current.sourceFormat === 'mesh') && (
              <Button size="sm" className="gap-1 bg-blue-600 hover:bg-blue-500 text-white h-6 text-[11px] px-2" onClick={exportMs3d}>
                <Download className="w-3 h-3" /> .ms3d
              </Button>
            )}
            {current.sourceFormat === 'ms3d' && onFromMs3d && (
              <Button size="sm" className="gap-1 bg-blue-600 hover:bg-blue-500 text-white h-6 text-[11px] px-2" onClick={exportNative}>
                <Download className="w-3 h-3" /> {accept.includes('cas') ? '.cas' : '.mesh'}
              </Button>
            )}
            <Button size="sm" variant="outline" className="gap-1 border-slate-600 text-slate-200 hover:bg-slate-700 h-6 text-[11px] px-2"
              onClick={() => downloadBuffer(current.rawBuffer, current.name)}>
              <Download className="w-3 h-3" /> Raw
            </Button>

            {current.parsed.errors?.length > 0 && (
              <span className="text-amber-400 flex items-center gap-1" title={current.parsed.errors.join('\n')}>
                <AlertTriangle className="w-3 h-3" /> {current.parsed.errors.length} warning{current.parsed.errors.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* 3D Viewer — fills remaining space */}
          <div className="flex-1 rounded-xl border border-slate-700 overflow-hidden bg-slate-900 min-h-0">
            <ModelViewer
              parsedMesh={current.parsed}
              skeletonData={current.ms3dFull || null}
              groupComments={current.ms3dFull?.groupComments || null}
              className="w-full h-full"
            />
          </div>
        </>
      )}
    </div>
  );
}

function sanitizeAttachName(value) {
  return String(value || 'rtw_model')
    .trim()
    .toLowerCase()
    .replace(/\.(cas|mesh)$/i, '')
    .replace(/[^a-z0-9_/-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'rtw_model';
}

function CasAnimationAttachPanel() {
  const [modelFile, setModelFile] = useState(null);
  const [animFiles, setAnimFiles] = useState([]);
  const [modelType, setModelType] = useState('new_unit_model');
  const [modelPath, setModelPath] = useState('data/models_unit/new_unit.cas');
  const [skeleton, setSkeleton] = useState('fs_spearman');
  const [texturePath, setTexturePath] = useState('data/models_unit/textures/new_unit.tga');
  const [status, setStatus] = useState('Load a model CAS and animation CAS files to build an attach kit.');

  const handleModel = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setModelFile(file);
    const clean = sanitizeAttachName(file.name);
    setModelType(clean);
    setModelPath(`data/models_unit/${clean}.cas`);
    setTexturePath(`data/models_unit/textures/${clean}.tga`);
    setStatus(`Model queued: ${file.name}`);
  };

  const handleAnimations = (e) => {
    const list = Array.from(e.target.files || []).filter(file => /\.cas$/i.test(file.name));
    e.target.value = '';
    setAnimFiles(list);
    setStatus(`${list.length} animation CAS file${list.length === 1 ? '' : 's'} queued.`);
  };

  const buildSnippet = () => {
    const animLines = animFiles.map(file => {
      const clean = sanitizeAttachName(file.name);
      return `; animation ${clean}\tdata/animations/${clean}.cas`;
    });
    return [
      '; Rome Tools CAS animation attach kit',
      '; Merge/check these paths in descr_model_battle.txt and your skeleton/animation routing files.',
      '',
      `type\t\t\t${modelType}`,
      `skeleton\t\t${skeleton}`,
      `model_flexi_m\t${modelPath}, 15`,
      `model_flexi\t\t${modelPath}, 40`,
      `texture\t\t\t${texturePath}`,
      '',
      ...animLines,
      '',
      '; Keep the CAS model and animations on the same compatible skeleton. Use Animation Editor to inspect/scale animation CAS files.',
    ].join('\n');
  };

  const exportKit = async () => {
    const zip = new JSZip();
    zip.file('animation_attach_snippet.txt', toCRLF(buildSnippet()));
    if (modelFile) zip.file(modelPath.replace(/^data\//, 'data/'), await modelFile.arrayBuffer());
    for (const file of animFiles) {
      const clean = sanitizeAttachName(file.name);
      zip.file(`data/animations/${clean}.cas`, await file.arrayBuffer());
    }
    downloadBuffer(await zip.generateAsync({ type: 'arraybuffer' }), `${sanitizeAttachName(modelType)}_animation_attach_kit.zip`);
    setStatus(`Exported attach kit for ${modelType}.`);
  };

  return (
    <div className="grid grid-cols-[320px_1fr] gap-3 min-h-[560px]">
      <div className="space-y-3">
        <label className="block cursor-pointer border border-dashed border-slate-600 rounded-xl p-4 hover:border-blue-500 transition-colors">
          <input type="file" accept=".cas" className="hidden" onChange={handleModel} />
          <span className="flex items-center gap-2 text-sm text-slate-300"><Box className="w-4 h-4 text-blue-400" />Load model CAS</span>
        </label>
        <label className="block cursor-pointer border border-dashed border-slate-600 rounded-xl p-4 hover:border-blue-500 transition-colors">
          <input type="file" accept=".cas" multiple className="hidden" onChange={handleAnimations} />
          <span className="flex items-center gap-2 text-sm text-slate-300"><Link2 className="w-4 h-4 text-blue-400" />Load animation CAS files</span>
        </label>
        {[
          ['modelType', 'DMB type', modelType, setModelType],
          ['skeleton', 'Skeleton', skeleton, setSkeleton],
          ['modelPath', 'Model path', modelPath, setModelPath],
          ['texturePath', 'Texture path', texturePath, setTexturePath],
        ].map(([key, label, value, setter]) => (
          <label key={key} className="block">
            <span className="text-[10px] uppercase text-slate-500">{label}</span>
            <input value={value} onChange={e => setter(e.target.value)} className="w-full h-8 mt-1 px-2 text-xs font-mono bg-slate-900 border border-slate-700 rounded text-slate-200" />
          </label>
        ))}
        <Button className="w-full gap-1.5" onClick={exportKit} disabled={!modelFile && !animFiles.length}>
          <Download className="w-3.5 h-3.5" />
          Export attach kit
        </Button>
        <p className="text-xs text-blue-300 whitespace-pre-wrap">{status}</p>
      </div>
      <div className="rounded-xl border border-slate-700 bg-slate-950 p-3 min-h-0">
        <pre className="h-full overflow-auto text-[11px] text-slate-300 whitespace-pre-wrap">{buildSnippet()}</pre>
      </div>
    </div>
  );
}

// ── exported panel with two sub-tabs ──────────────────────────────────────────
const MODEL_TABS = [
  {
    id: 'mesh',
    label: '.mesh — Unit Models',
    desc: 'data/unit_models/',
    accept: '.mesh,.ms3d',
    hint: 'Battle unit / character models · Drag to rotate, scroll to zoom',
    fromMs3d: (meshes) => encodeMeshFile(meshes),
  },
  {
    id: 'cas',
    label: '.cas — Strat Models',
    desc: 'data/world/maps/…',
    accept: '.cas,.ms3d',
    hint: 'Strat-map unit, city & resource models · Drag to rotate, scroll to zoom',
    fromMs3d: (meshes) => encodeCasFile(meshes),
  },
  {
    id: 'attach',
    label: 'CAS Animation Attach',
    desc: 'model + anim kit',
  },
];

export default function ModelPanel() {
  const [tab, setTab] = useState('mesh');
  const t = MODEL_TABS.find(x => x.id === tab);

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Sub-tabs */}
      <div className="flex gap-2">
        {MODEL_TABS.map(mt => (
          <button
            key={mt.id}
            onClick={() => setTab(mt.id)}
            className={`flex flex-col px-4 py-2 rounded-lg border text-left transition-all ${tab === mt.id ? 'bg-blue-900/40 border-blue-600 text-blue-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
          >
            <span className="text-xs font-semibold">{mt.label}</span>
            <span className="text-[10px] opacity-60">{mt.desc}</span>
          </button>
        ))}
      </div>

      {tab === 'attach' ? (
        <CasAnimationAttachPanel />
      ) : (
        <ModelSubPanel
          key={tab}
          accept={t.accept}
          label={`Drop ${t.accept.split(',').join(' / ')} files here`}
          hint={t.hint}
          onFromMs3d={t.fromMs3d}
        />
      )}
    </div>
  );
}
