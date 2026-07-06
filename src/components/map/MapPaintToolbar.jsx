import React, { useState } from 'react';
import { Pencil, PaintBucket, RotateCcw, Save, Download, Pipette } from 'lucide-react';
import { LAYER_DEFS } from './mapLayerConstants';
import { LAYER_PRESETS } from './paintPresets';

function swatchBg(r, g, b) { return `rgb(${r},${g},${b})`; }
function isLight(r, g, b) { return r * 0.299 + g * 0.587 + b * 0.114 > 128; }
function clampRgb(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}
function rgbToHex(r, g, b) {
  return `#${[r, g, b].map(v => clampRgb(v).toString(16).padStart(2, '0')).join('')}`;
}
function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function HeightsControls({ paintColor, onColorChange }) {
  const { r, g, b } = paintColor;
  const isSea = r < 10 && g < 10 && b > 100;
  const landVal = Math.round((r + g + b) / 3);
  const seaVal  = b;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] text-slate-400">Mode:</span>
      <div className="flex rounded bg-slate-800 border border-slate-600 p-0.5 gap-0.5">
        <button onClick={() => onColorChange(landVal, landVal, landVal)}
          className={`px-2 py-0.5 rounded text-[10px] transition-colors ${!isSea ? 'bg-slate-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Land</button>
        <button onClick={() => onColorChange(0, 0, seaVal || 200)}
          className={`px-2 py-0.5 rounded text-[10px] transition-colors ${isSea ? 'bg-blue-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Sea</button>
      </div>
      {!isSea ? (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500">Grey</span>
          <input type="range" min={0} max={255} value={landVal}
            onChange={e => { const v = Number(e.target.value); onColorChange(v, v, v); }}
            className="w-20 accent-slate-400" />
          <span className="w-5 text-[10px] text-slate-300 font-mono">{landVal}</span>
          <span className="w-6 h-4 rounded border border-white/20" style={{ backgroundColor: swatchBg(r,g,b), display:'inline-block' }} />
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500">Blue</span>
          <input type="range" min={100} max={255} value={seaVal}
            onChange={e => onColorChange(0, 0, Number(e.target.value))}
            className="w-20 accent-blue-500" />
          <span className="w-5 text-[10px] text-slate-300 font-mono">{seaVal}</span>
          <span className="w-6 h-4 rounded border border-white/20" style={{ backgroundColor: swatchBg(r,g,b), display:'inline-block' }} />
        </div>
      )}
    </div>
  );
}

