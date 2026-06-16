import React, { useState, useEffect } from 'react';
import { useDescrModelBattle } from './DescrModelBattleContext';
import { syncDescrModelBattleEntryAliases } from '@/lib/descrModelBattleCodec';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Save, ChevronDown, ChevronRight } from 'lucide-react';

const INP = 'w-full h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary';
const LBL = 'text-[10px] text-muted-foreground uppercase tracking-wider font-medium';

// ─── sub-components ──────────────────────────────────────────────────────────

function PathDistRow({ item, onChange, onRemove }) {
  return (
    <div className="flex items-center gap-1">
      <input
        value={item.path}
        onChange={e => onChange({ ...item, path: e.target.value })}
        placeholder="data/models_unit/…"
        className="flex-1 h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <input
        value={item.dist}
        onChange={e => onChange({ ...item, dist: e.target.value })}
        placeholder="max"
        className="w-16 h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <button onClick={onRemove} className="text-destructive hover:text-destructive/70">
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

function TextureRow({ item, onChange, onRemove }) {
  return (
    <div className="flex items-center gap-1">
      <input
        value={item.faction}
        onChange={e => onChange({ ...item, faction: e.target.value })}
        placeholder="faction / all"
        className="w-28 h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <input
        value={item.path}
        onChange={e => onChange({ ...item, path: e.target.value })}
        placeholder="data/models_unit/textures/…"
        className="flex-1 h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <button onClick={onRemove} className="text-destructive hover:text-destructive/70">
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

function PbrRow({ item, onChange, onRemove }) {
  return (
    <div className="flex items-center gap-1">
      <input value={item.faction}   onChange={e => onChange({ ...item, faction: e.target.value })}   placeholder="faction" className="w-20 h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
      <input value={item.normal}    onChange={e => onChange({ ...item, normal: e.target.value })}    placeholder="normal.tga"    className="flex-1 h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
      <input value={item.metalness} onChange={e => onChange({ ...item, metalness: e.target.value })} placeholder="metalness.tga" className="flex-1 h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
      <button onClick={onRemove} className="text-destructive hover:text-destructive/70"><Trash2 className="w-3 h-3" /></button>
    </div>
  );
}

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-foreground hover:bg-muted/40 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {title}
      </button>
      {open && <div className="px-2 pb-2 space-y-1.5">{children}</div>}
    </div>
  );
}

// ─── Main editor ─────────────────────────────────────────────────────────────

export default function DescrModelBattleEntryEditor() {
  const { dmbData, selectedType, updateDmbEntry } = useDescrModelBattle();

  const source = dmbData?.byType?.[selectedType?.toLowerCase()]
    ?? dmbData?.byName?.[selectedType?.toLowerCase()]
    ?? null;

  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (source) {
      setForm(JSON.parse(JSON.stringify(source)));
      setDirty(false);
    } else {
      setForm(null);
      setDirty(false);
    }
  }, [source]);

  if (!selectedType || !form) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-8 text-center">
        {dmbData ? 'Select an entry from the list to edit it' : 'Load descr_model_battle.txt first'}
      </div>
    );
  }

  const set = (key, val) => { setForm(f => ({ ...f, [key]: val })); setDirty(true); };
  const setList = (key, fn) => { setForm(f => ({ ...f, [key]: fn(f[key] ?? []) })); setDirty(true); };

  // Generic list helpers
  const addPathDist = (key) => setList(key, lst => [...lst, { path: '', dist: 'max' }]);
  const setPathDist = (key, idx, val) => setList(key, lst => lst.map((item, i) => i === idx ? val : item));
  const remPathDist = (key, idx) => setList(key, lst => lst.filter((_, i) => i !== idx));

  const handleSave = () => {
    updateDmbEntry(syncDescrModelBattleEntryAliases(form, 'descriptor'));
    setDirty(false);
  };

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="p-3 space-y-3 max-w-2xl">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold font-mono">{form.type}</div>
            <div className="text-[10px] text-muted-foreground">Battle model entry</div>
          </div>
          <Button
            size="sm" variant={dirty ? 'default' : 'outline'}
            className="h-7 px-3 gap-1 text-xs"
            onClick={handleSave}
          >
            <Save className="w-3 h-3" /> Save
          </Button>
        </div>

        {/* Basic */}
        <Section title="Basic">
          <div className="grid grid-cols-2 gap-2">
          <div>
            <div className={LBL}>Type name</div>
            <input value={form.type || form.name || ''} readOnly className={`${INP} opacity-60 cursor-not-allowed`} />
          </div>
            <div>
              <div className={LBL}>Scale</div>
              <input type="number" step="0.01" value={form.scale} onChange={e => set('scale', parseFloat(e.target.value) || 1.0)} className={INP} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className={LBL}>Skeleton</div>
              <input value={form.skeleton} onChange={e => set('skeleton', e.target.value)} placeholder="fs_swordsman" className={INP} />
            </div>
            <div>
              <div className={LBL}>Skeleton (horse)</div>
              <input value={form.skeleton_horse} onChange={e => set('skeleton_horse', e.target.value)} placeholder="hr_galop_fast_charge" className={INP} />
            </div>
          </div>
          <div>
            <div className={LBL}>Indiv range</div>
            <input type="number" value={form.indiv_range} onChange={e => set('indiv_range', parseInt(e.target.value, 10) || 40)} className="w-24 h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
        </Section>

        {/* Textures */}
        <Section title={`Textures (${(form.textures || []).length})`}>
          {(form.textures || []).map((t, i) => (
            <TextureRow key={i} item={t}
              onChange={val => { setForm(f => { const textures = f.textures.map((x, j) => j === i ? val : x); return { ...f, textures }; }); setDirty(true); }}
              onRemove={() => setList('textures', lst => lst.filter((_, j) => j !== i))}
            />
          ))}
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1"
            onClick={() => setList('textures', lst => [...lst, { faction: 'all', path: '' }])}>
            <Plus className="w-3 h-3" /> Add texture
          </Button>
        </Section>

        {/* PBR */}
        <Section title={`PBR textures (${(form.pbr || []).length})`} defaultOpen={false}>
          {(form.pbr || []).map((p, i) => (
            <PbrRow key={i} item={p}
              onChange={val => { setForm(f => { const pbr = f.pbr.map((x, j) => j === i ? val : x); return { ...f, pbr }; }); setDirty(true); }}
              onRemove={() => setList('pbr', lst => lst.filter((_, j) => j !== i))}
            />
          ))}
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1"
            onClick={() => setList('pbr', lst => [...lst, { faction: 'all', normal: '', metalness: '' }])}>
            <Plus className="w-3 h-3" /> Add PBR
          </Button>
        </Section>

        {/* LOD Models */}
        {[
          { key: 'model_flexi_m', label: 'model_flexi_m (high)' },
          { key: 'model_flexi_c', label: 'model_flexi_c (close)' },
          { key: 'model_flexi',   label: 'model_flexi (standard)' },
          { key: 'model_stat',    label: 'model_stat (static)' },
          { key: 'model_sprite',  label: 'model_sprite (sprite)' },
        ].map(({ key, label }) => (
          <Section key={key} title={`${label} (${(form[key] || []).length})`} defaultOpen={key === 'model_flexi'}>
            {(form[key] || []).map((m, i) => (
              <PathDistRow key={i} item={m}
                onChange={val => setPathDist(key, i, val)}
                onRemove={() => remPathDist(key, i)}
              />
            ))}
            <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1"
              onClick={() => addPathDist(key)}>
              <Plus className="w-3 h-3" /> Add
            </Button>
          </Section>
        ))}

        {/* model_tri */}
        <Section title="Model tri" defaultOpen={false}>
          <div>
            <div className={LBL}>model_tri value</div>
            <input value={form.model_tri} onChange={e => set('model_tri', e.target.value)} placeholder="400, 0.5f, 1.0f" className={INP} />
          </div>
        </Section>

        {/* Extra */}
        {(form._extra || []).length > 0 && (
          <Section title={`Extra lines (${form._extra.length})`} defaultOpen={false}>
            <textarea
              rows={Math.min(form._extra.length + 1, 8)}
              value={form._extra.join('\n')}
              onChange={e => { set('_extra', e.target.value.split('\n')); }}
              className="w-full text-[11px] font-mono bg-background border border-border rounded px-2 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Section>
        )}
      </div>
    </ScrollArea>
  );
}
