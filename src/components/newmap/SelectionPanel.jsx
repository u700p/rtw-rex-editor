import React, { useRef } from 'react';
import { Crop, Check, X, FolderOpen } from 'lucide-react';

export default function SelectionPanel({ selectionMode, onToggleSelection, selection, onConfirmSelection, onClearSelection, bboxConfirmed, onBboxEdit }) {
  const fileInputRef = useRef(null);
  const hasSel = selection?.start && selection?.end;

  const handleImportBbox = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const lines = ev.target.result.split('\n');
      const vals = {};
      for (const line of lines) {
        const m = line.match(/^(north|south|east|west)=([-\d.]+)/);
        if (m) vals[m[1]] = parseFloat(m[2]);
      }
      if (vals.north && vals.south && vals.east && vals.west) {
        onBboxEdit?.({
          start: { lat: vals.north, lng: vals.west },
          end:   { lat: vals.south, lng: vals.east },
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const latMin = hasSel ? Math.min(selection.start.lat, selection.end.lat) : null;
  const latMax = hasSel ? Math.max(selection.start.lat, selection.end.lat) : null;
  const lngMin = hasSel ? Math.min(selection.start.lng, selection.end.lng) : null;
  const lngMax = hasSel ? Math.max(selection.start.lng, selection.end.lng) : null;

  const handleField = (field, val) => {
    const n = parseFloat(val);
    if (isNaN(n)) return;
    const cur = {
      south: latMin, north: latMax, west: lngMin, east: lngMax,
      [field]: n,
    };
    // Reconstruct selection from edited values
    onBboxEdit?.({
      start: { lat: cur.north, lng: cur.west },
      end: { lat: cur.south, lng: cur.east },
    });
  };

  return (
    <div className="space-y-2">
      {!bboxConfirmed && (
        <p className="text-[10px] text-slate-400">
          Drag on the map to draw a bounding box, then fine-tune the coordinates and confirm.
        </p>
      )}
      {bboxConfirmed && (
        <p className="text-[10px] text-green-400 font-medium">✓ Area confirmed. Generate layers below.</p>
      )}

      {!bboxConfirmed && (
        <>
        <input ref={fileInputRef} type="file" accept=".txt" className="hidden" onChange={handleImportBbox} />
        <button onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-[11px] border transition-colors bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600">
          <FolderOpen className="w-3.5 h-3.5" />
          Import bbox_coords.txt
        </button>
        </>
      )}

      {!bboxConfirmed && (
        <button onClick={onToggleSelection}
          className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-[11px] border transition-colors ${
            selectionMode
              ? 'bg-amber-600 border-amber-500 text-white'
              : 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'
          }`}>
          <Crop className="w-3.5 h-3.5" />
          {selectionMode ? 'Drawing… (drag on map)' : 'Draw Selection Box'}
        </button>
      )}

      {hasSel && (
        <div className="bg-slate-800 border border-slate-700 rounded p-2 space-y-1.5 text-[10px]">
          <p className="text-slate-400 font-semibold mb-1">Fine-tune coordinates</p>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { label: 'North', field: 'north', val: latMax },
              { label: 'South', field: 'south', val: latMin },
              { label: 'West', field: 'west', val: lngMin },
              { label: 'East', field: 'east', val: lngMax },
            ].map(({ label, field, val }) => (
              <div key={field}>
                <p className="text-slate-500 mb-0.5">{label}</p>
                <input
                  type="number"
                  step="0.01"
                  value={val?.toFixed(3) ?? ''}
                  onChange={e => handleField(field, e.target.value)}
                  disabled={bboxConfirmed}
                  className="w-full bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-[10px] text-slate-100 font-mono focus:outline-none focus:border-amber-500 disabled:opacity-50"
                />
              </div>
            ))}
          </div>

          {!bboxConfirmed && (
            <div className="flex gap-1.5 mt-2">
              <button onClick={onConfirmSelection}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] bg-amber-600 text-white hover:bg-amber-500 transition-colors">
                <Check className="w-3 h-3" /> Confirm Area
              </button>
              <button onClick={onClearSelection}
                className="flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}