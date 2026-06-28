import React, { useState, useEffect } from 'react';
import { useEDB } from './EDBContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Copy, Settings, Shield, Swords, Trash2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from
'@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

import { SETTLEMENT_TYPES, SETTLEMENT_LEVELS, MATERIALS } from './EDBParser';
import CapabilityEditor from './CapabilityEditor.jsx';
import RequirementBuilder from './RequirementBuilder';
import SearchableSelect from './SearchableSelect.jsx';
import { BuildingTreeTextEditor } from './BuildingTextEditor';
import UpgradesEditor from './UpgradesEditor';
import LevelCultureEditor from './LevelCultureEditor';
import GuildEditor from './GuildEditor';

export default function LevelEditor() {
  const { edbData, selectedBuilding, selectedLevel, setSelectedLevel, updateLevel, renameLevel, duplicateLevel, deleteLevel } = useEDB();

  if (!edbData || !selectedBuilding) {
    return (
      <div className="text-muted-foreground mx-auto pr-2 text-sm flex items-center justify-center h-full">
        Select a building or level to edit
      </div>);
  }

  const building = edbData.buildings.find((b) => b.name === selectedBuilding);
  if (!building) return null;

  if (!selectedLevel) {
    return <BuildingOverview building={building} edbData={edbData} />;
  }

  const levelIndex = building.levels.findIndex((l) => l.name === selectedLevel);
  const level = building.levels[levelIndex];
  if (!level) return null;

  return <LevelEditorInner
    building={building}
    level={level}
    levelIndex={levelIndex}
    selectedBuilding={selectedBuilding}
    selectedLevel={selectedLevel}
    setSelectedLevel={setSelectedLevel}
    updateLevel={updateLevel}
    renameLevel={renameLevel}
    duplicateLevel={duplicateLevel}
    deleteLevel={deleteLevel}
    edbData={edbData} />;

}

