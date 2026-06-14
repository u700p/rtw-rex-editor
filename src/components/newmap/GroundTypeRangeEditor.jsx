import React, { useState } from 'react';
import { GROUND_TYPE_PALETTE } from '@/lib/mapLayerStore';

/**
 * GroundTypeRangeEditor
 * Lets the user configure which grayscale brightness range (0–255) on the heightmap
 * maps to which M2TW ground type.
 *
 * The ranges are stored as an ordered list of { gtId, max } where each entry means
 * "from the previous max+1 up to this max, use this ground type."
 * The first entry always starts at 0, the last always ends at 255.
 *
 * Sea pixels (0,0,255 blue) are handled separately and never go through this table.
 */

// Default ranges (brightness 0–255 for land pixels)
export const DEFAULT_GROUND_RANGES = [
  { gtId: 'beach',           max: 5   },
  { gtId: 'fertile_low',     max: 40  },
  { gtId: 'fertile_medium',  max: 80  },
  { gtId: 'fertile_high',    max: 120 },
  { gtId: 'hills',           max: 160 },
  { gtId: 'mountains_low',   max: 200 },
  { gtId: 'mountains_high',  max: 255 },
];

// Palette lookup
const GT_COLOR = Object.fromEntries(GROUND_TYPE_PALETTE.map(p => [p.id, p.color]));
const GT_LABEL = Object.fromEntries(GROUND_TYPE_PALETTE.map(p => [p.id, p.label]));

export default function GroundTypeRangeEditor({ ranges, onChange }) {
  const [expandedIdx, setExpandedIdx] = useState(null);

  const updateRange = (idx, field, value) => {
    const next = ranges.map((r, i) => i === idx ? { ...r, [field]: value } : r);
    onChange(next);
  };

  const getMin = (idx) => idx === 0 ? 0 : ranges[idx - 1].max + 1;

  const handleSlider = (idx, rawVal) => {
    const val = Math.max(getMin(idx), Math.min(rawVal, idx === ranges.length - 1 ? 255 : ranges[idx + 1].max - 1));
    updateRange(idx, 'max', val);
  };

  const addBand = () => {
    if (ranges.length >= GROUND_TYPE_PALETTE.length) return;
    const insertAt = ranges.length - 1;
    const prevMax = ranges[insertAt - 1]?.max ?? 0;
    const lastMax = ranges[insertAt].max;
    const mid = Math.round((prevMax + lastMax) / 2);
    if (mid <= prevMax) return;
    const newBand = { gtId: 'wilderness', max: mid };
    const next = [...ranges.slice(0, insertAt), newBand, ...ranges.slice(insertAt)];
    onChange(next);
  };

  const removeBand = (idx) => {
    if (ranges.length <= 2) return;
    const next = ranges.filter((_, i) => i !== idx);
    next[next.length - 1] = { ...next[next.length - 1], max: 255 };
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-slate-400 font-semibold uppercase">Height → Ground Type Mapping</p>
        <button onClick={addBand}
          className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700 text-amber-400 hover:bg-slate-600 transition-colors border border-slate-600">
          + Band
        </button>
      </div>

      <p className="text-[9px] text-slate-500 leading-relaxed">
        Each band covers a brightness range on the heightmap (0=darkest, 255=brightest). Sea pixels (pure blue) use separate logic.
      </p>

      {/* Visual band bar */}
      <div className="flex h-5 rounded overflow-hidden border border-slate-600 w-full">
        {ranges.map((r, i) => {
          const min = getMin(i);
          const width = ((r.max - min + 1) / 256) * 100;
          return (
            <div key={i} title={`${GT_LABEL[r.gtId] ?? r.gtId}: ${min}–${r.max}`}
              style={{ width: `${width}%`, backgroundColor: GT_COLOR[r.gtId] ?? '#888' }}
              className="h-full" />
          );
        })}
      </div>

      {/* Range rows */}
      <div className="space-y-1.5">
        {ranges.map((r, idx) => {
          const min = getMin(idx);
          const isLast = idx === ranges.length - 1;
          const isExpanded = expandedIdx === idx;
          return (
            <div key={idx} className="rounded border border-slate-700 bg-slate-900/60 overflow-hidden">
              {/* Header row */}
              <div className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-slate-800/40 transition-colors"
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}>
                <div className="w-3 h-3 rounded-sm border border-slate-600 shrink-0"
                  style={{ backgroundColor: GT_COLOR[r.gtId] ?? '#888' }} />
                <span className="text-[10px] text-slate-300 flex-1 truncate">
                  {GT_LABEL[r.gtId] ?? r.gtId}
                </span>
                <span className="text-[9px] font-mono text-slate-500 shrink-0">
                  {min}–{r.max}
                </span>
                {!isLast && ranges.length > 2 && (
                  <button onClick={e => { e.stopPropagation(); removeBand(idx); }}
                    className="text-slate-600 hover:text-red-400 transition-colors shrink-0 text-[9px]">
                    ✕
                  </button>
                )}
              </div>

              {/* Expanded controls */}
              {isExpanded && (
                <div className="px-2 pb-2 space-y-2 border-t border-slate-700/50">
                  {/* Ground type selector */}
                  <div className="pt-2">
                    <p className="text-[9px] text-slate-500 mb-1">Ground Type</p>
                    <div className="grid grid-cols-2 gap-0.5 max-h-36 overflow-y-auto">
                      {GROUND_TYPE_PALETTE.map(p => (
                        <button key={p.id} onClick={() => updateRange(idx, 'gtId', p.id)}
                          className={`flex items-center gap-1.5 px-1.5 py-1 rounded text-[9px] text-left transition-colors ${
                            r.gtId === p.id ? 'bg-amber-600/30 text-amber-300' : 'text-slate-400 hover:bg-slate-700'
                          }`}>
                          <div className="w-2.5 h-2.5 rounded-sm shrink-0 border border-slate-600"
                            style={{ backgroundColor: p.color }} />
                          <span className="truncate">{p.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Upper bound slider (not shown for last band, always 255) */}
                  {!isLast && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[9px] text-slate-500">Upper bound (inclusive)</p>
                        <span className="text-[9px] font-mono text-amber-400">{r.max}</span>
                      </div>
                      <input type="range"
                        min={min}
                        max={idx < ranges.length - 1 ? ranges[idx + 1].max - 1 : 255}
                        value={r.max}
                        onChange={e => handleSlider(idx, parseInt(e.target.value))}
                        className="w-full h-1.5 accent-amber-400" />
                      <div className="flex justify-between text-[8px] text-slate-600 mt-0.5">
                        <span>{min}</span>
                        <span>{idx < ranges.length - 1 ? ranges[idx + 1].max - 1 : 255}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}