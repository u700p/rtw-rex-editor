import React, { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  CATEGORIES, CLASSES, VOICE_TYPES, ACCENTS, BANNER_FACTIONS, BANNER_HOLY,
  UNIT_ATTRIBUTES, OWNERSHIP_FACTIONS, MENTAL_TYPES, MENTAL_TRAINING, ARMOUR_MATERIALS,
} from './EDUParser';
import { Field, TextInput, NumberInput, SelectInput, Section, MultiCheckbox } from './UnitStatRow';
import { serializeUnit } from './EDUParser';
import UnitDescriptionTab from './UnitDescriptionTab';
import ModelDbPanel from './ModelDbPanel';
import OwnershipTab from './OwnershipTab';

// Parse a comma-separated stat string into an array
function splitStat(str, count) {
  const parts = (str || '').split(',').map(s => s.trim());
  while (parts.length < count) parts.push('');
  return parts;
}
function joinStat(parts) { return parts.join(', '); }

export default function UnitEditor({ unit, onChange, descr, onDescrChange, unitImages, onImageUpload, onImageDelete, modeldb, onUpdateModeldbEntry, onDownloadModeldb }) {
  const [tab, setTab] = useState('identity');

  const set = (key, val) => onChange({ ...unit, [key]: val });

  // Parse complex stats
  const health = splitStat(unit.stat_health, 2);
  const priParts = splitStat(unit.stat_pri, 12);
  const secParts = splitStat(unit.stat_sec, 12);
  const priArmour = splitStat(unit.stat_pri_armour, 4);
  const secArmour = splitStat(unit.stat_sec_armour, 3);
  const groundParts = splitStat(unit.stat_ground, 4);
  const mentalParts = splitStat(unit.stat_mental, 3);
  const costParts = splitStat(unit.stat_cost, 8);
  const formParts = splitStat(unit.formation, 7);
  const foodParts = splitStat(unit.stat_food, 2);

  const tabs = [
    { id: 'identity', label: 'Identity' },
    { id: 'combat', label: 'Combat' },
    { id: 'stats', label: 'Stats' },
    { id: 'ownership', label: 'Ownership' },
    { id: 'description', label: 'Description & Images' },
    { id: 'modeldb', label: 'ModelDB' },
    { id: 'preview', label: 'Preview' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0 px-3">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-[11px] font-medium border-b-2 transition-colors ${tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'modeldb' ? (
        <ModelDbPanel
          soldierModel={unit.soldier_model}
          unit={unit}
          modeldb={modeldb}
          onUpdateEntry={onUpdateModeldbEntry}
          onDownload={onDownloadModeldb}
        />
      ) : null}

      <ScrollArea className={`flex-1 ${tab === 'modeldb' ? 'hidden' : ''}`}>
        <div className="p-4 space-y-5">

          {/* ── Identity ── */}
          {tab === 'identity' && <>
            <Section title="Naming">
              <Field label="type" tooltip="Internal lookup name used by the game in most files. Use spaces.">
                <TextInput value={unit.type} onChange={v => set('type', v)} mono placeholder="e.g. Swiss Pikemen" />
              </Field>
              <Field label="dictionary" tooltip="Name used in unit cards and some files. Use underscores instead of spaces.">
                <TextInput value={unit.dictionary} onChange={v => set('dictionary', v)} mono placeholder="e.g. Swiss_Pikemen" />
              </Field>
              <Field label="display name" tooltip="Comment shown after ; in dictionary line — this becomes the in-game name.">
                <TextInput value={unit.dictionaryComment} onChange={v => set('dictionaryComment', v)} placeholder="e.g. Swiss Pikemen" />
              </Field>
            </Section>
            <Section title="Classification">
              <Field label="category" tooltip="Broad unit type: infantry, cavalry, siege, ship.">
                <SelectInput value={unit.category} onChange={v => set('category', v)} options={CATEGORIES} />
              </Field>
              <Field label="class" tooltip="Specific class. Determines AI behavior and sounds.">
                <SelectInput value={unit.class} onChange={v => set('class', v)} options={CLASSES} />
              </Field>
              <Field label="voice_type" tooltip="Voice set to use.">
                <SelectInput value={unit.voice_type} onChange={v => set('voice_type', v)} options={VOICE_TYPES} />
              </Field>
              <Field label="accent" tooltip="Optional. Forces a specific accent regardless of owning faction.">
                <SelectInput value={unit.accent} onChange={v => set('accent', v)} options={[{ value: '', label: '(faction default)' }, ...ACCENTS]} />
              </Field>
            </Section>
            <Section title="Banners">
              <Field label="banner faction" tooltip="Main battle banner type.">
                <SelectInput value={unit.banner_faction} onChange={v => set('banner_faction', v)} options={BANNER_FACTIONS} />
              </Field>
              <Field label="banner unit" tooltip="Optional secondary banner identifier.">
                <TextInput value={unit.banner_unit} onChange={v => set('banner_unit', v)} mono placeholder="e.g. dragon_standard" />
              </Field>
              <Field label="banner holy" tooltip="Banner shown during crusade/jihad. Set to none to omit.">
                <SelectInput value={unit.banner_holy} onChange={v => set('banner_holy', v)} options={BANNER_HOLY} />
              </Field>
            </Section>
            <Section title="Soldier Model">
              <Field label="model name" tooltip="References an entry in battle_models.modelsdb">
                <TextInput value={unit.soldier_model} onChange={v => set('soldier_model', v)} mono />
              </Field>
              <Field label="unit size" tooltip="Number of men. Min 4, max 60 (100 in Kingdoms). Scaled by game graphics settings.">
                <NumberInput value={unit.soldier_num} onChange={v => set('soldier_num', v)} min={4} max={100} />
              </Field>
              <Field label="extras" tooltip="Number of siege machines or extra models (e.g. 2 trebuchets).">
                <NumberInput value={unit.soldier_extras} onChange={v => set('soldier_extras', v)} min={0} max={10} />
              </Field>
              <Field label="mass" tooltip="Soldier mass (1 = normal). Higher mass = more knockback on charge. Ignored for cavalry (use mount instead).">
                <NumberInput value={unit.soldier_mass} onChange={v => set('soldier_mass', v)} min={0.1} max={5} step={0.1} />
              </Field>
            </Section>
            <Section title="Officers & Mount">
              <Field label="officer 1"><TextInput value={unit.officer1} onChange={v => set('officer1', v)} mono placeholder="Officer model name" /></Field>
              <Field label="officer 2"><TextInput value={unit.officer2} onChange={v => set('officer2', v)} mono placeholder="Officer model name" /></Field>
              <Field label="officer 3"><TextInput value={unit.officer3} onChange={v => set('officer3', v)} mono placeholder="Officer model name" /></Field>
              <Field label="mount" tooltip="Mount type, e.g. 'heavy horse'. Leave blank for foot units.">
                <TextInput value={unit.mount} onChange={v => set('mount', v)} mono placeholder="heavy horse" />
              </Field>
              <Field label="mount_effect" tooltip="e.g. +2 vs horses, -4 vs camels">
                <TextInput value={unit.mount_effect} onChange={v => set('mount_effect', v)} mono />
              </Field>
            </Section>
            <Section title="Attributes">
              <MultiCheckbox
                label="Unit attributes"
                allOptions={UNIT_ATTRIBUTES}
                selected={unit.attributes}
                onChange={v => set('attributes', v)}
              />
              <Field label="move_speed_mod" tooltip="Movement speed multiplier. Leave blank for default. e.g. 1.2">
                <TextInput value={unit.move_speed_mod} onChange={v => set('move_speed_mod', v)} mono placeholder="1.0" />
              </Field>
            </Section>
          </>}

          {/* ── Combat ── */}
          {tab === 'combat' && <>
            <Section title="Formation">
              <p className="text-[10px] text-muted-foreground">spacing, rank_spacing, deep_spacing, deep_rank_spacing, ranks, formation1[, formation2]</p>
              <div className="grid grid-cols-3 gap-2">
                {['Spacing', 'Rank Spacing', 'Deep Spacing', 'Deep Rank Sp.', 'Ranks'].map((lbl, i) => (
                  <div key={i}>
                    <label className="text-[10px] text-muted-foreground">{lbl}</label>
                    <input
                      value={formParts[i] || ''}
                      onChange={e => { const p = [...formParts]; p[i] = e.target.value; set('formation', joinStat(p)); }}
                      className="w-full h-6 px-1.5 text-xs font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                ))}
              </div>
              <Field label="formations">
                <TextInput
                  value={formParts.slice(5).join(', ')}
                  onChange={v => { const p = formParts.slice(0, 5); set('formation', joinStat([...p, v])); }}
                  mono placeholder="square, wedge"
                />
              </Field>
            </Section>

            <Section title="Primary Weapon (stat_pri)">
              <p className="text-[10px] text-muted-foreground">attack, charge_bonus, projectile, range, ammo, weapon_type, tech, damage_type, weapon, lethality, min_range, can_shoot_over_walls</p>
              <div className="grid grid-cols-3 gap-2">
                {[['Attack', 0], ['Charge Bonus', 1], ['Range', 3], ['Ammo', 4], ['Lethality', 9], ['Min Range', 10]].map(([lbl, idx]) => (
                  <div key={idx}>
                    <label className="text-[10px] text-muted-foreground">{lbl}</label>
                    <input
                      value={priParts[idx] || ''}
                      onChange={e => { const p = [...priParts]; p[idx] = e.target.value; set('stat_pri', joinStat(p)); }}
                      className="w-full h-6 px-1.5 text-xs font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[['Projectile', 2], ['Weapon Type', 5], ['Tech', 6], ['Damage Type', 7], ['Weapon', 8]].map(([lbl, idx]) => (
                  <div key={idx}>
                    <label className="text-[10px] text-muted-foreground">{lbl}</label>
                    <input
                      value={priParts[idx] || ''}
                      onChange={e => { const p = [...priParts]; p[idx] = e.target.value; set('stat_pri', joinStat(p)); }}
                      className="w-full h-6 px-1.5 text-xs font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                ))}
              </div>
              <Field label="stat_pri_attr" tooltip="Special weapon attributes, e.g. ap, fire, thrown">
                <TextInput value={unit.stat_pri_attr} onChange={v => set('stat_pri_attr', v)} mono />
              </Field>
            </Section>

            <Section title="Secondary Weapon (stat_sec)">
              <div className="grid grid-cols-3 gap-2">
                {[['Attack', 0], ['Charge Bonus', 1], ['Range', 3], ['Ammo', 4], ['Lethality', 9], ['Min Range', 10]].map(([lbl, idx]) => (
                  <div key={idx}>
                    <label className="text-[10px] text-muted-foreground">{lbl}</label>
                    <input
                      value={secParts[idx] || ''}
                      onChange={e => { const p = [...secParts]; p[idx] = e.target.value; set('stat_sec', joinStat(p)); }}
                      className="w-full h-6 px-1.5 text-xs font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[['Projectile', 2], ['Weapon Type', 5], ['Tech', 6], ['Damage Type', 7], ['Weapon', 8]].map(([lbl, idx]) => (
                  <div key={idx}>
                    <label className="text-[10px] text-muted-foreground">{lbl}</label>
                    <input
                      value={secParts[idx] || ''}
                      onChange={e => { const p = [...secParts]; p[idx] = e.target.value; set('stat_sec', joinStat(p)); }}
                      className="w-full h-6 px-1.5 text-xs font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                ))}
              </div>
              <Field label="stat_sec_attr">
                <TextInput value={unit.stat_sec_attr} onChange={v => set('stat_sec_attr', v)} mono />
              </Field>
            </Section>

            <Section title="Armour">
              <p className="text-[10px] text-muted-foreground">stat_pri_armour: armour_value, defence_skill, shield, material</p>
              <div className="grid grid-cols-4 gap-2">
                {['Armour', 'Defence Skill', 'Shield', 'Material'].map((lbl, i) => (
                  <div key={i}>
                    <label className="text-[10px] text-muted-foreground">{lbl}</label>
                    <input
                      value={priArmour[i] || ''}
                      onChange={e => { const p = [...priArmour]; p[i] = e.target.value; set('stat_pri_armour', joinStat(p)); }}
                      className="w-full h-6 px-1.5 text-xs font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">stat_sec_armour: armour_value, defence_skill, material</p>
              <div className="grid grid-cols-3 gap-2">
                {['Armour', 'Defence Skill', 'Material'].map((lbl, i) => (
                  <div key={i}>
                    <label className="text-[10px] text-muted-foreground">{lbl}</label>
                    <input
                      value={secArmour[i] || ''}
                      onChange={e => { const p = [...secArmour]; p[i] = e.target.value; set('stat_sec_armour', joinStat(p)); }}
                      className="w-full h-6 px-1.5 text-xs font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                ))}
              </div>
              <Field label="armour_ug_levels" tooltip="Number of armour upgrade levels">
                <TextInput value={unit.armour_ug_levels} onChange={v => set('armour_ug_levels', v)} mono />
              </Field>
              <Field label="armour_ug_models" tooltip="Model name(s) for armour upgrade visuals">
                <TextInput value={unit.armour_ug_models} onChange={v => set('armour_ug_models', v)} mono />
              </Field>
            </Section>
          </>}

          {/* ── Stats ── */}
          {tab === 'stats' && <>
            <Section title="Health">
              <div className="grid grid-cols-2 gap-2">
                {['Hit Points', 'Extra HP (mount/elephant)'].map((lbl, i) => (
                  <div key={i}>
                    <label className="text-[10px] text-muted-foreground">{lbl}</label>
                    <input value={health[i] || ''} onChange={e => { const p = [...health]; p[i] = e.target.value; set('stat_health', joinStat(p)); }}
                      className="w-full h-6 px-1.5 text-xs font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Morale & Mental">
              <p className="text-[10px] text-muted-foreground">stat_mental: morale, discipline, training</p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Morale</label>
                  <input value={mentalParts[0] || ''} onChange={e => { const p = [...mentalParts]; p[0] = e.target.value; set('stat_mental', joinStat(p)); }}
                    className="w-full h-6 px-1.5 text-xs font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Discipline</label>
                  <select value={mentalParts[1] || 'normal'} onChange={e => { const p = [...mentalParts]; p[1] = e.target.value; set('stat_mental', joinStat(p)); }}
                    className="w-full h-6 px-1.5 text-xs bg-background border border-border rounded focus:outline-none">
                    {MENTAL_TYPES.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Training</label>
                  <select value={mentalParts[2] || 'trained'} onChange={e => { const p = [...mentalParts]; p[2] = e.target.value; set('stat_mental', joinStat(p)); }}
                    className="w-full h-6 px-1.5 text-xs bg-background border border-border rounded focus:outline-none">
                    {MENTAL_TRAINING.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>
            </Section>

            <Section title="Ground & Heat">
              <p className="text-[10px] text-muted-foreground">stat_ground: scrub, sand, forest, snow  (negative = penalty)</p>
              <div className="grid grid-cols-4 gap-2">
                {['Scrub', 'Sand', 'Forest', 'Snow'].map((lbl, i) => (
                  <div key={i}>
                    <label className="text-[10px] text-muted-foreground">{lbl}</label>
                    <input value={groundParts[i] || ''} onChange={e => { const p = [...groundParts]; p[i] = e.target.value; set('stat_ground', joinStat(p)); }}
                      className="w-full h-6 px-1.5 text-xs font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                ))}
              </div>
              <Field label="stat_heat" tooltip="Heat penalty modifier. Higher = worse performance in hot climates.">
                <NumberInput value={unit.stat_heat} onChange={v => set('stat_heat', v)} min={0} max={10} />
              </Field>
            </Section>

            <Section title="Combat Modifiers">
              <Field label="stat_charge_dist" tooltip="Distance (in metres) at which the unit charges. Higher = faster charge trigger.">
                <NumberInput value={unit.stat_charge_dist} onChange={v => set('stat_charge_dist', v)} min={0} max={80} />
              </Field>
              <Field label="stat_fire_delay" tooltip="Delay between missile volleys (0 = no extra delay).">
                <NumberInput value={unit.stat_fire_delay} onChange={v => set('stat_fire_delay', v)} min={0} max={60} />
              </Field>
            </Section>

            <Section title="Food & Cost">
              <p className="text-[10px] text-muted-foreground">stat_food: food_consumed, siege_food</p>
              <div className="grid grid-cols-2 gap-2">
                {['Food Consumed', 'Siege Food'].map((lbl, i) => (
                  <div key={i}>
                    <label className="text-[10px] text-muted-foreground">{lbl}</label>
                    <input value={foodParts[i] || ''} onChange={e => { const p = [...foodParts]; p[i] = e.target.value; set('stat_food', joinStat(p)); }}
                      className="w-full h-6 px-1.5 text-xs font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">stat_cost: turns, cost, upkeep, upgrade_weapon, upgrade_armour, custom_limit, exp_requirement, move_pts</p>
              <div className="grid grid-cols-4 gap-2">
                {['Turns', 'Cost', 'Upkeep', 'Upg. Weapon', 'Upg. Armour', 'Custom Limit', 'Exp. Req.', 'Move Pts'].map((lbl, i) => (
                  <div key={i}>
                    <label className="text-[10px] text-muted-foreground">{lbl}</label>
                    <input value={costParts[i] || ''} onChange={e => { const p = [...costParts]; p[i] = e.target.value; set('stat_cost', joinStat(p)); }}
                      className="w-full h-6 px-1.5 text-xs font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                ))}
              </div>
            </Section>
          </>}

          {/* ── Ownership ── */}
          {tab === 'ownership' && (
            <OwnershipTab unit={unit} onChange={onChange} modeldb={modeldb} />
          )}

          {/* ── Description & Images ── */}
          {tab === 'description' && (
            <UnitDescriptionTab dictionary={unit.dictionary} descr={descr} onDescrChange={onDescrChange} unitImages={unitImages} onImageUpload={onImageUpload} onImageDelete={onImageDelete} />
          )}

          {/* ── Preview ── */}
          {tab === 'preview' && (
            <Section title="Raw EDU Output">
              <p className="text-[10px] text-muted-foreground mb-2">This is the exact text that will be written to export_descr_unit.txt.</p>
              <pre className="bg-background border border-border rounded p-3 text-[11px] font-mono text-foreground/80 overflow-auto whitespace-pre">
                {serializeUnit(unit)}
              </pre>
            </Section>
          )}

        </div>
      </ScrollArea>
    </div>
  );
}