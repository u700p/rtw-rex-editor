import React, { useState } from 'react';
import { DescrModelBattleProvider, useDescrModelBattle } from '../components/battlemods/DescrModelBattleContext';
import DescrModelBattleFileLoader from '../components/battlemods/DescrModelBattleFileLoader';
import DescrModelBattleList from '../components/battlemods/DescrModelBattleList';
import DescrModelBattleEntryEditor from '../components/battlemods/DescrModelBattleEntryEditor';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Swords, Database, FileText } from 'lucide-react';

// ─── battlemodel.db tab ───────────────────────────────────────────────────────

function BmdbEntry({ entry, isSelected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 rounded text-[11px] font-mono transition-colors ${
        isSelected ? 'bg-primary/15 text-primary' : 'hover:bg-muted/60 text-foreground'
      }`}
    >
      {entry.name}
    </button>
  );
}

function BmdbViewer() {
  const { bmdbData, selectedBmdbEntry, setSelectedBmdbEntry } = useDescrModelBattle();
  const [search, setSearch] = useState('');

  if (!bmdbData) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-8 text-center">
        Load a <code className="text-xs bg-muted px-1 rounded">battlemodel.db</code> / <code className="text-xs bg-muted px-1 rounded">battle_models.modeldb</code> file using the toolbar above
      </div>
    );
  }

  const entries = bmdbData.entries ?? [];
  const filtered = search
    ? entries.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
    : entries;

  const entry = selectedBmdbEntry
    ? entries.find(e => e.name === selectedBmdbEntry) ?? null
    : null;

  return (
    <div className="flex flex-1 overflow-hidden min-h-0">
      {/* sidebar */}
      <div className="w-56 border-r border-border flex flex-col shrink-0">
        <div className="p-2 border-b border-border">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search entries…"
            className="w-full h-6 px-2 text-[11px] font-mono bg-muted/50 border border-border rounded focus:outline-none"
          />
        </div>
        <ScrollArea className="flex-1">
          <div className="p-1 space-y-0.5">
            {filtered.map(e => (
              <BmdbEntry
                key={e.name}
                entry={e}
                isSelected={selectedBmdbEntry === e.name}
                onClick={() => setSelectedBmdbEntry(e.name === selectedBmdbEntry ? null : e.name)}
              />
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* detail panel */}
      <ScrollArea className="flex-1 min-h-0">
        {!entry ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-8">
            Select an entry to inspect
          </div>
        ) : (
          <div className="p-3 space-y-3 font-mono text-[11px] max-w-2xl">
            <div className="text-sm font-bold text-foreground">{entry.name}</div>
            <div className="text-muted-foreground">scale: {entry.scale}</div>

            {/* LODs */}
            {entry.meshes?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">LODs ({entry.meshes.length})</div>
                {entry.meshes.map((m, i) => (
                  <div key={i} className="flex gap-2 text-foreground">
                    <span className="text-muted-foreground w-4">{i}</span>
                    <span className="flex-1 truncate">{m.path}</span>
                    <span className="text-muted-foreground">{m.dist}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Factions */}
            {entry.factions?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Factions ({entry.factions.length})</div>
                {entry.factions.map((f, i) => (
                  <div key={i} className="space-y-0.5 border border-border rounded p-1.5 mb-1">
                    <div className="font-semibold text-foreground">{f.faction || '(all)'}</div>
                    {f.texture   && <div className="text-muted-foreground truncate">tex: {f.texture}</div>}
                    {f.normalTex && <div className="text-muted-foreground truncate">nrm: {f.normalTex}</div>}
                    {f.sprite    && <div className="text-muted-foreground truncate">spr: {f.sprite}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Mount types */}
            {entry.mountTypes?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Mount types ({entry.mountTypes.length})</div>
                {entry.mountTypes.map((mt, i) => (
                  <div key={i} className="border border-border rounded p-1.5 mb-1 space-y-0.5">
                    <div className="font-semibold text-foreground">{mt.mountType}</div>
                    <div className="text-muted-foreground">pri: {mt.primarySkeleton}</div>
                    <div className="text-muted-foreground">sec: {mt.secondarySkeleton}</div>
                    {mt.primaryWeapons?.length > 0   && <div className="text-muted-foreground">wpn-pri: {mt.primaryWeapons.join(', ')}</div>}
                    {mt.secondaryWeapons?.length > 0 && <div className="text-muted-foreground">wpn-sec: {mt.secondaryWeapons.join(', ')}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Torch */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Torch</div>
              <div className="text-foreground">bone index: {entry.torchBoneIndex}</div>
              {entry.torch && (
                <div className="text-muted-foreground">
                  tx:{entry.torch[0]} ty:{entry.torch[1]} tz:{entry.torch[2]}{' '}
                  rx:{entry.torch[3]} ry:{entry.torch[4]} rz:{entry.torch[5]}
                </div>
              )}
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ─── Page shell ───────────────────────────────────────────────────────────────

const TABS = [
  { id: 'dmb',  label: 'descr_model_battle.txt', Icon: FileText },
  { id: 'bmdb', label: 'battlemodel.db',          Icon: Database },
];

function BattleModelsEditorInner() {
  const [tab, setTab] = useState('dmb');
  const { dmbData, bmdbData } = useDescrModelBattle();

  return (
    <div className="h-screen flex flex-col">
      {/* Title bar */}
      <div className="h-10 border-b border-border flex items-center px-4 gap-3 shrink-0 bg-card/50">
        <Swords className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Battle Models Editor</span>
        <span className="text-[10px] text-muted-foreground font-mono hidden lg:block">
          — descr_model_battle.txt &amp; battlemodel.db
        </span>
      </div>

      {/* File loader toolbar */}
      <DescrModelBattleFileLoader />

      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0 bg-card/30">
        {TABS.map(({ id, label, Icon }) => {
          const hasData = id === 'dmb' ? !!dmbData : !!bmdbData;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-[11px] font-semibold border-b-2 transition-colors ${
                tab === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              {hasData && <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block ml-0.5" />}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === 'dmb' && (
        <>
          {!dmbData ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <FileText className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">descr_model_battle.txt Editor</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  Load <code className="text-xs bg-muted px-1 rounded">data/descr_model_battle.txt</code> to
                  edit unit battle model assignments, textures, LOD meshes, skeleton references and more.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 overflow-hidden min-h-0">
              <div className="w-56 border-r border-border flex flex-col shrink-0">
                <div className="px-3 py-2 border-b border-border flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-semibold">Entries</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{dmbData.entries.length}</span>
                </div>
                <DescrModelBattleList />
              </div>
              <DescrModelBattleEntryEditor />
            </div>
          )}
        </>
      )}

      {tab === 'bmdb' && (
        <div className="flex flex-1 overflow-hidden min-h-0">
          <BmdbViewer />
        </div>
      )}
    </div>
  );
}

export default function BattleModelsEditor() {
  return (
    <DescrModelBattleProvider>
      <BattleModelsEditorInner />
    </DescrModelBattleProvider>
  );
}
