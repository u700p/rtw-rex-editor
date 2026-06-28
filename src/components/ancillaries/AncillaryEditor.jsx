import React from 'react';
import { useAncillaries } from './AncillariesContext';
import { useModData } from '../shared/ModDataContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, ImageOff, Wand2 } from 'lucide-react';
import EffectAttributeSelect from '../shared/EffectAttributeSelect';
import TriggerEditor from '../shared/TriggerEditor';
import ValidationPanel from '../shared/ValidationPanel';
import { buildEffectsDescription, validateAncillariesData } from '../shared/effectsDescriptionBuilder';

const ANCILLARY_TYPES = [
  'Academic', 'Court', 'Diplomacy', 'Entertain', 'Family',
  'Health', 'Item', 'Magic', 'Military', 'Money', 'Naval',
  'Pet', 'Politics', 'Relic', 'Religion', 'Security', 'Sex',
];
const CULTURES = ['roman', 'barbarian', 'greek', 'carthaginian', 'eastern', 'egyptian'];

const inputCls = 'h-8 text-xs font-mono mt-1 text-white bg-background';
const selectCls = 'w-full h-8 mt-1 text-xs bg-card border border-border rounded px-2 text-white';
const textareaCls = 'w-full mt-1 text-xs bg-background border border-border rounded px-2 py-1.5 text-white resize-y focus:outline-none focus:ring-1 focus:ring-primary';

// \n\n is used as an in-game text line break
function PreviewText({ text }) {
  if (!text) return null;
  const parts = text.split('\\n\\n');
  return (
    <span>
      {parts.map((p, i) => (
        <React.Fragment key={i}>{p}{i < parts.length - 1 && <br />}</React.Fragment>
      ))}
    </span>
  );
}

