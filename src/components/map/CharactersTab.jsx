import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Archive, MapPin, CheckCircle, AlertTriangle, GripVertical } from 'lucide-react';
import FamilyTreeTab from './FamilyTreeTab';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

// Small component that shows character portrait previews (young/old/dead variants)
// Portrait field = folder name inside data/ui/custom_portraits/[name]/portrait_young.tga etc.
function PortraitPreview({ name }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick(t => t + 1);
    window.addEventListener('load-portraits', h);
    return () => window.removeEventListener('load-portraits', h);
  }, []);

  const folder = name.toLowerCase().replace(/\.tga$/i, '');
  const portraits = window._m2tw_portraits || {};
  const variants = ['portrait_young', 'portrait_old', 'portrait_dead'];
  const found = variants.map(v => ({ label: v.replace('portrait_', ''), src: portraits[`${folder}/${v}`] || null })).filter(v => v.src);

  if (found.length > 0) {
    return (
      <div className="mt-1 flex gap-1">
        {found.map(({ label, src }) => (
          <div key={label} className="flex flex-col items-center gap-0.5">
            <img src={src} alt={label} className="rounded border border-slate-700/40 h-20 object-contain bg-black/40" />
            <span className="text-[8px] text-slate-500">{label}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <p className="text-[8px] text-slate-600 mt-0.5 italic">
      No preview — load data/ui/custom_portraits/ folder
    </p>
  );
}

// Types that force female sex
const FEMALE_ONLY_TYPES = new Set([]);
// Types that force male sex
const MALE_ONLY_TYPES = new Set(['general', 'admiral', 'spy', 'diplomat', 'assassin', 'named character']);
// "family" type is both sexes, goes to character_record
const ALL_CHARACTER_TYPES = ['general', 'admiral', 'spy', 'diplomat', 'assassin', 'named character', 'family'];
// Only named character can have leader/heir role (generals/admirals cannot)
const CAN_HAVE_ROLE = new Set(['named character']);
const RECORD_ROLES = ['never_a_leader', 'past_leader', 'past_heir', 'leader', 'heir'];
const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const HERO_ABILITIES = ['Byzantine_Politics', 'Light_of_the_Faith', 'Righteousness_of_Faith', 'Heart_of_the_Lion', 'Flower_of_Chivalry'];

function getSexForType(charType) {
  if (FEMALE_ONLY_TYPES.has(charType)) return 'female';
  if (MALE_ONLY_TYPES.has(charType)) return 'male';
  return null; // family = free choice
}

// Get available first names from descrNames for a faction + sex
function getNames(descrNames, faction, sex) {
  if (!descrNames || !faction) return [];
  const sexKey = sex === 'female' ? 'female' : 'male';
  // Parser stores faction keys in lowercase
  return descrNames[sexKey]?.[faction.toLowerCase()] || descrNames[sexKey]?.[faction] || [];
}

// Get available surnames from descrNames for a faction
function getSurnames(descrNames, faction) {
  if (!descrNames || !faction) return [];
  return descrNames._surnames?.[faction.toLowerCase()] || descrNames._surnames?.[faction] || [];
}

// Get display name from namesDisplayMap (parsed from names.txt)
function getDisplayName(namesDisplayMap, internalName) {
  if (!namesDisplayMap || !internalName) return '';
  return namesDisplayMap[internalName] || namesDisplayMap[internalName.toLowerCase()] || '';
}

// Validate character for the "Save Character" button
function validateChar(char, eduUnits) {
  if (!char.faction) return { ok: false, reason: 'No faction selected' };
  if (!char.name) return { ok: false, reason: 'No name selected' };
  if (char.charType === 'family') return { ok: true, reason: '' };
  // Must be placed on map (x and y required) for non-family types
  if (char.x == null || char.y == null) return { ok: false, reason: 'Character must be placed on the map (X/Y required)' };

  const factionUnits = (eduUnits || []).filter(u =>
    u.ownership && (u.ownership.includes(char.faction) || u.ownership.includes('all'))
  );

  if (char.charType === 'named character') {
    const hasGeneral = factionUnits.some(u => u.attributes?.includes('general_unit') || u.attributes?.includes('general_unit_upgrade'));
    if (!hasGeneral) return { ok: false, reason: `No general unit available for ${char.faction} in EDU` };
  }
  if (char.charType === 'general') {
    const hasArmy = (char.army || []).length > 0;
    if (!hasArmy) return { ok: false, reason: 'General needs at least one army unit' };
    const factionUnitNames = new Set(factionUnits.map(u => u.type));
    const allValid = (char.army || []).every(u => !u.unit || factionUnitNames.has(u.unit));
    if (!allValid) return { ok: false, reason: 'Some army units are not available to this faction' };
  }
  if (char.charType === 'admiral') {
    const hasShip = (char.army || []).length > 0;
    if (!hasShip) return { ok: false, reason: 'Admiral needs at least one ship unit' };
    const shipUnits = new Set(factionUnits.filter(u => u.category === 'ship').map(u => u.type));
    const hasValidShip = (char.army || []).some(u => u.unit && shipUnits.has(u.unit));
    if (!hasValidShip) return { ok: false, reason: 'No valid ship unit found for this faction' };
  }
  return { ok: true, reason: '' };
}

function CharacterRow({ char, allFactions, descrNames, namesDisplayMap, traitsList, ancillariesList, eduUnits, onUpdate, onDelete, onSelect, onPin, allStratFactions, onConfirmCreate, dragHandleProps, shouldOpen, onOpened }) {
  const [expanded, setExpanded] = useState(char._isNew ?? false);
  const rowRef = useRef(null);

  useEffect(() => {
    if (shouldOpen) {
      setExpanded(true);
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      onOpened?.();
    }
  }, [shouldOpen]);
  const c = char;
  const set = (key, val) => onUpdate(c.id, { ...c, [key]: val });

  const forcedSex = getSexForType(c.charType);
  const effectiveSex = forcedSex || c.sex || 'male';
  const isFamily = c.charType === 'family';
  const canHaveRole = CAN_HAVE_ROLE.has(c.charType);
  const hasArmy = c.charType === 'general' || c.charType === 'named character' || c.charType === 'admiral';
  const isNamedChar = c.charType === 'named character';
  // Only named characters and generals can have battle_model and hero_ability
  const canHaveBattleModel = c.charType === 'named character' || c.charType === 'general';
  const canHaveHeroAbility = c.charType === 'named character' || c.charType === 'general';

  const isSlave = c.faction === 'slave';
  const subFactionActive = isSlave && !!c.subFaction;
  // If sub_faction is active, use sub_faction names; otherwise use faction names
  const nameFaction = subFactionActive ? c.subFaction : c.faction;
  const firstNames = useMemo(() => getNames(descrNames, nameFaction, effectiveSex), [descrNames, nameFaction, effectiveSex]);
  const surnameNames = useMemo(() => getSurnames(descrNames, nameFaction), [descrNames, nameFaction]);

  const firstNameDisplay = getDisplayName(namesDisplayMap, c.name);
  const surnameDisplay = getDisplayName(namesDisplayMap, c.surname);

  // EDU units: if sub_faction active, merge slave + sub_faction units
  const factionEduUnits = useMemo(() => {
    if (!eduUnits?.length) return [];
    const primary = (eduUnits).filter(u => u.ownership && (u.ownership.includes(c.faction) || u.ownership.includes('all')));
    if (!subFactionActive) return primary;
    const subUnits = (eduUnits).filter(u => u.ownership && u.ownership.includes(c.subFaction));
    const seen = new Set(primary.map(u => u.type));
    return [...primary, ...subUnits.filter(u => !seen.has(u.type))];
  }, [eduUnits, c.faction, c.subFaction, subFactionActive]);

  // For named character: first army slot must be a general_unit; extra units only allowed after that
  const generalUnitInArmy = isNamedChar
    ? (c.army || []).find(u => {
        const eu = factionEduUnits.find(e => e.type === u.unit);
        return eu?.attributes?.includes('general_unit') || eu?.attributes?.includes('general_unit_upgrade');
      })
    : null;
  const namedCharNeedsGeneralUnit = isNamedChar && !generalUnitInArmy;
  const factionArmyUnits = useMemo(() => factionEduUnits.filter(u => u.category !== 'ship'), [factionEduUnits]);
  const factionShipUnits = useMemo(() => factionEduUnits.filter(u => u.category === 'ship'), [factionEduUnits]);
  const availableUnits = c.charType === 'admiral' ? factionShipUnits : factionArmyUnits;

  const validation = useMemo(() => validateChar(c, eduUnits), [c, eduUnits]);

  const fullName = [c.name, c.surname].filter(Boolean).join(' ');

  const typeIcon = isFamily ? '👨‍👩‍👧' : c.charType === 'admiral' ? '⚓' : c.charType === 'diplomat' ? '📜' : c.charType === 'spy' ? '🕵️' : c.charType === 'assassin' ? '🗡️': '⚔️';

  return (
    <div ref={rowRef} className={`rounded border ${c._isNew ? 'border-amber-500/50 bg-amber-900/10' : 'border-slate-700/40 bg-slate-900/20'}`}>
      <div className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer" onClick={() => setExpanded(v => !v)}>
        <span {...dragHandleProps} onClick={e => e.stopPropagation()} className="text-slate-600 hover:text-slate-400 cursor-grab active:cursor-grabbing shrink-0">
          <GripVertical className="w-3 h-3" />
        </span>
        {expanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
        <span className="text-sm shrink-0">{typeIcon}</span>
        <span className="text-[11px] font-mono flex-1 truncate text-slate-200">
          {c.role === 'leader' && <span className="mr-1 text-yellow-300" title="Leader">★</span>}
          {c.role === 'heir' && <span className="mr-1 text-sky-300" title="Heir">◆</span>}
          {fullName || '(unnamed)'} — <span className="text-slate-400">{c.charType}</span>
          {isFamily && <span className="ml-1 text-pink-400 text-[9px]">[record]</span>}
          {c._isNew && <span className="ml-1 text-amber-500 text-[9px] font-semibold">[NEW]</span>}
        </span>
        <span className="text-[9px] text-slate-600 font-mono">{c.x != null ? `${c.x},${c.y}` : 'unplaced'}</span>
        <button onClick={e => { e.stopPropagation(); onPin(char); }}
          title="Pin on map"
          className={`p-0.5 transition-colors shrink-0 ${c.x != null ? 'text-amber-400 hover:text-amber-300' : 'text-slate-600 hover:text-amber-400'}`}>
          <MapPin className="w-3 h-3" />
        </button>
        <button onClick={e => { e.stopPropagation(); onSelect(char); }}
          className="text-[9px] px-1 py-0.5 rounded bg-amber-600/20 border border-amber-500/30 text-amber-400 hover:bg-amber-600/40 shrink-0">Go</button>
        <button onClick={e => { e.stopPropagation(); onDelete(c.id); }}
          className="p-0.5 text-slate-600 hover:text-red-400 transition-colors shrink-0">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-700/40 px-2 py-2 space-y-1.5">
          <div className="space-y-1.5">
            {/* Row 1: Type (full width) */}
            <div>
              <span className="text-[9px] text-slate-500">Type</span>
              <select value={c.charType || 'general'} onChange={e => {
                const newType = e.target.value;
                const newForcedSex = getSexForType(newType);
                onUpdate(c.id, { ...c, charType: newType, sex: newForcedSex || c.sex || 'male' });
              }}
                className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200">
                {ALL_CHARACTER_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>

            {/* Row 2: Faction + Sub-Faction */}
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <span className="text-[9px] text-slate-500">Faction</span>
                <select value={c.faction || ''} onChange={e => {
                  const newFaction = e.target.value;
                  onUpdate(c.id, { ...c, faction: newFaction, subFaction: newFaction === 'slave' ? (c.subFaction || '') : '' });
                }}
                  className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200">
                  <option value="">— select —</option>
                  {allFactions.map(f => <option key={f}>{f}</option>)}
                </select>
              </div>
              <div className={!isSlave ? 'opacity-40 pointer-events-none' : ''}>
                <span className={`text-[9px] ${isSlave ? 'text-amber-400' : 'text-slate-600'}`}>
                  Sub-Faction {!isSlave && <span className="text-slate-700">(slave only)</span>}
                </span>
                <select value={c.subFaction || ''} onChange={e => set('subFaction', e.target.value)}
                  disabled={!isSlave}
                  className={`w-full h-6 px-1.5 text-[11px] rounded border font-mono ${isSlave ? 'bg-slate-800 border-amber-600/40 text-amber-200' : 'bg-slate-800/40 border-slate-700/20 text-slate-600'}`}>
                  <option value="">— none —</option>
                  {(allStratFactions || allFactions).filter(f => f !== 'slave').map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                {subFactionActive && <p className="text-[8px] text-amber-400/70 mt-0.5">Names & units from slave + {c.subFaction}</p>}
              </div>
            </div>

            {/* Row 3: First Name + Surname */}
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <span className="text-[9px] text-slate-500">First Name</span>
                {firstNames.length > 0 ? (
                  <select value={c.name || ''} onChange={e => set('name', e.target.value)}
                    className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono">
                    <option value="">— select —</option>
                    {firstNames.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                ) : (
                  <input value={c.name || ''} onChange={e => set('name', e.target.value)}
                    placeholder={descrNames ? 'no names for faction' : 'load descr_names.txt'}
                    className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
                )}
                {firstNameDisplay && <p className="text-[9px] text-amber-300/70 mt-0.5 font-mono">"{firstNameDisplay}"</p>}
              </div>
              <div>
                <span className="text-[9px] text-slate-500">Surname / Epithet</span>
                {surnameNames.length > 0 ? (
                  <select value={c.surname || ''} onChange={e => set('surname', e.target.value)}
                    className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono">
                    <option value="">— none —</option>
                    {surnameNames.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                ) : (
                  <input value={c.surname || ''} onChange={e => set('surname', e.target.value)}
                    placeholder="optional"
                    className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
                )}
                {surnameDisplay && <p className="text-[9px] text-amber-300/70 mt-0.5 font-mono">"{surnameDisplay}"</p>}
              </div>
            </div>

            {/* Row 4: Sex + Age */}
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <span className="text-[9px] text-slate-500">Sex</span>
                {forcedSex ? (
                  <div className="h-6 px-1.5 flex items-center text-[11px] bg-slate-800/50 border border-slate-600/20 rounded text-slate-400 font-mono">
                    {forcedSex} <span className="ml-1 text-[9px] text-slate-600">(fixed)</span>
                  </div>
                ) : (
                  <select value={effectiveSex} onChange={e => set('sex', e.target.value)}
                    className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200">
                    <option value="male">male</option>
                    <option value="female">female</option>
                  </select>
                )}
              </div>
              <div>
                <span className="text-[9px] text-slate-500">Age</span>
                <input type="number" value={c.age || 30} onChange={e => set('age', parseInt(e.target.value) || 30)}
                  className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
              </div>
            </div>

            {/* Row 5: Role (named character) OR Alive/Dead + Record Role (family) */}
            {isFamily ? (
              <div className="space-y-1.5">
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <span className="text-[9px] text-slate-500">Status</span>
                    <select value={c.status === 'dead' ? 'dead' : 'alive'} onChange={e => {
                      if (e.target.value === 'dead') set('status', 'dead');
                      else onUpdate(c.id, { ...c, status: 'alive', deadYears: 0 });
                    }} className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200">
                      <option value="alive">alive</option>
                      <option value="dead">dead</option>
                    </select>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-500">Years Dead</span>
                    <input type="number" min={0} value={c.deadYears ?? 0} onChange={e => set('deadYears', parseInt(e.target.value) || 0)}
                      disabled={c.status !== 'dead'}
                      className={`w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded font-mono ${c.status === 'dead' ? 'text-red-300' : 'text-slate-600 opacity-40'}`} />
                  </div>
                </div>
                <div>
                  <span className="text-[9px] text-slate-500">Record Role</span>
                  <select value={c.recordRole || 'never_a_leader'} onChange={e => set('recordRole', e.target.value)}
                    className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200">
                    {RECORD_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <div>
                <span className="text-[9px] text-slate-500">Role</span>
                <select value={c.role || ''} onChange={e => set('role', e.target.value)}
                  disabled={!canHaveRole}
                  className={`w-full h-6 px-1.5 text-[11px] rounded border ${canHaveRole ? 'bg-slate-800 border-slate-600/40 text-slate-200' : 'bg-slate-800/40 border-slate-700/20 text-slate-600 opacity-40'}`}>
                  <option value="">— none —</option>
                  <option value="leader">leader</option>
                  <option value="heir">heir</option>
                </select>
              </div>
            )}

            {/* Row 6: Position (separate line) — hidden for family */}
            {!isFamily && (
              <div>
                <span className={`text-[9px] ${c.x == null || c.y == null ? 'text-red-400' : 'text-slate-500'}`}>
                  Position (X / Y) {c.x == null || c.y == null ? <span className="text-red-400">— required</span> : null}
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-slate-500 shrink-0">X</span>
                  <input type="number" placeholder="X" value={c.x ?? ''} onChange={e => set('x', e.target.value === '' ? null : parseInt(e.target.value))}
                    className={`w-16 h-6 px-1 text-[10px] bg-slate-800 rounded text-slate-200 font-mono border ${c.x == null ? 'border-red-500/50' : 'border-slate-600/40'}`} />
                  <span className="text-[9px] text-slate-500 shrink-0">Y</span>
                  <input type="number" placeholder="Y" value={c.y ?? ''} onChange={e => set('y', e.target.value === '' ? null : parseInt(e.target.value))}
                    className={`w-16 h-6 px-1 text-[10px] bg-slate-800 rounded text-slate-200 font-mono border ${c.y == null ? 'border-red-500/50' : 'border-slate-600/40'}`} />
                  <button onClick={() => onPin(char)} title="Click on map to place"
                    className="h-6 px-2 flex items-center gap-0.5 rounded text-[10px] border border-amber-500/40 bg-amber-600/20 text-amber-400 hover:bg-amber-600/40 transition-colors shrink-0">
                    <MapPin className="w-2.5 h-2.5" /> Place
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Traits — family type skips this */}
          {!isFamily && (
            <div>
              <p className="text-[9px] text-slate-500 uppercase font-semibold mb-0.5">Traits</p>
              {(c.traits || []).map((t, i) => (
                <div key={i} className="flex items-center gap-1 mb-0.5">
                  {traitsList.length > 0 ? (
                    <select value={t.name} onChange={e => {
                      const traits = c.traits.map((x, j) => j === i ? { ...x, name: e.target.value } : x);
                      set('traits', traits);
                    }} className="flex-1 h-5 px-1 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono">
                      <option value="">— select trait —</option>
                      {traitsList.map(tr => <option key={tr} value={tr}>{tr}</option>)}
                    </select>
                  ) : (
                    <input value={t.name} onChange={e => {
                      const traits = c.traits.map((x, j) => j === i ? { ...x, name: e.target.value } : x);
                      set('traits', traits);
                    }} className="flex-1 h-5 px-1 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" placeholder="TraitName" />
                  )}
                  <input type="number" value={t.level} onChange={e => {
                    const traits = c.traits.map((x, j) => j === i ? { ...x, level: parseInt(e.target.value) } : x);
                    set('traits', traits);
                  }} className="w-10 h-5 px-1 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono text-center" />
                  <button onClick={() => set('traits', c.traits.filter((_, j) => j !== i))} className="text-slate-600 hover:text-red-400 text-[9px]">✕</button>
                </div>
              ))}
              <button onClick={() => set('traits', [...(c.traits || []), { name: '', level: 1 }])}
                className="mt-1 w-full flex items-center justify-center gap-1 py-1 text-[10px] font-semibold rounded border border-slate-600/50 bg-slate-800/60 text-slate-300 hover:text-slate-100 hover:bg-slate-700/60 transition-colors">
                <Plus className="w-3 h-3" /> Add Trait {traitsList.length === 0 && <span className="text-slate-500 font-normal text-[9px]">(load traits file)</span>}
              </button>
            </div>
          )}

          {/* Ancillaries — family type skips this */}
          {!isFamily && (
            <div>
              <p className="text-[9px] text-slate-500 uppercase font-semibold mb-0.5">Ancillaries</p>
              <div className="flex flex-wrap gap-0.5 mb-0.5">
                {(c.ancillaries || []).map((a, i) => (
                  <span key={i} className="flex items-center gap-0.5 px-1 py-0.5 bg-slate-700/50 rounded text-[9px] text-purple-300 font-mono">
                    {a}<button onClick={() => set('ancillaries', c.ancillaries.filter((_, j) => j !== i))} className="text-slate-600 hover:text-red-400 ml-0.5">×</button>
                  </span>
                ))}
              </div>
              {ancillariesList.length > 0 ? (
                <select defaultValue="" onChange={e => {
                  if (e.target.value && !(c.ancillaries || []).includes(e.target.value)) {
                    set('ancillaries', [...(c.ancillaries || []), e.target.value]);
                  }
                  e.target.value = '';
                }} className="w-full h-7 px-1.5 text-[10px] font-semibold bg-slate-800 border border-slate-600/50 rounded text-slate-300 hover:border-slate-500 transition-colors cursor-pointer">
                  <option value="">＋ Add Ancillary…</option>
                  {ancillariesList.filter(a => !(c.ancillaries || []).includes(a)).map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              ) : (
                <div className="flex gap-1">
                  <input id={`anc-${c.id}`} placeholder="ancillary_name (load file for dropdown)" className="flex-1 h-7 px-1.5 text-[10px] bg-slate-800 border border-slate-600/50 rounded text-slate-200 font-mono" />
                  <button onClick={() => {
                    const inp = document.getElementById(`anc-${c.id}`);
                    if (inp?.value) { set('ancillaries', [...(c.ancillaries || []), inp.value]); inp.value = ''; }
                  }} className="h-7 px-2 rounded bg-slate-700/60 border border-slate-600/50 text-slate-300 hover:text-slate-100 font-semibold text-[10px]">＋</button>
                </div>
              )}
            </div>
          )}

          {/* Army — only general/named character/admiral, skip for family */}
          {hasArmy && !isFamily && (
            <div>
              <p className="text-[9px] text-slate-500 uppercase font-semibold mb-0.5">
                {c.charType === 'admiral' ? 'Ships' : 'Army Units'}
                {c.faction && availableUnits.length > 0 && <span className="ml-1 text-slate-600">({availableUnits.length} available)</span>}
                {c.faction && availableUnits.length === 0 && eduUnits.length > 0 && <span className="ml-1 text-amber-500"> — load EDU</span>}
              </p>

              {/* Named character: must pick general_unit first */}
              {isNamedChar && namedCharNeedsGeneralUnit && (
                <div className="mb-1">
                  <p className="text-[9px] text-amber-400 mb-0.5">⚠ Pick a general unit first (required)</p>
                  {(() => {
                    const generalUnits = factionEduUnits.filter(u =>
                      u.attributes?.includes('general_unit') || u.attributes?.includes('general_unit_upgrade')
                    );
                    return (
                      <select defaultValue="" onChange={e => {
                        if (e.target.value) set('army', [{ unit: e.target.value, exp: 0, armour: 0, weaponLvl: 0 }, ...(c.army || [])]);
                        e.target.value = '';
                      }} className="w-full h-6 px-1 text-[9px] bg-slate-800 border border-amber-500/40 rounded text-amber-200 font-mono">
                        <option value="">{generalUnits.length ? '— select general unit —' : 'No general units in EDU (load EDU)'}</option>
                        {generalUnits.map(u => <option key={u.type} value={u.type}>{u.type}</option>)}
                      </select>
                    );
                  })()}
                </div>
              )}

              <div className="space-y-0.5">
                {(c.army || []).map((u, i) => {
                  const eu = factionEduUnits.find(e => e.type === u.unit);
                  const isGeneralUnit = eu?.attributes?.includes('general_unit') || eu?.attributes?.includes('general_unit_upgrade');
                  return (
                    <div key={i} className={`flex items-center gap-1 ${isNamedChar && isGeneralUnit ? 'ring-1 ring-amber-500/30 rounded' : ''}`}>
                      {availableUnits.length > 0 ? (
                        <select value={u.unit} onChange={e => {
                          const army = c.army.map((x, j) => j === i ? { ...x, unit: e.target.value } : x);
                          set('army', army);
                        }} className={`flex-1 h-5 px-1 text-[9px] bg-slate-800 border border-slate-600/40 rounded font-mono ${isNamedChar && isGeneralUnit ? 'text-amber-300' : 'text-slate-200'}`}>
                          <option value="">— select unit —</option>
                          {availableUnits.map(u2 => <option key={u2.type} value={u2.type}>{u2.type}</option>)}
                        </select>
                      ) : (
                        <input value={u.unit} onChange={e => {
                          const army = c.army.map((x, j) => j === i ? { ...x, unit: e.target.value } : x);
                          set('army', army);
                        }} className="flex-1 h-5 px-1 text-[9px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" placeholder="unit name" />
                      )}
                      <input type="number" title="exp" value={u.exp ?? 0} min={0} onChange={e => {
                        const army = c.army.map((x, j) => j === i ? { ...x, exp: parseInt(e.target.value) || 0 } : x);
                        set('army', army);
                      }} className="w-8 h-5 px-0.5 text-[9px] bg-slate-800 border border-slate-600/40 rounded text-amber-300 font-mono text-center" />
                      <input type="number" title="armour" value={u.armour ?? 0} min={0} onChange={e => {
                        const army = c.army.map((x, j) => j === i ? { ...x, armour: parseInt(e.target.value) || 0 } : x);
                        set('army', army);
                      }} className="w-8 h-5 px-0.5 text-[9px] bg-slate-800 border border-slate-600/40 rounded text-blue-300 font-mono text-center" />
                      <input type="number" title="wpn" value={u.weaponLvl ?? 0} min={0} onChange={e => {
                        const army = c.army.map((x, j) => j === i ? { ...x, weaponLvl: parseInt(e.target.value) || 0 } : x);
                        set('army', army);
                      }} className="w-8 h-5 px-0.5 text-[9px] bg-slate-800 border border-slate-600/40 rounded text-red-300 font-mono text-center" />
                      <button onClick={() => set('army', c.army.filter((_, j) => j !== i))} className="text-slate-600 hover:text-red-400 text-[9px] shrink-0">✕</button>
                    </div>
                  );
                })}
              </div>
              <p className="text-[8px] text-slate-600 mb-0.5">exp | armour | wpn_lvl</p>
              {/* For named character, only allow adding more units after general_unit is set */}
              {(!isNamedChar || !namedCharNeedsGeneralUnit) && (
                <button onClick={() => set('army', [...(c.army || []), { unit: '', exp: 0, armour: 0, weaponLvl: 0 }])}
                  className="mt-1 w-full flex items-center justify-center gap-1 py-1 text-[10px] font-semibold rounded border border-slate-600/50 bg-slate-800/60 text-slate-300 hover:text-slate-100 hover:bg-slate-700/60 transition-colors">
                  <Plus className="w-3 h-3" /> Add Unit
                </button>
              )}
            </div>
          )}

          {/* Optional fields: comment, portrait, label, battle_model, hero_ability, direction */}
          {!isFamily && (
            <div className="border-t border-slate-700/30 pt-1.5 space-y-1">
              <p className="text-[9px] text-slate-500 uppercase font-semibold">Optional Fields</p>

              {/* Comment — written as ;;;;; comment before the character line */}
              <div>
                <span className="text-[9px] text-slate-500">Comment (written as ;;;;; … before character)</span>
                <input value={c.comment || ''} onChange={e => set('comment', e.target.value)}
                  placeholder="optional comment text"
                  className="w-full h-6 px-1.5 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-400 font-mono" />
              </div>

              <div className="grid grid-cols-2 gap-1">
                {/* Portrait */}
                <div className="col-span-2">
                  <span className="text-[9px] text-slate-500">Portrait</span>
                  <input value={c.portrait || ''} onChange={e => set('portrait', e.target.value)}
                    placeholder="portrait name"
                    className="w-full h-6 px-1.5 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
                  {c.portrait && <PortraitPreview name={c.portrait} />}
                </div>

                {/* Label */}
                <div>
                  <span className="text-[9px] text-slate-500">Label</span>
                  <input value={c.label || ''} onChange={e => set('label', e.target.value)}
                    placeholder="label name"
                    className="w-full h-6 px-1.5 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
                </div>

                {/* Battle Model — only for named character and general */}
                {canHaveBattleModel && (
                  <div>
                    <span className="text-[9px] text-slate-500">Battle Model</span>
                    <input value={c.battleModel || ''} onChange={e => set('battleModel', e.target.value)}
                      placeholder="battle_model name"
                      className="w-full h-6 px-1.5 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
                  </div>
                )}

                {/* Direction */}
                <div>
                  <span className="text-[9px] text-slate-500">Direction</span>
                  <select value={c.direction || ''} onChange={e => set('direction', e.target.value)}
                    className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200">
                    <option value="">— none —</option>
                    {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>

              {/* Hero Ability — only for named character and general */}
              {canHaveHeroAbility && (
                <div>
                  <span className="text-[9px] text-slate-500">Hero Ability</span>
                  <div className="flex gap-1">
                    <select value={c.heroAbility || ''} onChange={e => set('heroAbility', e.target.value)}
                      className="flex-1 h-6 px-1.5 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono">
                      <option value="">— none —</option>
                      {HERO_ABILITIES.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <input value={c.heroAbility || ''} onChange={e => set('heroAbility', e.target.value)}
                      placeholder="custom ability"
                      className="w-28 h-6 px-1.5 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Validate + Save button — shown for ALL characters (new and existing) */}
          <div className="pt-1 border-t border-slate-700/40 space-y-1">
            {/* Validation status */}
            <div className={`w-full flex items-center justify-center gap-1.5 py-1 rounded text-[10px] font-semibold border ${
              validation.ok
                ? 'bg-green-700/20 border-green-500/30 text-green-400'
                : 'bg-slate-800/40 border-slate-700/30 text-slate-600'
            }`} title={validation.reason}>
              {validation.ok
                ? <><CheckCircle className="w-3 h-3" /> Ready to save</>
                : <><AlertTriangle className="w-3 h-3" /> {validation.reason}</>
              }
            </div>
            <button
              disabled={!validation.ok}
              onClick={() => {
                if (!validation.ok) return;
                if (c.id < 0) {
                  // New char: confirm creation (removes _isNew flag)
                  onConfirmCreate(c.id);
                }
                // For existing chars (positive ID), changes are already live via onUpdate; just give visual feedback
                setExpanded(false);
              }}
              className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded text-[10px] font-semibold border transition-colors ${
                validation.ok
                  ? 'bg-green-700/80 hover:bg-green-700 border-green-600/60 text-white'
                  : 'bg-slate-800/40 border-slate-700/30 text-slate-600 cursor-not-allowed opacity-60'
              }`}
            >
              <CheckCircle className="w-3 h-3" /> Save Character
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CharacterRecordRow({ rec, factionName, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const isDead = rec.status === 'dead';
  const set = (key, val) => onUpdate({ ...rec, [key]: val });

  return (
    <div className="rounded border border-slate-700/30 bg-slate-900/10">
      <div className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer" onClick={() => setExpanded(v => !v)}>
        {expanded ? <ChevronDown className="w-3 h-3 text-slate-600" /> : <ChevronRight className="w-3 h-3 text-slate-600" />}
        <Archive className="w-3 h-3 text-slate-600 shrink-0" />
        <span className="text-[11px] font-mono flex-1 truncate text-slate-400">
          {[rec.name, rec.surname].filter(Boolean).join(' ') || '(unnamed)'}
          <span className="text-slate-600 ml-1">{rec.sex} · age {rec.age}</span>
          {isDead && <span className="text-red-500/70 ml-1 text-[9px]">☠ {rec.deadYears}yr</span>}
          {rec.status && !isDead && <span className="text-slate-500 ml-1 text-[9px]">[{rec.status}]</span>}
        </span>
        <span className="text-[8px] text-slate-600 bg-slate-800/50 px-1 rounded">{factionName}</span>
      </div>

      {expanded && (
        <div className="border-t border-slate-700/30 px-2 py-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <span className="text-[9px] text-slate-500">First Name</span>
              <input value={rec.name || ''} onChange={e => set('name', e.target.value)}
                className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-300 font-mono" />
            </div>
            <div>
              <span className="text-[9px] text-slate-500">Surname</span>
              <input value={rec.surname || ''} onChange={e => set('surname', e.target.value)}
                placeholder="optional"
                className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-300 font-mono" />
            </div>
            <div>
              <span className="text-[9px] text-slate-500">Sex</span>
              <select value={rec.sex || 'male'} onChange={e => set('sex', e.target.value)}
                className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-300">
                <option value="male">male</option>
                <option value="female">female</option>
              </select>
            </div>
            <div>
              <span className="text-[9px] text-slate-500">Age</span>
              <input type="number" value={rec.age || 0} onChange={e => set('age', parseInt(e.target.value) || 0)}
                className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-300 font-mono" />
            </div>
            <div>
              <span className="text-[9px] text-slate-500">Alive / Dead</span>
              <select value={isDead ? 'dead' : 'alive'} onChange={e => {
                if (e.target.value === 'dead') set('status', 'dead');
                else set('status', rec.status === 'dead' ? 'never_a_leader' : (rec.status || 'never_a_leader'));
              }}
                className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-300">
                <option value="alive">alive</option>
                <option value="dead">dead</option>
              </select>
            </div>
            {isDead && (
              <div>
                <span className="text-[9px] text-slate-500">Years Dead</span>
                <input type="number" min={0} value={rec.deadYears || 0} onChange={e => set('deadYears', parseInt(e.target.value) || 0)}
                  className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-red-300 font-mono" />
              </div>
            )}
            {!isDead && (
              <div>
                <span className="text-[9px] text-slate-500">Role</span>
                <select value={rec.status || 'never_a_leader'} onChange={e => set('status', e.target.value)}
                  className="w-full h-6 px-1.5 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-300">
                  {RECORD_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Serialize familyTrees back into stratData.factions[].relatives format
function serializeFamilyTreesToStratData(stratData, familyTrees) {
  if (!stratData) return stratData;
  const factions = (stratData.factions || []).map(faction => {
    const trees = familyTrees[faction.name] || [];
    if (trees.length === 0) return { ...faction, relatives: [] };
    // Each tree produces one "relative" line: [father, mother, child1, child2, ...]
    const relatives = trees.map(tree => {
      const parts = [];
      parts.push(tree.father ? [tree.father.name, tree.father.surname].filter(Boolean).join(' ') : '');
      parts.push(tree.mother ? [tree.mother.name, tree.mother.surname].filter(Boolean).join(' ') : '');
      for (const child of (tree.children || [])) {
        parts.push([child.name, child.surname].filter(Boolean).join(' '));
      }
      return parts;
    });
    return { ...faction, relatives };
  });
  return { ...stratData, factions };
}

export default function CharactersTab({ stratData, onStratDataChange, onSelectItem, descrNames, namesDisplayMap, traitsList = [], ancillariesList = [], eduUnits = [], onPinCharacter, openCharId, onOpenCharHandled }) {
  const [subTab, setSubTab] = useState('list');
  const [search, setSearch] = useState('');
  const [filterFaction, setFilterFaction] = useState('');
  // Family tree state lives HERE so it persists across tab switches
  const [familyTrees, setFamilyTrees] = useState({});
  const [treesInitialized, setTreesInitialized] = useState(false);
  const listTopRef = useRef(null);

  const allFactions = useMemo(() => {
    const from = (stratData?.factions || []).map(f => f.name).filter(Boolean);
    const fromLists = [...(stratData?.playable || []), ...(stratData?.unlockable || []), ...(stratData?.nonplayable || [])];
    return [...new Set([...from, ...fromLists])].sort();
  }, [stratData]);

  const allChars = useMemo(() =>
    (stratData?.items || []).filter(i => i.category === 'character'),
    [stratData?.items]
  );

  const allRecords = useMemo(() => {
    const recs = [];
    for (const f of (stratData?.factions || [])) {
      for (const r of (f.characterRecords || [])) {
        recs.push({ ...r, _faction: f.name });
      }
    }
    return recs;
  }, [stratData]);

  const filtered = useMemo(() =>
    allChars.filter(c => {
      const matchSearch = !search || c.name?.toLowerCase().includes(search.toLowerCase()) || c.charType?.includes(search);
      const matchFaction = !filterFaction || c.faction === filterFaction;
      return matchSearch && matchFaction;
    }),
    [allChars, search, filterFaction]
  );

  const filteredRecords = useMemo(() =>
    allRecords.filter(r => {
      const matchSearch = !search || r.name?.toLowerCase().includes(search.toLowerCase());
      const matchFaction = !filterFaction || r._faction === filterFaction;
      return matchSearch && matchFaction;
    }),
    [allRecords, search, filterFaction]
  );

  const handleUpdate = (id, updatedChar) => {
    if (!stratData) return;
    const items = (stratData.items || []).map(i => i.id === id ? updatedChar : i);
    onStratDataChange({ ...stratData, items });
  };

  const handleDelete = (id) => {
    if (!stratData) return;
    const items = (stratData.items || []).filter(i => i.id !== id);
    onStratDataChange({ ...stratData, items });
  };

  const handleRecordUpdate = (factionName, oldRec, updated) => {
    if (!stratData) return;
    const factions = (stratData.factions || []).map(f => {
      if (f.name !== factionName) return f;
      const characterRecords = (f.characterRecords || []).map(r =>
        r.name === oldRec.name ? updated : r
      );
      return { ...f, characterRecords };
    });
    onStratDataChange({ ...stratData, factions });
  };

  const handleAdd = () => {
    if (!stratData) return;
    const defaultFaction = filterFaction || allFactions[0] || '';
    const newChar = {
      id: -(Date.now()), category: 'character', name: '', surname: '',
      charType: 'general', sex: 'male', role: '', age: 30,
      faction: defaultFaction, x: null, y: null,
      traits: [], ancillaries: [], army: [],
      subFaction: '', portrait: '', label: '', battleModel: '', heroAbility: '', direction: '',
      comment: '', _isNew: true,
    };
    // New chars go at the TOP of items so they appear first in the list
    const items = [newChar, ...(stratData.items || [])];
    onStratDataChange({ ...stratData, items });
    // Scroll to top of list so new char is visible
    setTimeout(() => listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  // "Create Character" button: marks the char as confirmed (removes _isNew flag, keeps negative ID for serializer)
  const handleConfirmCreate = (id) => {
    if (!stratData) return;
    const items = (stratData.items || []).map(i => i.id === id ? { ...i, _isNew: false } : i);
    onStratDataChange({ ...stratData, items });
  };

  const handlePin = (char) => {
    if (onPinCharacter) onPinCharacter(char);
  };

  const handleDragEnd = (result) => {
    if (!result.destination || result.destination.index === result.source.index) return;
    if (!stratData) return;
    // Work on the full filtered list order (new items first, then rest)
    const ordered = [...filtered.filter(c => c._isNew), ...filtered.filter(c => !c._isNew)];
    const [moved] = ordered.splice(result.source.index, 1);
    ordered.splice(result.destination.index, 0, moved);
    // Rebuild items: replace chars in their new order, keep non-char items
    const nonChars = (stratData.items || []).filter(i => i.category !== 'character');
    onStratDataChange({ ...stratData, items: [...ordered, ...nonChars] });
  };

  if (!stratData?.raw) {
    return <div className="p-3 text-[10px] text-slate-600 text-center">Load descr_strat.txt to edit characters</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-slate-800 shrink-0">
        {[['list', 'Characters'], ['trees', 'Family Trees']].map(([id, label]) => (
          <button key={id} onClick={() => setSubTab(id)}
            className={`flex-1 py-1 text-[9px] font-semibold border-b-2 transition-colors ${subTab === id ? 'border-amber-500 text-amber-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {subTab === 'trees' && (
        <div className="flex-1 overflow-hidden">
          <FamilyTreeTab
            stratData={stratData}
            trees={familyTrees}
            onTreesChange={(updater) => {
              setFamilyTrees(prev => {
                const next = typeof updater === 'function' ? updater(prev) : updater;
                // Write family trees back into stratData.factions[].relatives so they get exported
                if (onStratDataChange && stratData) {
                  const updated = serializeFamilyTreesToStratData(stratData, next);
                  onStratDataChange(updated);
                }
                return next;
              });
            }}
            initialized={treesInitialized}
            onInitialized={() => setTreesInitialized(true)}
          />
        </div>
      )}

      {subTab === 'list' && (
        <>
          <div className="p-2 space-y-1.5 shrink-0 border-b border-slate-800">
            <div className="flex gap-1">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or type…"
                className="flex-1 h-6 px-2 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 placeholder-slate-600" />
              <select value={filterFaction} onChange={e => setFilterFaction(e.target.value)}
                className="h-6 px-1 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200">
                <option value="">All factions</option>
                {allFactions.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
            {/* File status hints */}
            <div className="flex flex-wrap gap-1">
              {!descrNames && <span className="text-[8px] text-amber-500/70 bg-amber-900/20 px-1 rounded">Load descr_names.txt for name dropdowns</span>}
              {traitsList.length === 0 && <span className="text-[8px] text-slate-600 bg-slate-800/40 px-1 rounded">Load traits file</span>}
              {ancillariesList.length === 0 && <span className="text-[8px] text-slate-600 bg-slate-800/40 px-1 rounded">Load ancillaries file</span>}
              {eduUnits.length === 0 && <span className="text-[8px] text-slate-600 bg-slate-800/40 px-1 rounded">Load EDU for unit validation</span>}
            </div>
            <button onClick={handleAdd}
              className="w-full flex items-center justify-center gap-1 py-1 text-[10px] rounded border border-slate-600/40 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 transition-colors">
              <Plus className="w-3 h-3" /> Add Character
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            <div ref={listTopRef} />
            {/* Drag-to-reorder character list */}
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="characters-list">
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-0.5">
                    {[...filtered.filter(c => c._isNew), ...filtered.filter(c => !c._isNew)].map((char, idx) => (
                      <Draggable key={String(char.id)} draggableId={String(char.id)} index={idx}>
                        {(drag) => (
                          <div ref={drag.innerRef} {...drag.draggableProps}>
                            <CharacterRow
                              char={char}
                              allFactions={allFactions}
                              allStratFactions={allFactions}
                              descrNames={descrNames}
                              namesDisplayMap={namesDisplayMap}
                              traitsList={traitsList}
                              ancillariesList={ancillariesList}
                              eduUnits={eduUnits}
                              onUpdate={handleUpdate}
                              onDelete={handleDelete}
                              onSelect={onSelectItem}
                              onPin={handlePin}
                              onConfirmCreate={handleConfirmCreate}
                              dragHandleProps={drag.dragHandleProps}
                              shouldOpen={openCharId === char.id}
                              onOpened={onOpenCharHandled}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>

            {filtered.length === 0 && allChars.length === 0 && (
              <div className="text-[10px] text-slate-600 italic text-center py-2">No characters in descr_strat.txt</div>
            )}

            {filteredRecords.length > 0 && (
              <>
                <div className="flex items-center gap-2 py-1 mt-2">
                  <div className="flex-1 h-px bg-slate-800" />
                  <span className="text-[8px] text-slate-600 uppercase font-semibold flex items-center gap-1">
                    <Archive className="w-2.5 h-2.5" /> Character Records ({filteredRecords.length})
                  </span>
                  <div className="flex-1 h-px bg-slate-800" />
                </div>
                {filteredRecords.map((rec, idx) => (
                  <CharacterRecordRow
                    key={`${rec._faction}_${rec.name}_${idx}`}
                    rec={rec}
                    factionName={rec._faction}
                    onUpdate={(updated) => handleRecordUpdate(rec._faction, rec, updated)}
                  />
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
