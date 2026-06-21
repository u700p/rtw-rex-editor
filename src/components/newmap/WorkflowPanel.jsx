import React, { useState } from 'react';
import { CheckCircle, Circle, ChevronRight, Wand2, AlertCircle, Paintbrush } from 'lucide-react';
import { CLIMATE_PALETTE } from '@/lib/mapLayerStore';
import GroundTypeRangeEditor, { DEFAULT_GROUND_RANGES } from '@/components/newmap/GroundTypeRangeEditor';

/**
 * WorkflowPanel — drives the step-by-step layer editing flow.
 * Steps: heights → ground → climates → features → regions
 */

const STEPS = [
  { id: 'heights',  label: 'Heightmap',    file: 'map_heights.tga',      desc: 'Paint elevation. Sea = blue (0,0,255). Land = grayscale 1–255.' },
  { id: 'ground',   label: 'Ground Types', file: 'map_ground_types.tga', desc: 'Terrain type per tile. Configure height ranges below, then auto-generate.' },
  { id: 'climates', label: 'Climates',     file: 'map_climates.tga',     desc: 'Climate zones per tile. Auto-generate from ground types or fill with a single climate.' },
  { id: 'features', label: 'Features',     file: 'map_features.tga',     desc: 'Rivers, cliffs, fords. Rivers = 1px pure blue (0,0,255). Origin pixel = white (255,255,255). Each river pixel has at most 2 river neighbors.' },
  { id: 'regions',  label: 'Regions',      file: 'map_regions.tga',      desc: 'Settlement placement. Each region = black pixel + unique RGB surround.' },
];

