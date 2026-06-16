import React, { useState } from 'react';
import { useEDB } from './EDBContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ChevronRight, ChevronDown, Castle, Layers, Plus, Trash2, Search, AlertTriangle, GripVertical } from
'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from
'@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from
'@/components/ui/dialog';

const PREFIXES = [
{ value: 'none', label: '(no prefix)', hint: 'Default — normal building' },
{ value: 'core_', label: 'core_', hint: 'Upgrades settlement to next level' },
{ value: 'hinterland_', label: 'hinterland_', hint: 'Cannot be demolished for cash' },
{ value: 'temple_', label: 'temple_', hint: 'Only one temple_ building per settlement' },
{ value: 'guild_', label: 'guild_', hint: 'Guild — needs entry in export_descr_guilds.txt (max 3 levels)' }];


function BuildingNode({ building, dragHandleProps }) {
  const { selectedBuilding, setSelectedBuilding, selectedLevel, setSelectedLevel,
    deleteBuilding, addLevel, deleteLevel } = useEDB();
  const [expanded, setExpanded] = useState(selectedBuilding === building.name);
  const isSelected = selectedBuilding === building.name && !selectedLevel;

  const handleSelect = () => {
    setSelectedBuilding(building.name);
    setSelectedLevel(null);
    setExpanded(true);
  };

  return (
    <div className="mb-0.5">
      <div className="bg-primary/15 text-primary pr-2 text-sm rounded-md flex items-center gap-1 cursor-pointer group transition-colors">
        <span {...dragHandleProps} onClick={e => e.stopPropagation()} className="pl-1 text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing shrink-0">
          <GripVertical className="w-3 h-3" />
        </span>

        

        <button onClick={() => setExpanded(!expanded)} className="p-0.5 hover:bg-accent rounded">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <Castle className="w-3.5 h-3.5 text-primary/60 shrink-0" />
        <span onClick={handleSelect} className="flex-1 truncate font-medium text-xs">
          {building.name}
        </span>
        <span className="text-muted-foreground">
          {building.levels.length}L
        </span>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className="pr-2 pl-2 rounded hover:bg-destructive/20 transition-opacity" title="Delete building tree">
              <Trash2 className="w-3 h-3 text-destructive" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Building</AlertDialogTitle>
              <AlertDialogDescription>
                Delete "{building.name}" and all its levels? This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteBuilding(building.name)}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {expanded &&
      <div className="mr-6 ml-4 border-l border-border/50">
          {building.levels.map((level, li) => {
          const isLevelSelected = selectedBuilding === building.name && selectedLevel === level.name;
          const levelNum = li + 1;
          const levelCls = isLevelSelected ?
          'bg-primary/15 text-primary' :
          'hover:bg-accent text-muted-foreground hover:text-foreground';
          return (
            <div key={level.name}>
                {levelNum === 9 &&
              <div className="flex items-center gap-1 px-2 py-0.5 text-[9px] text-yellow-500 bg-yellow-500/10 rounded mb-0.5">
                    <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                    Level 9 is the vanilla Rome limit.
                  </div>
              }
                {levelNum > 50 &&
              <div className="flex items-center gap-1 px-2 py-0.5 text-[9px] text-orange-400 bg-orange-500/10 rounded mb-0.5">
                    <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                    {"Level " + levelNum + ": beyond vanilla Rome limits."}
                  </div>
              }
                <div className="text-muted-foreground pt-1 pr-2 pb-1 pl-2 text-xs rounded-md flex items-center gap-1.5 cursor-pointer group transition-colors hover:bg-accent hover:text-foreground"

              onClick={() => {setSelectedBuilding(building.name);setSelectedLevel(level.name);}}>

                  <Layers className="w-3 h-3 shrink-0" />
                  <span className="flex-1 truncate">{level.name}</span>
                  <span className="text-[10px] opacity-60">{level.settlementType}</span>
                  {building.levels.length > 1 &&
                <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                      onClick={(e) => e.stopPropagation()}
                      className="p-0.5 hover:bg-destructive/20 rounded" title="Delete level">

                          <Trash2 className="w-2.5 h-2.5 text-destructive" />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Level</AlertDialogTitle>
                          <AlertDialogDescription>Delete level "{level.name}"?</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteLevel(building.name, level.name)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                }
                </div>
              </div>);

        })}
          <button
          onClick={() => addLevel(building.name)}
          className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-muted-foreground hover:text-primary transition-colors w-full">

            <Plus className="w-2.5 h-2.5" /> Add Level
          </button>
        </div>
      }
    </div>);

}

