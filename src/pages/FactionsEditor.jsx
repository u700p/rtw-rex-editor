import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Download, Plus, Trash2, AlertTriangle, Shield, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

const VANILLA_FACTION_LIMIT = 31;
const LS_KEY    = 'm2tw_sm_factions_raw';
const LS_CULT   = 'm2tw_cultures_list';
const LS_REL    = 'm2tw_religions_list';
const LS_UNITS  = 'm2tw_edu_units_list';

// ── Colour helpers ────────────────────────────────────────────────────────────
const rgbToHex = ({ r, g, b }) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
const hexToRgb = (hex) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 };
};
const parseColour = (v) => {
  const m = v.match(/red\s+(\d+)[,\s]+green\s+(\d+)[,\s]+blue\s+(\d+)/i);
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : { r: 0, g: 0, b: 0 };
};

// ── Reference file parsers ────────────────────────────────────────────────────
function parseCultures(text) {
  const cultures = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    const m = line.match(/^culture\s+(\S+)/i);
    if (m) cultures.push(m[1]);
  }
  return cultures;
}

function parseReligions(text) {
  const religions = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    const m = line.match(/^religion\s+(\S+)/i);
    if (m) religions.push(m[1]);
  }
  return religions;
}

function parseEduUnits(text) {
  const units = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    const m = line.match(/^type\s+(.+)/i);
    if (m) units.push(m[1].trim());
  }
  return units;
}

