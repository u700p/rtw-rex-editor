import React, { useState } from 'react';
import SpriteSheetEditor from './SpriteSheetEditor';

const SHEET_TABS = [
  { id: 'strategy', label: 'strategy.sd.xml', key: 'm2tw_strategy_sd_xml' },
  { id: 'battle',   label: 'battle.sd.xml',   key: 'm2tw_battle_sd_xml'   },
  { id: 'shared',   label: 'shared.sd.xml',   key: 'm2tw_shared_sd_xml'   },
  { id: 'radar',    label: 'radar.sd.xml',    key: 'm2tw_radar_sd_xml'    },
];

export default function SpriteSheetsTab() {
  const [active, setActive] = useState('strategy');

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Sub-tab bar */}
      <div className="flex gap-0 border-b border-slate-700 shrink-0">
        {SHEET_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`px-4 py-1.5 text-[11px] font-mono font-semibold border-b-2 transition-colors ${
              active === t.id
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Editor — one per tab, each keeps its own state */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {SHEET_TABS.map(t => (
          <div key={t.id} className={`h-full ${active === t.id ? 'block' : 'hidden'}`}>
            <SpriteSheetEditor label={t.label} storageKey={t.key} />
          </div>
        ))}
      </div>
    </div>
  );
}