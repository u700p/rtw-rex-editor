import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Swords, Download, Info, Merge, Scissors, Zap, FileText, Layers, GitMerge } from 'lucide-react';
import { parseCasAnim, casAnimToText, textToCasAnim, encodeCasAnim, surveyCasHeader } from '@/lib/casAnimCodec';
import { parseMs3d } from '@/lib/ms3dCodec';
import { slerpAnimation, slerpTwoSegment, concatenateAnimations, extractSkeletonToText } from '@/lib/slerpUtils';
import { textBlob } from '@/lib/lineEndings';

// ── Helpers ──────────────────────────────────────────────────────────────────
function triggerDownload(buffer, filename) {
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function triggerTextDownload(text, filename) {
  const blob = textBlob(text);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function nameWithout(filename, ext) {
  return filename.replace(new RegExp(`\\.${ext}$`, 'i'), '');
}

function readFileAsBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.onerror = reject;
    r.readAsText(file);
  });
}

// ── Info tooltip ─────────────────────────────────────────────────────────────
function InfoBadge({ text }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        className="w-6 h-6 rounded text-xs font-bold bg-muted text-muted-foreground hover:bg-accent"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >i</button>
      {show && (
        <div className="absolute z-50 left-8 top-0 w-64 p-2 bg-popover border border-border rounded-md shadow-lg text-xs text-foreground">
          {text}
        </div>
      )}
    </div>
  );
}