export default function WorkflowPanel({
  layers, activeLayerId, onSetActive,
  onValidateAndNext, currentStepId,
  onAutoGenerateGround, generatingGround, groundProgress,
  onAutoGenerateClimates, generatingClimates,
  onFillClimate,
  groundRanges, onGroundRangesChange,
}) {
  const currentIdx = STEPS.findIndex(s => s.id === currentStepId);
  const [showRangeEditor, setShowRangeEditor] = useState(false);
  const [selectedFillClimate, setSelectedFillClimate] = useState(CLIMATE_PALETTE[0].id);

  const ranges = groundRanges ?? DEFAULT_GROUND_RANGES;

  return (
    <div className="p-3 space-y-2">
      <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-2">Layer Workflow</p>

      {STEPS.map((step, idx) => {
        const hasData = !!layers[step.id]?.imageData;
        const isActive = step.id === currentStepId;
        const isDone = idx < currentIdx;
        const isLocked = idx > currentIdx;

        return (
          <div key={step.id}
            className={`rounded border p-2 transition-colors ${
              isActive ? 'border-amber-500/60 bg-slate-800' :
              isDone   ? 'border-green-600/40 bg-slate-900' :
                         'border-slate-700 bg-slate-900 opacity-50'
            }`}>
            <div className="flex items-center gap-2">
              {isDone
                ? <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                : isActive
                  ? <Circle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  : <Circle className="w-3.5 h-3.5 text-slate-600 shrink-0" />}
              <button
                onClick={() => !isLocked && onSetActive(step.id)}
                disabled={isLocked}
                className={`text-[11px] font-semibold flex-1 text-left ${
                  isActive ? 'text-amber-300' : isDone ? 'text-green-400' : 'text-slate-500'
                }`}>
                {step.label}
              </button>
              {hasData && <span className="text-[9px] text-green-500">✓</span>}
            </div>

            {isActive && (
              <div className="mt-2 space-y-2">
                <p className="text-[10px] text-slate-400">{step.desc}</p>

                {/* Ground type step: range editor + auto-generate */}
                {step.id === 'ground' && (
                  <>
                    <button
                      onClick={() => setShowRangeEditor(v => !v)}
                      className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[10px] bg-slate-700 border border-slate-600 text-slate-300 hover:bg-slate-600 transition-colors">
                      ⚙ {showRangeEditor ? 'Hide' : 'Configure'} Height → Ground Type Ranges
                    </button>

                    {showRangeEditor && (
                      <div className="rounded border border-slate-700 bg-slate-900/80 p-2">
                        <GroundTypeRangeEditor
                          ranges={ranges}
                          onChange={onGroundRangesChange}
                        />
                        <button
                          onClick={() => onGroundRangesChange(DEFAULT_GROUND_RANGES)}
                          className="mt-2 text-[9px] px-2 py-0.5 rounded bg-slate-700 text-slate-400 hover:bg-slate-600 border border-slate-600 transition-colors">
                          Reset to Defaults
                        </button>
                      </div>
                    )}

                    <button
                      onClick={onAutoGenerateGround}
                      disabled={generatingGround || !layers.heights?.imageData}
                      className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[10px] bg-blue-700 border border-blue-600 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors font-semibold">
                      <Wand2 className={`w-3 h-3 ${generatingGround ? 'animate-spin' : ''}`} />
                      {generatingGround ? `Generating… ${groundProgress ?? 0}%` : 'Auto-generate from Heightmap'}
                    </button>
                    {generatingGround && (
                      <div className="w-full bg-slate-700 rounded-full h-1 overflow-hidden">
                        <div className="bg-blue-500 h-1 transition-all duration-200" style={{ width: `${groundProgress ?? 0}%` }} />
                      </div>
                    )}
                  </>
                )}

                {/* Climates step: auto-gen from ground or fill solid */}
                {step.id === 'climates' && (
                  <>
                    <button
                      onClick={onAutoGenerateClimates}
                      disabled={generatingClimates || !layers.ground?.imageData}
                      className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[10px] bg-blue-700 border border-blue-600 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors font-semibold">
                      <Wand2 className={`w-3 h-3 ${generatingClimates ? 'animate-spin' : ''}`} />
                      {generatingClimates ? 'Generating…' : 'Auto-generate from Ground Types'}
                    </button>

                    <div className="space-y-1.5">
                      <p className="text-[9px] text-slate-500">— or fill entire map with one climate —</p>
                      <select
                        value={selectedFillClimate}
                        onChange={e => setSelectedFillClimate(e.target.value)}
                        className="w-full h-7 px-1.5 text-[10px] bg-slate-800 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-amber-500">
                        {CLIMATE_PALETTE.map(p => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => onFillClimate(selectedFillClimate)}
                        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[10px] bg-slate-700 border border-slate-600 text-slate-200 hover:bg-slate-600 transition-colors font-semibold">
                        <Paintbrush className="w-3 h-3" />
                        Fill Entire Map
                      </button>
                    </div>

                    <p className="text-[9px] text-slate-500">
                      You can also switch to the <strong className="text-slate-300">Paint</strong> tab to paint climate zones manually.
                    </p>
                  </>
                )}

                {/* Features: OSM rivers hint */}
                {step.id === 'features' && (
                  <div className="text-[9px] text-slate-500 bg-slate-800/60 border border-slate-700 rounded px-2 py-1.5 space-y-1">
                    <p>Use the <strong className="text-slate-300">Generate Layers</strong> step to auto-fetch rivers from OSM, or paint them manually in the Paint tab.</p>
                    <p>Choose detail level carefully — streams can be very dense.</p>
                  </div>
                )}

                <button
                  onClick={() => onValidateAndNext(step.id)}
                  disabled={!hasData}
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[10px] bg-amber-600 border border-amber-500 text-white hover:bg-amber-500 disabled:opacity-40 transition-colors font-semibold">
                  <ChevronRight className="w-3 h-3" />
                  {idx < STEPS.length - 1 ? 'Validate & Next →' : 'Validate & Finish'}
                </button>

                {!hasData && (
                  <p className="text-[9px] text-slate-500 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 text-amber-500" />
                    {step.id === 'climates'
                      ? 'Use Auto-generate or Fill above, or paint this layer in the Paint tab.'
                      : 'Paint or import this layer first.'}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}