export default function AncillaryEditor() {
  const { ancData, selectedAnc, updateAncillary, getText, getTgaImage, updateTextEntry, renameTextKey, updateTrigger, addTrigger, deleteTrigger } = useAncillaries();
  useModData(); // ensure context is consumed (data flows through TriggerEditor via useModData)

  if (selectedAnc === null || !ancData) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">Select an ancillary from the list to edit it</p>
      </div>
    );
  }

  const anc = ancData.ancillaries[selectedAnc];
  if (!anc) return null;

  const update = (field, value) => {
    if (field === 'name') {
      const oldName = anc.name;
      const newName = value;
      const renamedAnc = { ...anc, name: newName };
      if (anc.description && anc.description.startsWith(oldName)) {
        const newKey = newName + anc.description.slice(oldName.length);
        renameTextKey(anc.description, newKey);
        renamedAnc.description = newKey;
      }
      if (anc.effectsDescription && anc.effectsDescription.startsWith(oldName)) {
        const newKey = newName + anc.effectsDescription.slice(oldName.length);
        renameTextKey(anc.effectsDescription, newKey);
        renamedAnc.effectsDescription = newKey;
      }
      updateAncillary(selectedAnc, renamedAnc);
      return;
    }
    updateAncillary(selectedAnc, { ...anc, [field]: value });
  };

  const toggleCulture = (culture) => {
    const cultures = anc.excludeCultures.includes(culture)
      ? anc.excludeCultures.filter(c => c !== culture)
      : [...anc.excludeCultures, culture];
    update('excludeCultures', cultures);
  };

  const addEffect = () => update('effects', [...anc.effects, { attribute: 'Command', value: 1 }]);
  const updateEffect = (i, field, value) => {
    const effects = anc.effects.map((e, j) => j === i ? { ...e, [field]: value } : e);
    update('effects', effects);
  };
  const deleteEffect = (i) => update('effects', anc.effects.filter((_, j) => j !== i));

  const descText = getText(anc.description);
  const effectsText = getText(anc.effectsDescription);
  const displayName = getText(anc.name) || getText(anc.description?.replace('_desc', ''));
  const tgaDataUrl = getTgaImage(anc.image);

  // All triggers that acquire this ancillary
  const allTriggers = ancData.triggers || [];
  const relatedTriggerIndices = allTriggers
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.acquireAncillary?.name === anc.name);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-5">

        {/* Preview banner */}
        <div className="bg-primary/10 border border-primary/20 rounded px-3 py-2 flex items-start gap-3">
          <div className="shrink-0 w-14 h-14 rounded border border-border bg-card/50 flex items-center justify-center overflow-hidden">
            {tgaDataUrl
              ? <img src={tgaDataUrl} alt={anc.image} className="w-full h-full object-contain" />
              : <ImageOff className="w-5 h-5 text-muted-foreground/30" />
            }
          </div>
          <div className="flex-1 min-w-0">
            {displayName
              ? <p className="text-sm font-medium text-primary">{displayName}</p>
              : <p className="text-sm font-medium text-muted-foreground font-mono">{anc.name}</p>
            }
            {descText && (
              <p className="text-xs text-muted-foreground mt-0.5 italic">
                <PreviewText text={descText} />
              </p>
            )}
            {effectsText && (
              <p className="text-[10px] text-muted-foreground mt-1">
                <PreviewText text={effectsText} />
              </p>
            )}
            {!tgaDataUrl && anc.image && (
              <p className="text-[10px] text-muted-foreground/50 mt-1 font-mono">
                Image: {anc.image} (load .tga folder to preview)
              </p>
            )}
          </div>
        </div>

        {/* Core fields */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-[10px] text-muted-foreground">Ancillary Name (ID)</Label>
            <Input value={anc.name} onChange={e => update('name', e.target.value)} className={inputCls} />
          </div>
          <div className="col-span-2">
            <Label className="text-[10px] text-amber-400">Display Name <span className="text-muted-foreground">(text key: {anc.name})</span></Label>
            <Input
              value={getText(anc.name) || ''}
              onChange={e => updateTextEntry(anc.name, e.target.value)}
              className="h-8 text-xs font-mono mt-1 text-amber-300 bg-background border-amber-500/40 focus:border-amber-400"
              placeholder="Enter display name…"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Type</Label>
            <select value={anc.type} onChange={e => update('type', e.target.value)} className={selectCls}>
              {ANCILLARY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Image filename</Label>
            <Input value={anc.image} onChange={e => update('image', e.target.value)}
              className={inputCls} placeholder="e.g. court_noble.tga" />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Excluded Ancillaries</Label>
            <Input
              value={anc.excludedAncillaries.join(', ')}
              onChange={e => update('excludedAncillaries', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
              className={inputCls} placeholder="comma separated"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Transferable</Label>
            <select value={anc.transferable} onChange={e => update('transferable', parseInt(e.target.value))} className={selectCls}>
              <option value={0}>No (0)</option>
              <option value={1}>Yes (1)</option>
            </select>
          </div>
        </div>

        {/* Toggles */}
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={anc.unique} onChange={e => update('unique', e.target.checked)} className="rounded" />
            <span className="text-xs text-white">Unique</span>
          </label>
        </div>

        {/* Text fields */}
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground">Description</Label>
              <span className="text-[9px] text-muted-foreground/50 font-mono">{anc.description}</span>
            </div>
            <textarea
              rows={4}
              className={textareaCls}
              value={descText}
              onChange={e => anc.description && updateTextEntry(anc.description, e.target.value)}
              placeholder={anc.description ? 'Enter description text… (use \\n\\n for line break)' : 'No description key set'}
              disabled={!anc.description}
            />
            {descText && (
              <p className="text-[10px] text-muted-foreground mt-1 bg-muted/20 rounded px-2 py-1 italic leading-relaxed">
                <PreviewText text={descText} />
              </p>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label className="text-[10px] text-muted-foreground">Effects Description</Label>
                {anc.effectsDescription && anc.effects.length > 0 && (
                  <button
                    type="button"
                    onClick={() => updateTextEntry(anc.effectsDescription, buildEffectsDescription(anc.effects))}
                    className="flex items-center gap-0.5 text-[9px] text-primary hover:underline"
                    title="Auto-generate from effects"
                  >
                    <Wand2 className="w-2.5 h-2.5" /> Auto
                  </button>
                )}
              </div>
              <span className="text-[9px] text-muted-foreground/50 font-mono">{anc.effectsDescription}</span>
            </div>
            <textarea
              rows={3}
              className={textareaCls}
              value={effectsText}
              onChange={e => anc.effectsDescription && updateTextEntry(anc.effectsDescription, e.target.value)}
              placeholder={anc.effectsDescription ? 'Enter effects description text…' : 'No effects description key set'}
              disabled={!anc.effectsDescription}
            />
          </div>
        </div>

        {/* Exclude Cultures */}
        <div>
          <Label className="text-[10px] text-muted-foreground">Exclude Cultures</Label>
          <div className="flex flex-wrap gap-1 mt-1">
            {CULTURES.map(culture => (
              <button key={culture} onClick={() => toggleCulture(culture)}
                className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                  anc.excludeCultures.includes(culture)
                    ? 'bg-destructive/20 border-destructive text-destructive'
                    : 'bg-card border-border text-muted-foreground hover:border-foreground'
                }`}>
                {culture}
              </button>
            ))}
          </div>
        </div>

        {/* Effects */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Effects</Label>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] text-white" onClick={addEffect}>
              <Plus className="w-3 h-3 mr-1" /> Add Effect
            </Button>
          </div>
          <div className="space-y-1.5">
            {anc.effects.map((effect, i) => (
              <div key={i} className="flex items-center gap-2 bg-card/50 rounded border border-border px-2 py-1.5">
                <EffectAttributeSelect
                  value={effect.attribute}
                  onChange={v => updateEffect(i, 'attribute', v)}
                  className="flex-1"
                />
                <Input type="number" value={effect.value}
                  onChange={e => updateEffect(i, 'value', parseInt(e.target.value) || 0)}
                  className="h-6 text-xs w-20 text-white bg-background" />
                <button onClick={() => deleteEffect(i)} className="p-0.5 hover:bg-destructive/20 rounded shrink-0">
                  <Trash2 className="w-3 h-3 text-destructive" />
                </button>
              </div>
            ))}
            {anc.effects.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No effects defined</p>
            )}
          </div>
        </div>

        {/* Triggers */}
        <TriggerEditor
          triggers={relatedTriggerIndices.map(({ t }) => t)}
          onUpdate={(localIdx, updated) => updateTrigger(relatedTriggerIndices[localIdx].i, updated)}
          onAdd={addTrigger}
          onDelete={(localIdx) => deleteTrigger(relatedTriggerIndices[localIdx].i)}
          entityName={anc.name}
          mode="ancillary"
        />

        {/* Validation */}
        <ValidationPanel onValidate={() => validateAncillariesData(ancData, getText)} watchData={ancData} />
      </div>
    </div>
  );
}