// ── Tool card ─────────────────────────────────────────────────────────────────
function ToolCard({ title, icon: CardIcon, info, children }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CardIcon className="w-4 h-4 text-primary" />
          {title}
          <InfoBadge text={info} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

// ── Status line ───────────────────────────────────────────────────────────────
function Status({ msg, type = 'idle' }) {
  if (!msg) return null;
  const cls = type === 'ok' ? 'text-green-400' : type === 'err' ? 'text-destructive' : 'text-muted-foreground';
  return <p className={`text-xs ${cls} mt-1`}>{msg}</p>;
}

// ── SLERP Animation ───────────────────────────────────────────────────────────
function SlerpPanel() {
  const [status, setStatus] = useState({ msg: '', type: 'idle' });
  const [casFile, setCasFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [newFrames, setNewFrames] = useState('');

  async function loadCas(e) {
    const f = e.target.files[0];
    if (!f) return;
    const buf = await readFileAsBuffer(f);
    const p = parseCasAnim(buf);
    if (p.errors && p.errors.length > 0) {
      setStatus({ msg: p.errors[0], type: 'err' });
    } else {
      setCasFile(f); setParsed(p);
      setNewFrames(String(p.nFrames));
      setStatus({ msg: `Loaded: ${f.name} — ${p.nFrames} frames`, type: 'ok' });
    }
  }

  function run() {
    const n = parseInt(newFrames);
    if (!parsed || isNaN(n) || n < 2) { setStatus({ msg: 'Invalid parameters', type: 'err' }); return; }
    const out = slerpAnimation(parsed, n);
    const buf = encodeCasAnim(out);
    triggerDownload(buf, `${nameWithout(casFile.name, 'cas')}_SLERP_${parsed.nFrames}_${n}.cas`);
    setStatus({ msg: `Done — ${n} frames`, type: 'ok' });
  }

  return (
    <ToolCard title="SLERP Animation" icon={Zap}
      info="Resample a .cas animation to a different number of frames using SLERP for rotations and linear interpolation for positions. Fewer frames = faster, more = slower.">
      <div>
        <Label className="text-xs text-muted-foreground">CAS file</Label>
        <input type="file" accept=".cas" onChange={loadCas} className="block w-full text-xs text-foreground mt-1" />
      </div>
      {parsed && (
        <div>
          <Label className="text-xs text-muted-foreground">Current: {parsed.nFrames} → New frames</Label>
          <Input value={newFrames} onChange={e => setNewFrames(e.target.value)} type="number" min="2" className="mt-1 h-8 text-xs" />
        </div>
      )}
      <Button size="sm" onClick={run} disabled={!parsed}>
        <Download className="w-3 h-3 mr-1" /> SLERP & Download
      </Button>
      <Status {...status} />
    </ToolCard>
  );
}

// ── SLERP Two Segment ─────────────────────────────────────────────────────────
function SlerpTwoSegPanel() {
  const [status, setStatus] = useState({ msg: '', type: 'idle' });
  const [casFile, setCasFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [splitFrame, setSplitFrame] = useState('');
  const [n1, setN1] = useState('');
  const [n2, setN2] = useState('');

  async function loadCas(e) {
    const f = e.target.files[0];
    if (!f) return;
    const buf = await readFileAsBuffer(f);
    const p = parseCasAnim(buf);
    if (!p || p.errors?.length) { setStatus({ msg: p?.errors?.[0] || 'Parse error', type: 'err' }); return; }
    setCasFile(f); setParsed(p);
    const mid = Math.floor(p.nFrames / 2);
    setSplitFrame(String(mid)); setN1(String(mid)); setN2(String(p.nFrames - mid));
    setStatus({ msg: `Loaded: ${f.name} — ${p.nFrames} frames`, type: 'ok' });
  }

  function run() {
    const sf = parseInt(splitFrame), sn1 = parseInt(n1), sn2 = parseInt(n2);
    if (!parsed || isNaN(sf) || isNaN(sn1) || isNaN(sn2)) { setStatus({ msg: 'Invalid parameters', type: 'err' }); return; }
    const out = slerpTwoSegment(parsed, sf, sn1, sn2);
    const buf = encodeCasAnim(out);
    triggerDownload(buf, `${nameWithout(casFile.name, 'cas')}_SLERP_${parsed.nFrames}_${sn1}_${sn2}.cas`);
    setStatus({ msg: `Done — ${out.nFrames} frames total`, type: 'ok' });
  }

  return (
    <ToolCard title="SLERP Two Segment" icon={Scissors}
      info="Divide the animation at a frame number and independently SLERP each half to different frame counts.">
      <div>
        <Label className="text-xs text-muted-foreground">CAS file</Label>
        <input type="file" accept=".cas" onChange={loadCas} className="block w-full text-xs text-foreground mt-1" />
      </div>
      {parsed && (
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-xs text-muted-foreground">Split frame (1–{parsed.nFrames - 1})</Label>
            <Input value={splitFrame} onChange={e => setSplitFrame(e.target.value)} type="number" className="mt-1 h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Seg 1 frames</Label>
            <Input value={n1} onChange={e => setN1(e.target.value)} type="number" className="mt-1 h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Seg 2 frames</Label>
            <Input value={n2} onChange={e => setN2(e.target.value)} type="number" className="mt-1 h-8 text-xs" />
          </div>
        </div>
      )}
      <Button size="sm" onClick={run} disabled={!parsed}>
        <Download className="w-3 h-3 mr-1" /> SLERP Two Seg & Download
      </Button>
      <Status {...status} />
    </ToolCard>
  );
}

// ── CAS ↔ Text ────────────────────────────────────────────────────────────────
function CasTextPanel() {
  const [statusF, setStatusF] = useState({ msg: '', type: 'idle' });
  const [statusB, setStatusB] = useState({ msg: '', type: 'idle' });

  async function casToText(e) {
    const f = e.target.files[0]; if (!f) return;
    const buf = await readFileAsBuffer(f);
    const p = parseCasAnim(buf);
    if (!p || p.errors?.length) { setStatusF({ msg: p?.errors?.[0] || 'Parse error', type: 'err' }); return; }
    triggerTextDownload(casAnimToText(p), nameWithout(f.name, 'cas') + '.txt');
    setStatusF({ msg: `Exported ${f.name} → .txt`, type: 'ok' });
  }

  async function textToCas(e) {
    const f = e.target.files[0]; if (!f) return;
    const txt = await readFileAsText(f);
    const p = textToCasAnim(txt);
    const buf = encodeCasAnim(p);
    const name = nameWithout(f.name, 'txt') + '_modified.cas';
    triggerDownload(buf, name);
    setStatusB({ msg: `Saved: ${name}`, type: 'ok' });
  }

  return (
    <div className="space-y-3">
      <ToolCard title="CAS → Text" icon={FileText}
        info="Convert a binary .cas animation to human-readable text with quaternions and Euler angles in degrees.">
        <input type="file" accept=".cas" onChange={casToText} className="block w-full text-xs text-foreground" />
        <Status {...statusF} />
      </ToolCard>
      <ToolCard title="Text → CAS" icon={FileText}
        info="Convert a .txt animation text file back into binary .cas. Euler angles are read and converted to quaternions.">
        <input type="file" accept=".txt" onChange={textToCas} className="block w-full text-xs text-foreground" />
        <Status {...statusB} />
      </ToolCard>
    </div>
  );
}

// ── Concatenate Animations ────────────────────────────────────────────────────
function ConcatPanel() {
  const [status, setStatus] = useState({ msg: '', type: 'idle' });
  const [file1, setFile1] = useState(null);
  const [file2, setFile2] = useState(null);
  const [parsed1, setParsed1] = useState(null);
  const [parsed2, setParsed2] = useState(null);

  async function loadF(e, idx) {
    const f = e.target.files[0]; if (!f) return;
    const buf = await readFileAsBuffer(f);
    const p = parseCasAnim(buf);
    if (!p || p.errors?.length) { setStatus({ msg: p?.errors?.[0] || 'Parse error', type: 'err' }); return; }
    if (idx === 1) { setFile1(f); setParsed1(p); setStatus({ msg: `File 1: ${p.nFrames} frames`, type: 'ok' }); }
    else           { setFile2(f); setParsed2(p); setStatus({ msg: `File 2: ${p.nFrames} frames`, type: 'ok' }); }
  }

  function run() {
    if (!parsed1 || !parsed2) { setStatus({ msg: 'Load both files first', type: 'err' }); return; }
    const out = concatenateAnimations(parsed1, parsed2);
    const buf = encodeCasAnim(out);
    triggerDownload(buf, `${nameWithout(file1.name, 'cas')}_concat_${nameWithout(file2.name, 'cas')}.cas`);
    setStatus({ msg: `Done — ${out.nFrames} frames total`, type: 'ok' });
  }

  return (
    <ToolCard title="Concatenate Animations" icon={GitMerge}
      info="Join two .cas animation files end-to-end into a single file.">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">First .cas</Label>
          <input type="file" accept=".cas" onChange={e => loadF(e, 1)} className="block w-full text-xs text-foreground mt-1" />
          {parsed1 && <p className="text-xs text-muted-foreground">{parsed1.nFrames} frames</p>}
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Second .cas</Label>
          <input type="file" accept=".cas" onChange={e => loadF(e, 2)} className="block w-full text-xs text-foreground mt-1" />
          {parsed2 && <p className="text-xs text-muted-foreground">{parsed2.nFrames} frames</p>}
        </div>
      </div>
      <Button size="sm" onClick={run} disabled={!parsed1 || !parsed2}>
        <Download className="w-3 h-3 mr-1" /> Concatenate & Download
      </Button>
      <Status {...status} />
    </ToolCard>
  );
}

// ── Ms3d Merge (info only — encoder not yet implemented) ──────────────────────
function Ms3dMergePanel() {
  const [status, setStatus] = useState({ msg: '', type: 'idle' });
  const [primaryMs3d, setPrimaryMs3d] = useState(null);
  const [secondaryMs3d, setSecondaryMs3d] = useState(null);

  async function loadMs3d(e, isPrimary) {
    const f = e.target.files[0]; if (!f) return;
    const buf = await readFileAsBuffer(f);
    const p = parseMs3d(buf);
    if (p.error) { setStatus({ msg: p.error, type: 'err' }); return; }
    if (isPrimary) {
      if (!p.joints || p.joints.length === 0) {
        setStatus({ msg: 'Primary must have a skeleton!', type: 'err' }); return;
      }
      setPrimaryMs3d(p);
      setStatus({ msg: `Primary: ${p.joints.length} joints, ${p.groups.length} groups`, type: 'ok' });
    } else {
      setSecondaryMs3d(p);
      setStatus({ msg: `Secondary: ${p.groups.length} groups loaded`, type: 'ok' });
    }
  }

  function run() {
    if (!primaryMs3d || !secondaryMs3d) { setStatus({ msg: 'Load both files first', type: 'err' }); return; }
    setStatus({ msg: 'Ms3d binary encoder coming soon — use original GOAT for now.', type: 'err' });
  }

  return (
    <ToolCard title="Ms3d Merge" icon={Merge}
      info="Merge two .ms3d files — primary (with skeleton) + secondary (geometry only, e.g. weapon/shield). Binary encoder coming soon.">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Primary (has skeleton)</Label>
          <input type="file" accept=".ms3d" onChange={e => loadMs3d(e, true)} className="block w-full text-xs text-foreground mt-1" />
          {primaryMs3d && <p className="text-xs text-muted-foreground">{primaryMs3d.joints.length} joints</p>}
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Secondary (geometry only)</Label>
          <input type="file" accept=".ms3d" onChange={e => loadMs3d(e, false)} className="block w-full text-xs text-foreground mt-1" />
          {secondaryMs3d && <p className="text-xs text-muted-foreground">{secondaryMs3d.groups.length} groups</p>}
        </div>
      </div>
      <Button size="sm" onClick={run} disabled={!primaryMs3d || !secondaryMs3d}>
        <Download className="w-3 h-3 mr-1" /> Merge & Download
      </Button>
      <Status {...status} />
    </ToolCard>
  );
}

// ── Extract Skeleton ──────────────────────────────────────────────────────────
function ExtractSkeletonPanel() {
  const [status, setStatus] = useState({ msg: '', type: 'idle' });
  const [text, setText] = useState('');

  async function load(e) {
    const f = e.target.files[0]; if (!f) return;
    const buf = await readFileAsBuffer(f);
    const ms3d = parseMs3d(buf);
    if (ms3d.error) { setStatus({ msg: ms3d.error, type: 'err' }); return; }
    if (!ms3d.joints || ms3d.joints.length === 0) { setStatus({ msg: 'No skeleton found', type: 'err' }); return; }
    const txt = extractSkeletonToText(ms3d);
    setText(txt);
    const name = nameWithout(f.name, 'ms3d') + '_skeleton.skelexport';
    triggerTextDownload(txt, name);
    setStatus({ msg: `Extracted ${ms3d.joints.length} bones → ${name}`, type: 'ok' });
  }

  return (
    <ToolCard title="Extract Skeleton" icon={Layers}
      info="Extract the skeleton from a .ms3d file as a .skelexport text file (game coords, comma-delimited with hierarchy indices).">
      <input type="file" accept=".ms3d" onChange={load} className="block w-full text-xs text-foreground" />
      {text && (
        <ScrollArea className="h-32 w-full rounded border border-border p-2 bg-muted/30">
          <pre className="text-xs text-foreground font-mono whitespace-pre">{text}</pre>
        </ScrollArea>
      )}
      <Status {...status} />
    </ToolCard>
  );
}

// ── Survey CAS ────────────────────────────────────────────────────────────────
function SurveyPanel() {
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState({ msg: '', type: 'idle' });

  async function load(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setStatus({ msg: `Processing ${files.length} files…`, type: 'idle' });
    const rows = [];
    for (const f of files) {
      const buf = await readFileAsBuffer(f);
      const info = surveyCasHeader(buf, f.name);
      if (info) rows.push(info);
    }
    setResults(rows);
    setStatus({ msg: `Surveyed ${rows.length} / ${files.length} files`, type: 'ok' });
  }

  return (
    <ToolCard title="Survey CAS Directory" icon={FileText}
      info="Upload multiple .cas files to inspect their headers: version, animation time, bone count, body size.">
      <input type="file" accept=".cas" multiple onChange={load} className="block w-full text-xs text-foreground" />
      <Status {...status} />
      {results.length > 0 && (
        <ScrollArea className="h-48 w-full rounded border border-border">
          <table className="text-xs w-full">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                {['File', 'Ver', 'Time', 'Bones', 'BodySize'].map(h => (
                  <th key={h} className="px-2 py-1 text-left text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className="border-t border-border hover:bg-muted/20">
                  <td className="px-2 py-1 font-mono truncate max-w-xs">{r.filename}</td>
                  <td className="px-2 py-1">{r.version}</td>
                  <td className="px-2 py-1">{r.animTime}s</td>
                  <td className="px-2 py-1">{r.nBones}</td>
                  <td className="px-2 py-1">{r.bodySize}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      )}
    </ToolCard>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function GoatTools() {
  return (
    <div className="min-h-screen bg-background p-4 lg:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
            <Swords className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">GOAT Tools</h1>
            <p className="text-xs text-muted-foreground">Game Object Application Toolbox — M2TW animation & mesh utilities</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {['SLERP', 'CAS↔Text', 'Concatenate', 'Extract Skeleton', 'Survey'].map(t => (
                <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
              ))}
            </div>
          </div>
        </div>

        <Tabs defaultValue="animation" className="space-y-4">
          <TabsList className="grid grid-cols-3 w-full max-w-md">
            <TabsTrigger value="animation" className="text-xs">Animation</TabsTrigger>
            <TabsTrigger value="mesh" className="text-xs">Mesh / Skeleton</TabsTrigger>
            <TabsTrigger value="survey" className="text-xs">Survey</TabsTrigger>
          </TabsList>

          <TabsContent value="animation" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <SlerpPanel />
              <SlerpTwoSegPanel />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <CasTextPanel />
              <ConcatPanel />
            </div>
          </TabsContent>

          <TabsContent value="mesh" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Ms3dMergePanel />
              <ExtractSkeletonPanel />
            </div>
            <Card className="bg-muted/30 border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                  <Info className="w-4 h-4" /> Not yet available in-browser
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  These functions require the original Python GOAT app:{' '}
                  <strong className="text-foreground">Mesh ↔ Ms3d</strong>,{' '}
                  <strong className="text-foreground">Banner Mesh ↔ Ms3d</strong>,{' '}
                  <strong className="text-foreground">Strat CAS ↔ Ms3d</strong>,{' '}
                  <strong className="text-foreground">Animmerge / Animextract</strong>,{' '}
                  <strong className="text-foreground">Import RTW anim</strong>,{' '}
                  <strong className="text-foreground">Export Skeleton</strong>,{' '}
                  <strong className="text-foreground">Planarize Seam Normals</strong>,{' '}
                  <strong className="text-foreground">Write UV Maps to DDS</strong>.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="survey">
            <SurveyPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
