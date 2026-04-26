import React from 'react';
import { SmFactionsProvider, useSmFactions } from '../components/smfactions/SmFactionsContext';
import SmFactionsFileLoader from '../components/smfactions/SmFactionsFileLoader';
import SmFactionList from '../components/smfactions/SmFactionList';
import SmFactionEditor from '../components/smfactions/SmFactionEditor';
import { Shield, Users } from 'lucide-react';

function SmFactionsEditorInner() {
  const { factions, loaded } = useSmFactions();

  if (!loaded) {
    return (
      <div className="flex flex-col h-full">
        <SmFactionsFileLoader />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Factions File Editor</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Load <code className="text-xs bg-muted px-1 rounded">data/descr_sm_factions.txt</code> to
              view and edit all campaign factions — or create new ones from scratch (e.g. a custom
              <code className="text-xs bg-muted px-1 ml-1 rounded">laos</code> faction).
            </p>
          </div>
          <div className="text-xs text-muted-foreground bg-muted/50 rounded p-3 text-left max-w-sm space-y-1">
            <p className="font-medium">Supported fields:</p>
            <p>🎨 Primary &amp; secondary colours</p>
            <p>🌍 Culture, religion, AI settings</p>
            <p>🏰 Symbol, loading logo paths</p>
            <p>⚙️ All CAI modifier tuning values</p>
            <p>➕ Create new factions with defaults</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: '100vh' }}>
      <SmFactionsFileLoader />
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Sidebar */}
        <div className="w-60 shrink-0 border-r border-border overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold text-foreground">Factions</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{factions.length}</span>
          </div>
          <SmFactionList />
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <SmFactionEditor />
        </div>
      </div>
    </div>
  );
}

export default function SmFactionsEditor() {
  return (
    <SmFactionsProvider>
      <SmFactionsEditorInner />
    </SmFactionsProvider>
  );
}