// ── Main faction parser ───────────────────────────────────────────────────────
function parseDescrSmFactions(text) {
  const factions = [];
  const lines = text.split('\n');
  let current = null;

  for (const rawLine of lines) {
    // Strip inline comments but preserve line for keyword extraction
    const line = rawLine.replace(/;.*$/, '').trim();
    if (!line) continue;

    // Match "faction <name>" — may have tabs between keyword and name
    const factionMatch = line.match(/^faction\s+(\S+)/i);
    if (factionMatch) {
      if (current) factions.push(current);
      current = {
        name: factionMatch[1],
        culture: '',
        religion: '',
        symbol: '',
        rebel_symbol: '',
        primary_colour: { r: 0, g: 0, b: 0 },
        secondary_colour: { r: 0, g: 0, b: 0 },
        loading_logo: '',
        standard_index: '',
        logo_index: '',
        small_logo_index: '',
        triumph_value: '5',
        custom_battle_availability: 'yes',
        can_sap: 'no',
        prefers_naval_invasions: 'no',
        can_have_princess: 'yes',
        has_family_tree: 'yes',
        can_horde: false,
        horde_min_units: 0,
        horde_max_units: 0,
        horde_max_units_reduction_every_horde: 0,
        horde_unit_per_settlement_population: 0,
        horde_min_named_characters: 0,
        horde_max_percent_army_stack: 0,
        horde_disband_percent_on_settlement_capture: 0,
        horde_units: [],
        extras: [],
      };
      continue;
    }

    if (!current) continue;

    // Split on first whitespace cluster
    const m = line.match(/^(\S+)\s*(.*)/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim();

    switch (key) {
      case 'culture':                                        current.culture = val; break;
      case 'religion':                                       current.religion = val; break;
      case 'symbol':                                         current.symbol = val; break;
      case 'rebel_symbol':                                   current.rebel_symbol = val; break;
      case 'primary_colour':
      case 'primary_color':                                  current.primary_colour = parseColour(val); break;
      case 'secondary_colour':
      case 'secondary_color':                                current.secondary_colour = parseColour(val); break;
      case 'loading_logo':                                   current.loading_logo = val; break;
      case 'standard_index':                                 current.standard_index = val; break;
      case 'logo_index':                                     current.logo_index = val; break;
      case 'small_logo_index':                               current.small_logo_index = val; break;
      case 'triumph_value':                                  current.triumph_value = val; break;
      case 'custom_battle_availability':                     current.custom_battle_availability = val; break;
      case 'can_sap':                                        current.can_sap = val; break;
      case 'prefers_naval_invasions':                        current.prefers_naval_invasions = val; break;
      case 'can_have_princess':                              current.can_have_princess = val; break;
      case 'has_family_tree':                                current.has_family_tree = val; break;
      case 'horde_min_units':                                current.can_horde = true; current.horde_min_units = +val || 0; break;
      case 'horde_max_units':                                current.horde_max_units = +val || 0; break;
      case 'horde_max_units_reduction_every_horde':          current.horde_max_units_reduction_every_horde = +val || 0; break;
      case 'horde_unit_per_settlement_population':           current.horde_unit_per_settlement_population = +val || 0; break;
      case 'horde_min_named_characters':                     current.horde_min_named_characters = +val || 0; break;
      case 'horde_max_percent_army_stack':                   current.horde_max_percent_army_stack = +val || 0; break;
      case 'horde_disband_percent_on_settlement_capture':    current.horde_disband_percent_on_settlement_capture = +val || 0; break;
      case 'horde_unit':                                     current.horde_units.push(val); break;
      default:
        current.extras.push(line);
        break;
    }
  }
  if (current) factions.push(current);
  return factions;
}

// ── Serialiser ────────────────────────────────────────────────────────────────
function serialiseDescrSmFactions(factions) {
  const HEADER = `;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; faction description
;;  logo_index          gets resolved from STRATEGY_SPRITE_PAGE
;;  small_logo_index    gets resolved from SHARED_SPRITE_PAGE
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

`;
  const SEP = '\n;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;\n\n';
  const T = '\t\t\t\t\t\t';
  const T5 = '\t\t\t\t\t';
  const T4 = '\t\t\t\t';
  const T3 = '\t\t\t';
  const fmtC = (c) => `red ${c.r}, green ${c.g}, blue ${c.b}`;

  const lines = (f) => {
    const rows = [
      `faction${T}${f.name}`,
      `culture${T}${f.culture}`,
      `religion${T5}${f.religion}`,
      f.symbol          ? `symbol${T}${f.symbol}` : null,
      f.rebel_symbol    ? `rebel_symbol${T4}${f.rebel_symbol}` : null,
      `primary_colour${T4}${fmtC(f.primary_colour)}`,
      `secondary_colour${T3}${fmtC(f.secondary_colour)}`,
      f.loading_logo    ? `loading_logo${T4}${f.loading_logo}` : null,
      f.standard_index !== '' ? `standard_index${T4}${f.standard_index}` : null,
      f.logo_index      ? `logo_index${T5}${f.logo_index}` : null,
      f.small_logo_index? `small_logo_index${T3}${f.small_logo_index}` : null,
      f.triumph_value   ? `triumph_value${T4}${f.triumph_value}` : null,
      `custom_battle_availability\t${f.custom_battle_availability}`,
      ...(f.can_horde ? [
        `horde_min_units${T3}${f.horde_min_units}`,
        `horde_max_units${T3}${f.horde_max_units}`,
        `horde_max_units_reduction_every_horde\t${f.horde_max_units_reduction_every_horde}`,
        `horde_unit_per_settlement_population\t${f.horde_unit_per_settlement_population}`,
        `horde_min_named_characters${T3}${f.horde_min_named_characters}`,
        `horde_max_percent_army_stack${T}${f.horde_max_percent_army_stack}`,
        `horde_disband_percent_on_settlement_capture\t${f.horde_disband_percent_on_settlement_capture}`,
        ...(f.horde_units || []).map(u => `horde_unit${T4}${u}`),
      ] : []),
      `can_sap${T}${f.can_sap}`,
      `prefers_naval_invasions\t\t${f.prefers_naval_invasions}`,
      `can_have_princess${T3}${f.can_have_princess}`,
      `has_family_tree${T4}${f.has_family_tree}`,
      ...(f.extras || []),
    ].filter(r => r !== null);
    return rows.join('\n');
  };

  return HEADER + factions.map(lines).join(SEP) + '\n';
}

// ── Colour Picker with modal ──────────────────────────────────────────────────
function ColourPickerField({ label, colour, onChange }) {
  const c = colour || { r: 0, g: 0, b: 0 };
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(c);
  const hex = rgbToHex(c);

  const openPicker = () => { setDraft(c); setOpen(true); };
  const confirm = () => { onChange(draft); setOpen(false); };

  return (
    <>
      <div className="flex items-center gap-2 py-0.5">
        <span className="text-[10px] text-slate-400 w-40 shrink-0">{label}</span>
        <button onClick={openPicker} className="flex items-center gap-2 group">
          <div className="w-7 h-5 rounded border border-slate-600 shrink-0 group-hover:ring-2 group-hover:ring-blue-500 transition-all"
            style={{ background: hex }} />
          <span className="text-[10px] font-mono text-slate-400 group-hover:text-slate-200">{hex.toUpperCase()} &nbsp; rgb({c.r},{c.g},{c.b})</span>
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setOpen(false)}>
          <div className="bg-slate-900 border border-slate-600 rounded-xl shadow-2xl p-5 w-72" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-200">{label}</span>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            {/* Big preview */}
            <div className="w-full h-16 rounded-lg border border-slate-700 mb-4" style={{ background: rgbToHex(draft) }} />
            {/* Native colour input */}
            <div className="flex items-center gap-3 mb-3">
              <input type="color" value={rgbToHex(draft)}
                onChange={e => setDraft(hexToRgb(e.target.value))}
                className="w-12 h-8 rounded cursor-pointer bg-transparent border-0" />
              <span className="text-[10px] font-mono text-slate-400">{rgbToHex(draft).toUpperCase()}</span>
            </div>
            {/* RGB sliders */}
            {[['r', 'R', '#ef4444'], ['g', 'G', '#22c55e'], ['b', 'B', '#3b82f6']].map(([ch, lbl, col]) => (
              <div key={ch} className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-bold w-4 shrink-0" style={{ color: col }}>{lbl}</span>
                <input type="range" min={0} max={255} value={draft[ch]}
                  onChange={e => setDraft(d => ({ ...d, [ch]: +e.target.value }))}
                  className="flex-1 h-2 accent-current cursor-pointer" style={{ accentColor: col }} />
                <input type="number" min={0} max={255} value={draft[ch]}
                  onChange={e => setDraft(d => ({ ...d, [ch]: Math.max(0, Math.min(255, +e.target.value || 0)) }))}
                  className="w-12 bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-center text-slate-200" />
              </div>
            ))}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setOpen(false)} className="flex-1 py-1.5 text-[11px] rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400">Cancel</button>
              <button onClick={confirm} className="flex-1 py-1.5 text-[11px] rounded bg-blue-700 hover:bg-blue-600 text-white font-semibold">OK</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Yes/No toggle ─────────────────────────────────────────────────────────────
function YesNo({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[10px] text-slate-400">{label}</span>
      <div className="flex rounded overflow-hidden border border-slate-700">
        {['yes', 'no'].map(opt => (
          <button key={opt} onClick={() => onChange(opt)}
            className={`px-2 py-0.5 text-[10px] transition-colors ${value === opt ? 'bg-primary text-primary-foreground' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Dropdown or text input ────────────────────────────────────────────────────
function SelectOrInput({ label, value, onChange, options, placeholder }) {
  return (
    <div className="flex items-center gap-3 py-0.5">
      <label className="text-[10px] text-slate-400 w-40 shrink-0">{label}</label>
      {options && options.length > 0 ? (
        <select value={value} onChange={e => onChange(e.target.value)}
          className="flex-1 h-6 text-[11px] px-2 rounded border border-input bg-background text-foreground font-mono">
          {!options.includes(value) && value && <option value={value}>{value} (custom)</option>}
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <Input className="h-6 text-[11px] px-2 flex-1 font-mono" value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      )}
    </div>
  );
}

// ── Horde Units list editor ───────────────────────────────────────────────────
function HordeUnitsEditor({ units, onChange, eduUnits }) {
  const [custom, setCustom] = useState('');
  const add = (u) => { if (u && !units.includes(u)) onChange([...units, u]); setCustom(''); };
  const remove = (i) => onChange(units.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1 min-h-6">
        {units.map((u, i) => (
          <span key={i} className="inline-flex items-center gap-1 bg-amber-900/40 border border-amber-700 rounded px-1.5 py-0.5 text-[9px] font-mono text-amber-300">
            {u}
            <button onClick={() => remove(i)} className="text-red-400 hover:text-red-300 leading-none ml-0.5">×</button>
          </span>
        ))}
        {units.length === 0 && <span className="text-[10px] text-red-400 italic">At least 1 unit required</span>}
      </div>
      <div className="flex gap-1">
        {eduUnits && eduUnits.length > 0 ? (
          <select className="flex-1 h-6 text-[10px] px-1 rounded border border-input bg-background text-foreground font-mono"
            value="" onChange={e => add(e.target.value)}>
            <option value="">— add unit from EDU —</option>
            {eduUnits.filter(u => !units.includes(u)).map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        ) : (
          <>
            <Input className="flex-1 h-6 text-[10px] px-1 font-mono" value={custom} onChange={e => setCustom(e.target.value)}
              placeholder="unit type name…" onKeyDown={e => e.key === 'Enter' && add(custom.trim())} />
            <button onClick={() => add(custom.trim())}
              className="text-[10px] px-2 rounded border border-green-800 text-green-400 hover:bg-green-900/30">Add</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Faction detail panel ──────────────────────────────────────────────────────
function FactionDetail({ faction, onChange, cultures, religions, eduUnits }) {
  const set = (key, val) => onChange({ ...faction, [key]: val });

  // Auto-derive default logo indices from faction name
  const nameUpper = (faction.name || '').toUpperCase();
  const defaultLogo = `FACTION_LOGO_${nameUpper}`;
  const defaultSmallLogo = `SMALL_FACTION_LOGO_${nameUpper}`;

  const hordeIntField = (key, label) => (
    <div key={key} className="flex items-center gap-3">
      <label className="text-[10px] text-slate-400 w-60 shrink-0">{label}</label>
      <input type="number" min={0}
        value={faction[key] ?? 0}
        onChange={e => set(key, +e.target.value || 0)}
        className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-[11px] text-slate-200" />
    </div>
  );

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-5 max-w-xl">

        {/* Identity */}
        <section className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-700 pb-1">Identity</h3>
          <div className="flex items-center gap-3">
            <label className="text-[10px] text-slate-400 w-40 shrink-0">Internal Name</label>
            <Input className="h-6 text-[11px] px-2 flex-1 font-mono" value={faction.name ?? ''} onChange={e => set('name', e.target.value)} />
          </div>
          <SelectOrInput label="Culture" value={faction.culture} onChange={v => set('culture', v)} options={cultures} placeholder="e.g. northern_european" />
          <SelectOrInput label="Religion" value={faction.religion} onChange={v => set('religion', v)} options={religions} placeholder="e.g. catholic" />
        </section>

        {/* Colours */}
        <section className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-700 pb-1">Colours</h3>
          <ColourPickerField label="Primary Colour" colour={faction.primary_colour} onChange={v => set('primary_colour', v)} />
          <ColourPickerField label="Secondary Colour" colour={faction.secondary_colour} onChange={v => set('secondary_colour', v)} />
        </section>

        {/* Files & Indices */}
        <section className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-700 pb-1">Files & Indices</h3>
          {[
            ['symbol', 'Symbol (.CAS)'],
            ['rebel_symbol', 'Rebel Symbol (.CAS)'],
            ['loading_logo', 'Loading Logo (.tga)'],
            ['standard_index', 'Standard Index'],
            ['triumph_value', 'Triumph Value'],
          ].map(([k, l]) => (
            <div key={k} className="flex items-center gap-3">
              <label className="text-[10px] text-slate-400 w-40 shrink-0">{l}</label>
              <Input className="h-6 text-[11px] px-2 flex-1 font-mono" value={faction[k] ?? ''} onChange={e => set(k, e.target.value)} />
            </div>
          ))}
          {/* Logo indices with auto-default hint */}
          {[
            ['logo_index', 'Logo Index', defaultLogo],
            ['small_logo_index', 'Small Logo Index', defaultSmallLogo],
          ].map(([k, l, def]) => (
            <div key={k} className="flex items-center gap-3">
              <label className="text-[10px] text-slate-400 w-40 shrink-0">{l}</label>
              <div className="flex-1 relative">
                <Input className="h-6 text-[11px] px-2 w-full font-mono pr-14" value={faction[k] ?? ''} onChange={e => set(k, e.target.value)} placeholder={def} />
                {!faction[k] && (
                  <button onClick={() => set(k, def)}
                    className="absolute right-1 top-0.5 text-[8px] px-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300">auto</button>
                )}
              </div>
            </div>
          ))}
        </section>

        {/* Flags */}
        <section className="space-y-1">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-700 pb-1">Flags</h3>
          <YesNo label="Custom battle availability" value={faction.custom_battle_availability} onChange={v => set('custom_battle_availability', v)} />
          <YesNo label="Can sap" value={faction.can_sap} onChange={v => set('can_sap', v)} />
          <YesNo label="Prefers naval invasions" value={faction.prefers_naval_invasions} onChange={v => set('prefers_naval_invasions', v)} />
          <YesNo label="Can have princess" value={faction.can_have_princess} onChange={v => set('can_have_princess', v)} />
          <YesNo label="Has family tree" value={faction.has_family_tree} onChange={v => set('has_family_tree', v)} />
        </section>

        {/* Horde */}
        <section className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-700 pb-1">Horde</h3>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-[10px] text-slate-400">Can horde</span>
            <div className="flex rounded overflow-hidden border border-slate-700">
              {[true, false].map(opt => (
                <button key={String(opt)} onClick={() => set('can_horde', opt)}
                  className={`px-2 py-0.5 text-[10px] transition-colors ${faction.can_horde === opt ? 'bg-primary text-primary-foreground' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                  {opt ? 'yes' : 'no'}
                </button>
              ))}
            </div>
          </div>
          {faction.can_horde && (
            <div className="space-y-2 pl-2 border-l-2 border-amber-800">
              {hordeIntField('horde_min_units', 'horde_min_units')}
              {hordeIntField('horde_max_units', 'horde_max_units')}
              {hordeIntField('horde_max_units_reduction_every_horde', 'horde_max_units_reduction_every_horde')}
              {hordeIntField('horde_unit_per_settlement_population', 'horde_unit_per_settlement_population')}
              {hordeIntField('horde_min_named_characters', 'horde_min_named_characters')}
              {hordeIntField('horde_max_percent_army_stack', 'horde_max_percent_army_stack')}
              <div className="flex items-center gap-3">
                <label className="text-[10px] text-slate-400 w-60 shrink-0">horde_disband_percent_on_settlement_capture <span className="text-slate-600">(0-100)</span></label>
                <input type="number" min={0} max={100}
                  value={faction.horde_disband_percent_on_settlement_capture ?? 0}
                  onChange={e => set('horde_disband_percent_on_settlement_capture', Math.max(0, Math.min(100, +e.target.value || 0)))}
                  className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-[11px] text-slate-200" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400">horde_unit entries <span className="text-red-400">*</span></label>
                <HordeUnitsEditor
                  units={faction.horde_units || []}
                  onChange={v => set('horde_units', v)}
                  eduUnits={eduUnits}
                />
              </div>
            </div>
          )}
        </section>

        {/* Extra lines */}
        {faction.extras?.length > 0 && (
          <section className="space-y-1">
            <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-700 pb-1">Additional Lines (unknown / raw)</h3>
            <textarea
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-[10px] font-mono text-slate-300 resize-y"
              rows={Math.min(faction.extras.length + 1, 6)}
              value={faction.extras.join('\n')}
              onChange={e => set('extras', e.target.value.split('\n'))}
            />
          </section>
        )}
      </div>
    </ScrollArea>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FactionsEditor() {
  const [factions, setFactions]   = useState(null);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [search, setSearch]       = useState('');
  const [cultures, setCultures]   = useState([]);
  const [religions, setReligions] = useState([]);
  const [eduUnits, setEduUnits]   = useState([]);

  const fileRef     = useRef();
  const cultRef     = useRef();
  const relRef      = useRef();
  const eduRef      = useRef();

  useEffect(() => {
    try { const r = localStorage.getItem(LS_KEY);   if (r) setFactions(parseDescrSmFactions(r)); } catch {}
    try { const r = localStorage.getItem(LS_CULT);  if (r) setCultures(JSON.parse(r)); } catch {}
    try { const r = localStorage.getItem(LS_REL);   if (r) setReligions(JSON.parse(r)); } catch {}
    try { const r = localStorage.getItem(LS_UNITS); if (r) setEduUnits(JSON.parse(r)); } catch {}
  }, []);

  const loadFactions = useCallback(async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    try { localStorage.setItem(LS_KEY, text); } catch {}
    const parsed = parseDescrSmFactions(text);
    setFactions(parsed);
    setSelectedIdx(parsed.length > 0 ? 0 : null);
    e.target.value = '';
  }, []);

  const loadCultures = useCallback(async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    const list = parseCultures(text);
    setCultures(list);
    try { localStorage.setItem(LS_CULT, JSON.stringify(list)); } catch {}
    e.target.value = '';
  }, []);

  const loadReligions = useCallback(async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    const list = parseReligions(text);
    setReligions(list);
    try { localStorage.setItem(LS_REL, JSON.stringify(list)); } catch {}
    e.target.value = '';
  }, []);

  const loadEdu = useCallback(async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    const list = parseEduUnits(text);
    setEduUnits(list);
    try { localStorage.setItem(LS_UNITS, JSON.stringify(list)); } catch {}
    e.target.value = '';
  }, []);

  const handleExport = () => {
    if (!factions) return;
    const text = serialiseDescrSmFactions(factions);
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'descr_sm_factions.txt';
    a.click();
  };

  const updateFaction = (i, f) => {
    const updated = factions.map((x, idx) => idx === i ? f : x);
    setFactions(updated);
  };

  const addFaction = () => {
    const newF = {
      name: 'new_faction',
      culture: cultures[0] || '',
      religion: religions[0] || '',
      symbol: 'models_strat/symbol_new_faction.CAS',
      rebel_symbol: 'models_strat/symbol_rebels.CAS',
      primary_colour: { r: 128, g: 128, b: 128 },
      secondary_colour: { r: 200, g: 200, b: 200 },
      loading_logo: '',
      standard_index: '',
      logo_index: '',
      small_logo_index: '',
      triumph_value: '5',
      custom_battle_availability: 'yes',
      can_sap: 'no',
      prefers_naval_invasions: 'no',
      can_have_princess: 'yes',
      has_family_tree: 'yes',
      can_horde: false,
      horde_min_units: 0,
      horde_max_units: 0,
      horde_max_units_reduction_every_horde: 0,
      horde_unit_per_settlement_population: 0,
      horde_min_named_characters: 0,
      horde_max_percent_army_stack: 0,
      horde_disband_percent_on_settlement_capture: 0,
      horde_units: [],
      extras: [],
    };
    const updated = [...(factions || []), newF];
    setFactions(updated);
    setSelectedIdx(updated.length - 1);
  };

  const deleteFaction = (i) => {
    const updated = factions.filter((_, idx) => idx !== i);
    setFactions(updated);
    setSelectedIdx(updated.length > 0 ? Math.min(i, updated.length - 1) : null);
  };

  const filtered = factions
    ? factions.map((f, i) => ({ f, i })).filter(({ f }) => !search || f.name.toLowerCase().includes(search.toLowerCase()))
    : [];

  const overLimit = factions && factions.length > VANILLA_FACTION_LIMIT;

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="border-b border-border flex flex-wrap items-center px-4 gap-2 py-1.5 shrink-0 bg-card/50">
        <Shield className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold">Factions Editor</span>
        {factions && <span className="text-[10px] text-slate-500 font-mono">({factions.length} factions)</span>}
        {overLimit && (
          <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-900/30 border border-amber-700 rounded px-2 py-0.5">
            <AlertTriangle className="w-3 h-3" />
            {factions.length} — vanilla limit {VANILLA_FACTION_LIMIT}. Extras require M2EX.
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          {/* Reference file loaders */}
          <input ref={cultRef} type="file" accept=".txt" className="hidden" onChange={loadCultures} />
          <Button variant="outline" size="sm" className={`text-[10px] h-7 ${cultures.length ? 'text-green-400 border-green-800' : ''}`} onClick={() => cultRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" />
            {cultures.length ? `${cultures.length} cultures` : 'descr_cultures.txt'}
          </Button>

          <input ref={relRef} type="file" accept=".txt" className="hidden" onChange={loadReligions} />
          <Button variant="outline" size="sm" className={`text-[10px] h-7 ${religions.length ? 'text-green-400 border-green-800' : ''}`} onClick={() => relRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" />
            {religions.length ? `${religions.length} religions` : 'descr_religions.txt'}
          </Button>

          <input ref={eduRef} type="file" accept=".txt" className="hidden" onChange={loadEdu} />
          <Button variant="outline" size="sm" className={`text-[10px] h-7 ${eduUnits.length ? 'text-green-400 border-green-800' : ''}`} onClick={() => eduRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" />
            {eduUnits.length ? `${eduUnits.length} units (EDU)` : 'export_descr_unit.txt'}
          </Button>

          <div className="w-px h-5 bg-border mx-1" />

          {/* Main file */}
          <input ref={fileRef} type="file" accept=".txt" className="hidden" onChange={loadFactions} />
          <Button variant="outline" size="sm" className={`text-[10px] h-7 ${factions ? 'text-amber-400 border-amber-700' : ''}`} onClick={() => fileRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" />
            {factions ? 'Reload factions' : 'Load descr_sm_factions.txt'}
          </Button>
          {factions && (
            <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={handleExport}>
              <Download className="w-3 h-3 mr-1" /> Export
            </Button>
          )}
        </div>
      </div>

      {!factions ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-slate-500">
          <Shield className="w-10 h-10 opacity-30" />
          <p className="text-sm">Load <span className="font-mono text-amber-400">descr_sm_factions.txt</span> to begin</p>
          <p className="text-[11px] text-slate-600">Optionally also load <span className="font-mono text-slate-400">descr_cultures.txt</span>, <span className="font-mono text-slate-400">descr_religions.txt</span>, and <span className="font-mono text-slate-400">export_descr_unit.txt</span> for dropdowns</p>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" /> Choose file…
          </Button>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-56 border-r border-border flex flex-col shrink-0">
            <div className="p-2 border-b border-border space-y-1">
              <Input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="h-6 text-[10px] px-2" />
              <Button variant="outline" size="sm" className="w-full text-[10px] h-6" onClick={addFaction}>
                <Plus className="w-3 h-3 mr-1" /> Add Faction
              </Button>
            </div>
            <ScrollArea className="flex-1">
              {filtered.map(({ f, i }) => (
                <button key={i} onClick={() => setSelectedIdx(i)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left border-b border-border/60 hover:bg-accent transition-colors group ${selectedIdx === i ? 'bg-accent' : ''}`}>
                  <div className="flex gap-1 shrink-0">
                    <div className="w-3 h-3 rounded-sm border border-slate-600" style={{ background: rgbToHex(f.primary_colour) }} />
                    <div className="w-3 h-3 rounded-sm border border-slate-600" style={{ background: rgbToHex(f.secondary_colour) }} />
                  </div>
                  <span className="flex-1 text-[11px] font-mono truncate">{f.name}</span>
                  <button onClick={e => { e.stopPropagation(); deleteFaction(i); }}
                    className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 transition-opacity shrink-0">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </button>
              ))}
            </ScrollArea>
          </div>

          {/* Detail */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {selectedIdx !== null && factions[selectedIdx] ? (
              <FactionDetail
                key={selectedIdx}
                faction={factions[selectedIdx]}
                onChange={f => updateFaction(selectedIdx, f)}
                cultures={cultures}
                religions={religions}
                eduUnits={eduUnits}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                Select a faction to edit
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}