function LevelEditorInner({ building, level, levelIndex, selectedBuilding, selectedLevel, setSelectedLevel, updateLevel, renameLevel, duplicateLevel, deleteLevel, edbData }) {
  const update = (field, value) => updateLevel(selectedBuilding, selectedLevel, { [field]: value });

  const [localName, setLocalName] = useState(level.name);
  useEffect(() => {setLocalName(level.name);}, [level.name]);

  return (
    <ScrollArea className="h-full">
      <div className="bg-slate-950 pt-4 pr-4 pb-4 pl-4 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
            <Settings className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">{level.name}</h2>
            <p className="text-[10px] text-muted-foreground">
              {building.name} → Level {levelIndex + 1} · {level.settlementType}
            </p>
          </div>
          <Badge variant="outline" className="ml-auto text-[10px]">
            #{levelIndex + 1}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => duplicateLevel(building.name, level.name)}>
            <Copy className="w-3 h-3" /> Duplicate Level
          </Button>
          {building.levels.length > 1 &&
          <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive" className="h-7 px-2 text-xs gap-1">
                  <Trash2 className="w-3 h-3" /> Delete Level
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Level</AlertDialogTitle>
                  <AlertDialogDescription>Delete level "{level.name}" from "{building.name}"? This cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => {deleteLevel(building.name, level.name);setSelectedLevel(null);}}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        </div>

        {building.name.toLowerCase().startsWith('guild_') && (
          <GuildEditor buildingName={building.name} />
        )}

        <Card>
          <CardHeader className="flex flex-col space-y-1.5 p-3 pb-2">
            <CardTitle className="text-xs font-semibold">Core Attributes</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px] text-muted-foreground">Level Name</Label>
                <Input className="h-7 text-xs mt-1" value={localName}
                onChange={(e) => setLocalName(e.target.value)}
                onBlur={() => {
                  if (localName !== level.name) {
                    const renamed = renameLevel(selectedBuilding, selectedLevel, localName);
                    setLocalName(renamed || level.name);
                  }
                }} />
                
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Settlement Type</Label>
                <Select value={level.settlementType} onValueChange={(v) => update('settlementType', v)}>
                  <SelectTrigger className="h-7 text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SETTLEMENT_TYPES.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Material</Label>
                <Select value={level.material} onValueChange={(v) => update('material', v)}>
                  <SelectTrigger className="h-7 text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MATERIALS.map((m) => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Settlement Min</Label>
                <Select value={level.settlementMin} onValueChange={(v) => update('settlementMin', v)}>
                  <SelectTrigger className="h-7 text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SETTLEMENT_LEVELS.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Construction Time</Label>
                <Input className="h-7 text-xs mt-1" type="number" value={level.construction}
                onChange={(e) => update('construction', parseInt(e.target.value) || 0)} />
                
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Cost</Label>
                <Input className="h-7 text-xs mt-1" type="number" step="100" value={level.cost}
                onChange={(e) => update('cost', parseInt(e.target.value) || 0)} />
                
              </div>
              {building.convertTo &&
              <div className="col-span-2">
                  <Label className="text-[10px] text-muted-foreground">
                    Convert To Index
                    <span className="ml-1 text-muted-foreground/60">(auto-set from level position, editable)</span>
                  </Label>
                  <Input
                  className="h-7 text-xs mt-1"
                  type="number"
                  min="0"
                  placeholder="(none)"
                  value={level.convertTo !== null && level.convertTo !== undefined && level.convertTo !== '' ? level.convertTo : ''}
                  onChange={(e) => update('convertTo', e.target.value === '' ? null : parseInt(e.target.value))} />
                
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Building converts to <span className="text-primary font-mono">{building.convertTo}</span>. Auto-index: {levelIndex}
                  </p>
                </div>
              }
            </div>

            <UpgradesEditor
              upgrades={level.upgrades || []}
              onChange={(v) => update('upgrades', v)}
              allLevels={building.levels}
              currentLevelName={selectedLevel}
              edbData={edbData} />
            
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-primary" />
              Level Requirements
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <RequirementBuilder
              requirements={level.requirements || []}
              onChange={(reqs) => update('requirements', reqs)}
              edbData={edbData} />
            
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
              <Swords className="w-3.5 h-3.5 text-primary" />
              Capabilities ({level.capabilities.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <CapabilityEditor
              capabilities={level.capabilities}
              onChange={(caps) => update('capabilities', caps)}
              edbData={edbData} />
            
          </CardContent>
        </Card>

        <LevelCultureEditor levelName={level.name} />
      </div>
    </ScrollArea>);

}

function BuildingOverview({ building, edbData }) {
  const { updateBuilding, renameBuilding, duplicateBuilding, deleteBuilding, setSelectedBuilding } = useEDB();
  const [localName, setLocalName] = useState(building.name);
  useEffect(() => { setLocalName(building.name); }, [building.name]);
  const buildingOptions = edbData.buildings.
  map((b) => ({ value: b.name, label: b.name }));

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
            <Settings className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-foreground">{building.name}</h2>
            <p className="text-[10px] text-muted-foreground">
              {building.levels.length} levels · {building.convertTo ? `converts to ${building.convertTo}` : 'no conversion'}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => duplicateBuilding(building.name)}>
            <Copy className="w-3 h-3" /> Duplicate Tree
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" className="h-7 px-2 text-xs gap-1">
                <Trash2 className="w-3 h-3" /> Delete Tree
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Building Tree</AlertDialogTitle>
                <AlertDialogDescription>Delete "{building.name}" and all its {building.levels.length} levels? This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => {deleteBuilding(building.name);setSelectedBuilding(null);}}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs font-semibold">Building Properties</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-3">
            <div>
              <Label className="text-[10px] text-muted-foreground">Building Chain Name</Label>
              <Input
                className="h-7 text-xs mt-1 font-mono"
                value={localName}
                onChange={(e) => setLocalName(e.target.value)}
                onBlur={() => {
                  if (localName !== building.name) {
                    const renamed = renameBuilding(building.name, localName);
                    setLocalName(renamed || building.name);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setLocalName(building.name);
                }}
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Convert To</Label>
              <div className="mt-1">
                <SearchableSelect
                  value={building.convertTo || '__none__'}
                  onValueChange={(v) => updateBuilding(building.name, { convertTo: v === '__none__' ? null : v })}
                  options={buildingOptions}
                  placeholder="None"
                  noneOption />
                
              </div>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Levels</Label>
              <div className="flex gap-1 mt-1 flex-wrap">
                {building.levels.map((l, i) =>
                <Badge key={l.name} variant="outline" className="text-[10px]">
                    {i + 1}. {l.name} ({l.settlementType})
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <BuildingTreeTextEditor buildingName={building.name} />

        {building.name.toLowerCase().startsWith('guild_') && (
          <GuildEditor buildingName={building.name} />
        )}

        <p className="text-xs text-muted-foreground text-center pt-4">
          Select a level from the tree to edit its details
        </p>
      </div>
    </ScrollArea>);

}
