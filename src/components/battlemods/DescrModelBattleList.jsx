import React, { useState } from 'react';
import { useDescrModelBattle } from './DescrModelBattleContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Search } from 'lucide-react';

export default function DescrModelBattleList() {
  const { dmbData, selectedType, setSelectedType, addDmbEntry, removeDmbEntry } = useDescrModelBattle();
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [showNew, setShowNew] = useState(false);

  const entries = dmbData?.entries ?? [];
  const filtered = search
    ? entries.filter(e => (e.type || e.name || '').toLowerCase().includes(search.toLowerCase()))
    : entries;

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    addDmbEntry(name);
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
            placeholder="Search types…"
            className="flex-1 text-[11px] bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-1 space-y-0.5">
          {filtered.length === 0 && (
            <div className="text-[10px] text-muted-foreground text-center py-6">
              {dmbData ? 'No entries match' : 'Load descr_model_battle.txt to start'}
            </div>
          )}
          {filtered.map(e => (
            <div
              key={e.type || e.name}
              className={`group flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer text-[11px] font-mono transition-colors ${
                selectedType === (e.type || e.name)
                  ? 'bg-primary/15 text-primary'
                  : 'hover:bg-muted/60 text-foreground'
              }`}
              onClick={() => setSelectedType(e.type || e.name)}
            >
              <span className="flex-1 truncate">{e.type || e.name}</span>
              <button
                onClick={ev => { ev.stopPropagation(); removeDmbEntry(e.type || e.name); }}
                className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Add new */}
      <div className="p-2 border-t border-border">
        {showNew ? (
          <div className="flex gap-1">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowNew(false); }}
              placeholder="unit_type_name"
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
            disabled={!dmbData}
          >
            <Plus className="w-3 h-3" /> New Entry
          </Button>
        )}
      </div>
    </div>
  );
}
