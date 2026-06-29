import React, { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, Shield, Sparkles, Gem, Users, LayoutTemplate } from 'lucide-react';
import RebelFactionsTab from '../components/minorfiles/RebelFactionsTab';
import ReligionsTab from '../components/minorfiles/ReligionsTab';
import ResourcesTab from '../components/minorfiles/ResourcesTab';
import CharacterNamesTab from '../components/minorfiles/CharacterNamesTab';
import SpriteSheetsTab from '../components/minorfiles/spritesheet/SpriteSheetsTab';
import StratMapCharTab from '../components/minorfiles/stratmap/StratMapCharTab';

const TABS = [
  { id: 'rebels', label: 'Rebel Factions', Icon: Shield, description: 'descr_rebel_factions.txt + rebel_faction_descr.txt' },
  { id: 'religions', label: 'Religions', Icon: Sparkles, description: 'descr_religions.txt + religions.txt' },
  { id: 'resources', label: 'Resources', Icon: Gem, description: 'descr_sm_resources.txt + strat.txt' },
  { id: 'names', label: 'Faction Names', Icon: Users, description: 'descr_names.txt + names.txt' },
  { id: 'spritesheets', label: 'UI Sprites', Icon: LayoutTemplate, description: 'strategy.sd.xml / battle.sd.xml / shared.sd.xml — \\data\\ui\\' },
  { id: 'stratmap', label: 'Strat Characters', Icon: Users, description: 'descr_character.txt + descr_model_strat.txt — stratmap character types & models' },
];

export default function MinorFiles() {
  const [activeTab, setActiveTab] = useState('rebels');

  return (
    <div className="h-screen flex flex-col">
      <div className="h-10 border-b border-border flex items-center px-4 gap-3 shrink-0 bg-card/50">
        <FileText className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Minor Files Editor</span>
        <span className="text-[10px] text-muted-foreground font-mono hidden lg:block">— Rebel factions, Religions, Resources, Faction Names</span>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0 bg-card/30">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-semibold border-b-2 transition-colors ${
              activeTab === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* Tab description */}
      <div className="px-4 py-2 bg-muted/20 border-b border-border">
        <p className="text-[10px] text-muted-foreground font-mono">
          {TABS.find(t => t.id === activeTab)?.description}
        </p>
      </div>

      {(activeTab === 'spritesheets' || activeTab === 'stratmap') ? (
        <div className="flex-1 min-h-0 overflow-hidden p-3">
          {activeTab === 'spritesheets' && <SpriteSheetsTab />}
          {activeTab === 'stratmap' && <StratMapCharTab />}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-4 max-w-3xl mx-auto">
            {activeTab === 'rebels' && <RebelFactionsTab />}
            {activeTab === 'religions' && <ReligionsTab />}
            {activeTab === 'resources' && <ResourcesTab />}
            {activeTab === 'names' && <CharacterNamesTab />}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
