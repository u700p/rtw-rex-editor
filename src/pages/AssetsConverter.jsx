import React, { useState } from 'react';
import TexturePanel from '@/components/assets/TexturePanel';
import ModelPanel from '@/components/assets/ModelPanel';
import { ImageIcon, Box } from 'lucide-react';

const TABS = [
  { id: 'texture', label: 'Textures', icon: ImageIcon, desc: '.texture ↔ .dds' },
  { id: 'model', label: 'Models', icon: Box, desc: '.cas / .mesh ↔ .ms3d' },
];

export default function AssetsConverter() {
  const [tab, setTab] = useState('texture');

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Header */}
      <div className="px-6 pt-6 pb-0 border-b border-slate-700 bg-slate-900">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <Box className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">Total War Asset Converter</h1>
            <p className="text-[11px] text-slate-400">Preview and convert game textures &amp; models</p>
          </div>
          <div className="ml-auto text-[10px] text-slate-600 hidden lg:block">
            Supports classic Rome-era texture and model formats
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-medium border border-b-0 transition-all ${
                tab === t.id
                  ? 'bg-slate-800 text-white border-slate-600'
                  : 'bg-transparent text-slate-400 border-transparent hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
              <span className="text-[10px] text-slate-500 hidden sm:inline">{t.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 overflow-auto">
        {tab === 'texture' && <TexturePanel />}
        {tab === 'model' && <ModelPanel />}
      </div>
    </div>
  );
}