export default function BuildingTree() {
  const { edbData, addBuilding, reorderBuildings } = useEDB();
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newPrefix, setNewPrefix] = useState('none');
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!edbData) return null;

  const filtered = edbData.buildings.filter((b) =>
  b.name.toLowerCase().includes(search.toLowerCase()) ||
  b.levels.some((l) => l.name.toLowerCase().includes(search.toLowerCase()))
  );

  const handleAddBuilding = () => {
    const baseName = newName.trim().replace(/\s+/g, '_');
    const prefix = newPrefix === 'none' ? '' : newPrefix;
    if (baseName) {
      addBuilding(prefix + baseName);
      setNewName('');
      setNewPrefix('');
      setDialogOpen(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-3 border-b border-border space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold text-foreground uppercase tracking-wider flex-1">Buildings</h2>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="bg-slate-500 text-primary px-2 text-sm font-medium rounded-md inline-flex items-center justify-center whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border shadow-sm hover:text-accent-foreground h-6 gap-1 border-primary/30 hover:bg-primary/10">
                <Plus className="w-3 h-3" /> "Add a new building tree"
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Building Tree</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-1">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Prefix</label>
                  <Select value={newPrefix} onValueChange={setNewPrefix}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="(no prefix)" />
                    </SelectTrigger>
                    <SelectContent>
                      {PREFIXES.map((p) =>
                      <SelectItem key={p.value} value={p.value} className="text-xs">
                          <div>
                            <span className="font-mono font-semibold">{p.label}</span>
                            <span className="ml-2 text-muted-foreground">{p.hint}</span>
                          </div>
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {newPrefix &&
                  <p className="text-[10px] text-primary mt-1">{PREFIXES.find((p) => p.value === newPrefix)?.hint}</p>
                  }
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Base name</label>
                  <Input
                    placeholder="building_name (use underscores)"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddBuilding()}
                    className="h-8 text-xs" />

                  {newName &&
                  <p className="text-[10px] text-muted-foreground mt-1">Result: <span className="font-mono text-foreground">{newPrefix}{newName.trim().replace(/\s+/g, '_')}</span></p>
                  }
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleAddBuilding} disabled={!newName.trim()}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs pl-7" />

        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="mx-auto pt-2 pr-2 pb-2 pl-1">
          <DragDropContext onDragEnd={(result) => {
            if (!result.destination || result.destination.index === result.source.index) return;
            // Map filtered indices back to edbData.buildings indices
            const fromBuilding = filtered[result.source.index];
            const toBuilding = filtered[result.destination.index];
            const allBuildings = edbData.buildings;
            const fromIdx = allBuildings.findIndex(b => b.name === fromBuilding.name);
            const toIdx = allBuildings.findIndex(b => b.name === toBuilding.name);
            reorderBuildings(fromIdx, toIdx);
          }}>
            <Droppable droppableId="buildings-list">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps}>
                  {filtered.map((building, idx) => (
                    <Draggable key={building.name} draggableId={building.name} index={idx}>
                      {(drag) => (
                        <div ref={drag.innerRef} {...drag.draggableProps}>
                          <BuildingNode building={building} dragHandleProps={drag.dragHandleProps} />
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                  {filtered.length === 0 &&
                    <p className="text-xs text-muted-foreground text-center py-8">No buildings found</p>
                  }
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>
      </ScrollArea>
    </div>);

}
