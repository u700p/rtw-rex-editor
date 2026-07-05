import React from 'react';
import { Image, Wand2 } from 'lucide-react';
import romeUi from '@/assets/rome/rome-ui.jpg';
import { AiImageWorkshopTab } from './RomeTools';

export default function AIGenerator() {
  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-200">
      <div className="h-24 shrink-0 border-b border-slate-800 bg-cover bg-center relative" style={{ backgroundImage: `linear-gradient(90deg, rgba(8, 7, 5, 0.96), rgba(8, 7, 5, 0.74)), url(${romeUi})` }}>
        <div className="absolute inset-0 p-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] tracking-[0.25em] uppercase text-amber-400">Unit and Faction Art</p>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-amber-400" />
              AI Generator
            </h1>
          </div>
          <div className="hidden md:flex items-center gap-2 text-[11px] text-slate-400">
            <Image className="w-4 h-4 text-amber-400" />
            Img2img prompts, icon concepts, and idea kits
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 p-3 overflow-auto">
        <AiImageWorkshopTab />
      </div>
    </div>
  );
}
