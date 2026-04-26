import React, { useState, useEffect } from 'react';
import { useSmFactions } from './SmFactionsContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Save, ChevronDown, ChevronRight } from 'lucide-react';
import {
  SM_CULTURES, SM_RELIGIONS, SM_AI_LABELS, SM_ECONOMIC_AI, SM_MILITARY_AI,
} from '@/lib/descrSmFactionsCodec';

const INP = 'w-full h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary';
const SEL = 'w-full h-6 px-1 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary';
const LBL = 'text-[10px] text-muted-foreground uppercase tracking-wider font-medium';

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
      {open && <div className="px-2 pb-2 space-y-2">{children}</div>}
    </div>
  );
}

function ColourEditor({ label, colour, onChange }) {
  const { r, g, b } = colour || { r: 0, g: 0, b: 0 };
  const setC = (ch, v) => onChange({ ...colour, [ch]: Math.max(0, Math.min(255, parseInt(v, 10) || 0)) });
  return (
    <div className="space-y-1">
      <div className={LBL}>{label}</div>
      <div className="flex items-center gap-2">
        <div
          className="w-7 h-7 rounded border border-border shrink-0"
          style={{ background: `rgb(${r},${g},${b})` }}
        />
        <input
          type="color"
          value={`#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`}
          onChange={e => {
            const hex = e.target.value.slice(1);
            onChange({
              r: parseInt(hex.slice(0,2),16),
              g: parseInt(hex.slice(2,4),16),
              b: parseInt(hex.slice(4,6),16),
            });
          }}
          className="w-8 h-7 rounded border border-border cursor-pointer bg-transparent"
        />
        {['r','g','b'].map(ch => (
          <div key={ch} className="flex flex-col items-center gap-0.5">
            <span className="text-[9px] text-muted-foreground uppercase">{ch}</span>
            <input
              type="number" min={0} max={255}
              value={colour?.[ch] ?? 0}
              onChange={e => setC(ch, e.target.value)}
              className="w-14 h-6 px-1 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function BoolRow({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-[11px] text-foreground">
      <input
        type="checkbox"
        checked={!!value}
        onChange={e => onChange(e.target.checked)}
        className="w-3.5 h-3.5 accent-primary"
      />
      {label}
    </label>
  );
}

// ─── Main editor ─────────────────────────────────────────────────────────────

export default function SmFactionEditor() {
  const { factions, selected, updateFaction } = useSmFactions();

  const source = factions.find(f => f.name === selected) ?? null;

  const [form,  setForm]  = useState(null);
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

  if (!selected || !form) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-8 text-center">
        Select a faction from the list, or create a new one
      </div>
    );
  }

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setDirty(true); };
  const setCai = (k, v) => { setForm(f => ({ ...f, _cai: { ...f._cai, [k]: v } })); setDirty(true); };

  const handleSave = () => {
    updateFaction(form);
    setDirty(false);
  };

  const CAI_KEYS = Object.keys(form._cai || {});

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="p-3 space-y-3 max-w-2xl">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-5 h-5 rounded border border-border"
              style={{ background: `rgb(${form.primary_colour?.r??0},${form.primary_colour?.g??0},${form.primary_colour?.b??0})` }}
            />
            <div>
              <div className="text-sm font-bold font-mono">{form.name}</div>
              <div className="text-[10px] text-muted-foreground">{form.culture} · {form.religion}</div>
            </div>
          </div>
          <Button
            size="sm" variant={dirty ? 'default' : 'outline'}
            className="h-7 px-3 gap-1 text-xs"
            onClick={handleSave}
          >
            <Save className="w-3 h-3" /> Save
          </Button>
        </div>

        {/* Identity */}
        <Section title="Identity">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className={LBL}>Faction name (key)</div>
              <input value={form.name} readOnly className={`${INP} opacity-60 cursor-not-allowed`} />
            </div>
            <div>
              <div className={LBL}>Culture</div>
              <select value={form.culture} onChange={e => set('culture', e.target.value)} className={SEL}>
                {SM_CULTURES.map(c => <option key={c} value={c}>{c}</option>)}
                {!SM_CULTURES.includes(form.culture) && form.culture && (
                  <option value={form.culture}>{form.culture}</option>
                )}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className={LBL}>Religion</div>
              <select value={form.religion} onChange={e => set('religion', e.target.value)} className={SEL}>
                {SM_RELIGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                {!SM_RELIGIONS.includes(form.religion) && form.religion && (
                  <option value={form.religion}>{form.religion}</option>
                )}
              </select>
            </div>
            <div>
              <div className={LBL}>Triumph value</div>
              <input type="number" value={form.triumph_value} onChange={e => set('triumph_value', parseInt(e.target.value,10)||5)} className={INP} />
            </div>
          </div>
          <div>
            <div className={LBL}>Symbol (.cas)</div>
            <input value={form.symbol} onChange={e => set('symbol', e.target.value)} placeholder="models_strat/symbol_…" className={INP} />
          </div>
          <div>
            <div className={LBL}>Rebel symbol (.cas)</div>
            <input value={form.rebel_symbol} onChange={e => set('rebel_symbol', e.target.value)} placeholder="models_strat/rebel_symbol_…" className={INP} />
          </div>
          <div>
            <div className={LBL}>Loading logo (.tga)</div>
            <input value={form.loading_logo} onChange={e => set('loading_logo', e.target.value)} placeholder="interface/loading_flags/loading_….tga" className={INP} />
          </div>
        </Section>

        {/* Colours */}
        <Section title="Colours">
          <ColourEditor label="Primary colour" colour={form.primary_colour} onChange={v => set('primary_colour', v)} />
          <ColourEditor label="Secondary colour" colour={form.secondary_colour} onChange={v => set('secondary_colour', v)} />
        </Section>

        {/* Indexes */}
        <Section title="Strat map indexes" defaultOpen={false}>
          {[
            ['standard_index',   'Standard index'],
            ['logo_index',       'Logo index'],
            ['small_logo_index', 'Small logo index'],
          ].map(([k, lbl]) => (
            <div key={k} className="grid grid-cols-2 gap-2 items-end">
              <div className={LBL}>{lbl}</div>
              <input type="number" min={0} value={form[k] ?? 0}
                onChange={e => set(k, parseInt(e.target.value,10)||0)}
                className="w-20 h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          ))}
        </Section>

        {/* AI */}
        <Section title="AI settings">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className={LBL}>AI label</div>
              <select value={form.ai_label} onChange={e => set('ai_label', e.target.value)} className={SEL}>
                <option value="">— none —</option>
                {SM_AI_LABELS.map(v => <option key={v} value={v}>{v}</option>)}
                {form.ai_label && !SM_AI_LABELS.includes(form.ai_label) && <option value={form.ai_label}>{form.ai_label}</option>}
              </select>
            </div>
            <div>
              <div className={LBL}>Economic AI</div>
              <select value={form.economic_ai} onChange={e => set('economic_ai', e.target.value)} className={SEL}>
                {SM_ECONOMIC_AI.map(v => <option key={v} value={v}>{v}</option>)}
                {form.economic_ai && !SM_ECONOMIC_AI.includes(form.economic_ai) && <option value={form.economic_ai}>{form.economic_ai}</option>}
              </select>
            </div>
          </div>
          <div>
            <div className={LBL}>Military AI</div>
            <select value={form.military_ai} onChange={e => set('military_ai', e.target.value)} className={SEL}>
              {SM_MILITARY_AI.map(v => <option key={v} value={v}>{v}</option>)}
              {form.military_ai && !SM_MILITARY_AI.includes(form.military_ai) && <option value={form.military_ai}>{form.military_ai}</option>}
            </select>
          </div>
        </Section>

        {/* Flags */}
        <Section title="Flags">
          <div className="grid grid-cols-2 gap-1.5">
            {[
              ['custom_battle_availability', 'Custom battle available'],
              ['can_sap',                    'Can sap'],
              ['prefer_naval_invasions',     'Prefer naval invasions'],
              ['has_princess',               'Has princess'],
              ['can_have_princess',          'Can have princess'],
            ].map(([k, lbl]) => (
              <BoolRow key={k} label={lbl} value={form[k]} onChange={v => set(k, v)} />
            ))}
          </div>
        </Section>

        {/* CAI modifiers */}
        <Section title={`CAI modifiers (${CAI_KEYS.length})`} defaultOpen={false}>
          <div className="space-y-1">
            {CAI_KEYS.map(k => (
              <div key={k} className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-muted-foreground w-64 shrink-0">{k}</span>
                <input
                  value={form._cai[k] ?? ''}
                  onChange={e => setCai(k, e.target.value)}
                  className="flex-1 h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            ))}
          </div>
        </Section>

        {/* Extra */}
        {form._extra?.length > 0 && (
          <Section title={`Extra lines (${form._extra.length})`} defaultOpen={false}>
            <textarea
              rows={Math.min(form._extra.length + 1, 8)}
              value={form._extra.join('\n')}
              onChange={e => set('_extra', e.target.value.split('\n'))}
              className="w-full text-[11px] font-mono bg-background border border-border rounded px-2 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Section>
        )}
      </div>
    </ScrollArea>
  );
}