function PresetPicker({ layerId, paintColor, onColorChange }) {
  const presets = LAYER_PRESETS[layerId];
  if (!presets) return null;
  return (
    <div className="flex flex-wrap gap-1 items-center">
      {presets.map((p, i) => {
        const active = paintColor.r === p.r && paintColor.g === p.g && paintColor.b === p.b;
        return (
          <button key={i} title={p.label} onClick={() => onColorChange(p.r, p.g, p.b)}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-all ${
              active ? 'border-amber-400 ring-1 ring-amber-400 scale-105' : 'border-white/10 hover:border-white/30'
            }`}
            style={{ backgroundColor: swatchBg(p.r, p.g, p.b), color: isLight(p.r,p.g,p.b) ? '#111' : '#eee' }}>
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export default function MapPaintToolbar({ paintState, onPaintChange, onSave, onRevert, onExport, hasUnsaved, hasSavedSnapshot, dirtyLayers }) {
  const { active, layerId, paintColor, tool, brushSize } = paintState;
  const [showPresets, setShowPresets] = useState(false);

  const paintableLayers = LAYER_DEFS.filter(d => ['heights','ground','climates','features','regions','fog'].includes(d.id));

  return (
    <div className="flex flex-col gap-2 p-2 bg-slate-900/80 border-b border-slate-700/60 text-xs">
      {/* Row 1: paint toggle + layer select + tools */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => onPaintChange({ ...paintState, active: !active })}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all ${
            active
              ? 'bg-amber-500/20 border-amber-500/60 text-amber-400'
              : 'bg-slate-800 border-slate-600/40 text-slate-400 hover:text-slate-200'
          }`}
        >
          <Pencil className="w-3.5 h-3.5" />
          {active ? 'Painting ON' : 'Paint mode'}
        </button>

        {active && (
          <>
            {/* Layer select */}
            <select
              value={layerId}
              onChange={e => onPaintChange({ ...paintState, layerId: e.target.value })}
              className="h-7 px-2 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200"
            >
              {paintableLayers.map(d => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>

            {/* Tools */}
            <div className="flex gap-0.5 rounded bg-slate-800 border border-slate-600/40 p-0.5">
              {[
                { id: 'pencil',  Icon: Pencil,      title: 'Pencil' },
                { id: 'bucket',  Icon: PaintBucket,  title: 'Flood fill' },
                { id: 'pipette', Icon: Pipette,       title: 'Pick colour' },
              ].map(({ id, Icon, title }) => (
                <button key={id} title={title}
                  onClick={() => onPaintChange({ ...paintState, tool: id })}
                  className={`p-1.5 rounded transition-colors ${tool === id ? 'bg-amber-500/30 text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}>
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>

            {/* Brush size (pencil only) */}
            {tool === 'pencil' && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-500">Brush</span>
                <input type="range" min={1} max={20} value={brushSize}
                  onChange={e => onPaintChange({ ...paintState, brushSize: parseInt(e.target.value) })}
                  className="w-16 accent-amber-500" />
                <span className="text-[10px] text-slate-300 w-4 font-mono">{brushSize}</span>
              </div>
            )}

            {/* Color picker + presets toggle */}
            <div className="flex items-center gap-1.5">
              <label className="relative w-5 h-5 rounded border border-white/20 cursor-pointer overflow-hidden" title="Open color picker">
                <span className="absolute inset-0" style={{ backgroundColor: swatchBg(paintColor.r, paintColor.g, paintColor.b) }} />
                <input
                  type="color"
                  value={rgbToHex(paintColor.r, paintColor.g, paintColor.b)}
                  onChange={e => {
                    const rgb = hexToRgb(e.target.value);
                    if (rgb) onPaintChange({ ...paintState, paintColor: rgb });
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </label>
              <button
                onClick={() => setShowPresets(p => !p)}
                className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${showPresets ? 'border-amber-500/40 text-amber-400' : 'border-slate-600/40 text-slate-400 hover:text-slate-200'}`}
              >
                Presets
              </button>
            </div>
          </>
        )}

        {/* Save / Revert / Export */}
        <div className="ml-auto flex items-center gap-1.5">
          {hasSavedSnapshot && (
            <button onClick={onRevert} title="Revert to last save"
              disabled={!hasUnsaved}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] border transition-colors ${
                hasUnsaved
                  ? 'bg-slate-700/60 hover:bg-slate-700 border-slate-600/40 text-slate-300'
                  : 'border-slate-700/30 text-slate-600 cursor-not-allowed'
              }`}>
              <RotateCcw className="w-3 h-3" /> Revert
            </button>
          )}
          <button onClick={onSave} title="Save current state as checkpoint"
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] border font-semibold transition-colors ${
              hasUnsaved
                ? 'bg-green-700/80 hover:bg-green-700 border-green-600/40 text-green-200 animate-pulse'
                : 'bg-green-900/30 border-green-800/30 text-green-600'
            }`}>
            <Save className="w-3 h-3" /> Save
          </button>
          {dirtyLayers && dirtyLayers.size > 0 && (
            <button onClick={onExport} title="Export modified layers as TGA files"
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-amber-600/80 hover:bg-amber-600 border border-amber-500/40 text-slate-900 font-semibold transition-colors">
              <Download className="w-3 h-3" /> Export TGA
            </button>
          )}
        </div>
      </div>

      {/* Row 2: Presets / colour controls */}
      {active && showPresets && (
        <div className="border-t border-slate-700/40 pt-2">
          {layerId === 'heights' ? (
            <HeightsControls paintColor={paintColor} onColorChange={(r,g,b) => onPaintChange({ ...paintState, paintColor: {r,g,b} })} />
          ) : (
            <PresetPicker layerId={layerId} paintColor={paintColor} onColorChange={(r,g,b) => onPaintChange({ ...paintState, paintColor: {r,g,b} })} />
          )}
        </div>
      )}
    </div>
  );
}
