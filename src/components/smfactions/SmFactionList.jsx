import React, { useState } from 'react';
import { useSmFactions } from './SmFactionsContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Search } from 'lucide-react';

function FactionColourDot({ colour }) {
  if (!colour) return null;
  return (
    <span
      className="inline-block w-3 h-3 rounded-full border border-border shrink-0"
      style={{ background: `rgb(${colour.r},${colour.g},${colour.b})` }}
    />
  );
}

export default function SmFactionList() {
  const { factions, selected, setSelected, addFaction, removeFaction, loaded } = useSmFactions();
  const [search,  setSearch]  = useState('');
  const [newName, setNewName] = useState('');
  const [showNew, setShowNew] = useState(false);

  const filtered = search
    ? factions.filter(f => f.name.toLowerCase().includes(search.toLowerCase()))
    : factions;

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    addFaction(name);
    setNewName('');
    setShowNew(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-2 border-b border-border">
        <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 rounded border border-border">
          <Search className="w-3 h-3 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search factions…"
            className="flex-1 text-[11px] bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-1 space-y-0.5">
          {filtered.length === 0 && (
            <div className="text-[10px] text-muted-foreground text-center py-6">
              {loaded ? 'No factions match' : 'Load descr_sm_factions.txt to start'}
            </div>
          )}
          {filtered.map(f => (
            <div
              key={f.name}
              className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-[11px] font-mono transition-colors ${
                selected === f.name
                  ? 'bg-primary/15 text-primary'
                  : 'hover:bg-muted/60 text-foreground'
              }`}
              onClick={() => setSelected(f.name)}
            >
              <FactionColourDot colour={f.primary_colour} />
              <span className="flex-1 truncate">{f.name}</span>
              {f.culture && (
                <span className="text-[9px] text-muted-foreground hidden group-hover:hidden">{f.culture.slice(0, 4)}</span>
              )}
              <button
                onClick={ev => { ev.stopPropagation(); removeFaction(f.name); }}
                className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Add new faction */}
      <div className="p-2 border-t border-border">
        {showNew ? (
          <div className="flex gap-1">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowNew(false); }}
              placeholder="faction_name"
              autoFocus
              className="flex-1 h-6 px-1.5 text-[11px] font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={handleAdd}>Add</Button>
            <Button size="sm" variant="ghost"   className="h-6 px-2 text-[10px]" onClick={() => setShowNew(false)}>✕</Button>
          </div>
        ) : (
          <Button
            size="sm" variant="outline"
            className="w-full h-7 text-[11px] gap-1"
            onClick={() => setShowNew(true)}
          >
            <Plus className="w-3 h-3" /> New Faction
          </Button>
        )}
      </div>
    </div>
  );
}
