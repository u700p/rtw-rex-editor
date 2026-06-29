import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { textBlob } from '@/lib/lineEndings';

export const BANNERS_GLOBAL_KEY = 'm2tw_banners_xml_global';

function getBannersText() {
  try {
    return localStorage.getItem(BANNERS_GLOBAL_KEY)
      || localStorage.getItem('m2tw_descr_banners_file')
      || localStorage.getItem('m2tw_descr_banners_file_raw')
      || '';
  } catch {
    return '';
  }
}

function summarizeFactionBlocks(text, factionName) {
  const target = String(factionName || '').trim().toLowerCase();
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let factionBlocks = 0;
  let bannerRows = 0;
  let currentFaction = '';
  const factions = new Set();

  for (const line of lines) {
    const faction = line.match(/^\s*faction\s+(\S+)/i)?.[1]?.replace(/,+$/, '') || '';
    if (faction) {
      currentFaction = faction.toLowerCase();
      factions.add(faction);
      if (!target || currentFaction === target) factionBlocks += 1;
      continue;
    }
    if ((!target || currentFaction === target) && /^\s*(banner|unit|holy|royal|standard)\b/i.test(line)) {
      bannerRows += 1;
    }
  }

  return { factionBlocks, bannerRows, factionCount: factions.size };
}

export default function BannersTab({ factionName }) {
  const [rawText, setRawText] = useState('');

  const loadFromGlobal = useCallback(() => {
    setRawText(getBannersText());
  }, []);

  useEffect(() => {
    loadFromGlobal();
    window.addEventListener('banners-text-loaded', loadFromGlobal);
    return () => window.removeEventListener('banners-text-loaded', loadFromGlobal);
  }, [loadFromGlobal]);

  const summary = useMemo(() => summarizeFactionBlocks(rawText, factionName), [rawText, factionName]);

  const exportBanners = () => {
    if (!rawText) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(textBlob(rawText, 'text/plain'));
    a.download = 'descr_banners.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-slate-600 pb-2">
        <div>
          <p className="text-sm font-semibold text-slate-200">Banner Textures</p>
          <p className="text-xs text-slate-400">RTW descr_banners.txt is copied during faction duplication.</p>
        </div>
        {rawText && (
          <Button variant="outline" size="sm" className="text-[10px]" onClick={exportBanners}>
            <Download className="w-3 h-3 mr-1" /> Export descr_banners.txt
          </Button>
        )}
      </div>

      {rawText ? (
        <div className="border border-slate-700 rounded p-4 bg-slate-950/40 space-y-3">
          <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold">
            <FileText className="w-4 h-4" />
            Loaded RTW banner text
          </div>
          <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-300">
            <div className="rounded border border-slate-700 bg-slate-900/60 p-2">
              <p className="text-slate-500">Faction blocks</p>
              <p className="text-sm text-slate-100 font-mono">{summary.factionBlocks}</p>
            </div>
            <div className="rounded border border-slate-700 bg-slate-900/60 p-2">
              <p className="text-slate-500">Banner rows</p>
              <p className="text-sm text-slate-100 font-mono">{summary.bannerRows}</p>
            </div>
            <div className="rounded border border-slate-700 bg-slate-900/60 p-2">
              <p className="text-slate-500">Known factions</p>
              <p className="text-sm text-slate-100 font-mono">{summary.factionCount}</p>
            </div>
          </div>
          <p className="text-[10px] text-slate-500">
            Use Duplicate Faction to copy matching text blocks from the source faction into the new faction.
          </p>
        </div>
      ) : (
        <div className="text-center py-12 text-slate-500 border-2 border-dashed border-slate-700 rounded-lg">
          <FileText className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Load descr_banners.txt from the faction toolbar.</p>
        </div>
      )}
    </div>
  );
}
