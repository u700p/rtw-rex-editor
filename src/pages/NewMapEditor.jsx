import React, { useState, useCallback } from 'react';
import { getLayerDimensions, LAYER_DEFS, CLIMATE_PALETTE, hexToRgb } from '@/lib/mapLayerStore';
import {
  Map, Download, Crop, Edit3, MousePointer, Layers,
  GitBranch
} from 'lucide-react';
import LayerSidebar from '../components/newmap/LayerSidebar';
import MapStatusBar from '../components/newmap/MapStatusBar';
import ExportPanel from '../components/newmap/ExportPanel';
import SelectionPanel from '../components/newmap/SelectionPanel';
import MapCanvas from '../components/newmap/MapCanvas';
import BboxLayerGenerator from '../components/newmap/BboxLayerGenerator';
import LayerPreviewPanel from '../components/newmap/LayerPreviewPanel';
import WorkflowPanel from '../components/newmap/WorkflowPanel';
import RegionsWorkshop from '../components/newmap/RegionsWorkshop';
import OsmHistoricTagFetcher from '../components/newmap/OsmHistoricTagFetcher';
import { useReferenceLayers, ReferenceLayerControls } from '../components/newmap/ReferenceLayers';

import { autoGenerateGroundTypesAsync, autoGenerateClimates, fillSolidColor } from '@/lib/autoGroundTypes';
import { DEFAULT_GROUND_RANGES } from '@/components/newmap/GroundTypeRangeEditor';

const PHASES = [
  { id: 'browse',     label: 'Select Area',     icon: MousePointer },
  { id: 'resolution', label: 'Set Resolution',  icon: Map },
  { id: 'generate',   label: 'Generate Layers', icon: Layers },
  { id: 'preview',    label: 'Preview',         icon: Map },
  { id: 'edit',       label: 'Edit & Export',   icon: Edit3 },
];

const WORKFLOW_STEPS = ['heights', 'ground', 'climates', 'features', 'regions'];

// Sidebar tabs available in each phase
const SIDEBAR_TABS = {
  browse:     ['area', 'layers'],
  resolution: ['area', 'layers'],
  generate:   ['area', 'layers'],
  preview:    ['area', 'layers'],
  edit:       ['workflow', 'layers', 'export'],
};

const TAB_META = {
  area:     { label: 'Area',     icon: Crop },
  layers:   { label: 'Layers',   icon: Layers },
  workflow: { label: 'Workflow', icon: GitBranch },
  export:   { label: 'Export',   icon: Download },
};

export default function NewMapEditor() {
  const [phase, setPhase] = useState('browse');
  const [layers, setLayers] = useState({});
  const [workflowStep, setWorkflowStep] = useState('heights');
  const [activeLayerId, setActiveLayerId] = useState('heights');
  const [activeTool, setActiveTool] = useState('brush');
  const [brushSize, setBrushSize] = useState(8);
  const [color, setColor] = useState('#808080');
  const [coords, setCoords] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selection, setSelection] = useState(null);
  // CotaMap-style interactive box (null until first draw confirmed)
  const [box, setBox] = useState(null);
  const [sideTab, setSideTab] = useState('area');
  const [mapWidth, setMapWidth] = useState(512);
  const [mapHeight, setMapHeight] = useState(512);
  const [regionName, setRegionName] = useState('');
  const [generatingGround, setGeneratingGround] = useState(false);
  const [generatingClimates, setGeneratingClimates] = useState(false);
  const [groundRanges, setGroundRanges] = useState(DEFAULT_GROUND_RANGES);

  const { refLayers, toggleRef, setRefOpacity } = useReferenceLayers();

  // Extra downloadable assets accumulated during the workflow (historic PNGs, TXTs, etc.)
  const [extraAssets, setExtraAssets] = useState([]);

  // Historic tag overlays shown on the map: key → imageData
  const [historicOverlays, setHistoricOverlays] = useState({});

  // Lifted state from RegionsWorkshop so it survives tab switches
  const [settlements, setSettlements] = useState([]);

  // Lifted state from OsmHistoricTagFetcher so it survives tab switches
  const [historicTagStates, setHistoricTagStates] = useState({});

  const handleToggleHistoricOverlay = useCallback((key, imageData) => {
    setHistoricOverlays(prev => {
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: imageData };
    });
  }, []);

  const registerExtraAsset = useCallback((asset) => {
    setExtraAssets(prev => {
      const filtered = prev.filter(a => a.filename !== asset.filename);
      return [...filtered, asset];
    });
  }, []);


  // bbox derived from box (preferred) or legacy selection
  const bbox = box
    ? { south: box.south, north: box.north, west: box.west, east: box.east, rotation: box.rotation ?? 0 }
    : (selection?.start && selection?.end ? {
        south: Math.min(selection.start.lat, selection.end.lat),
        north: Math.max(selection.start.lat, selection.end.lat),
        west: Math.min(selection.start.lng, selection.end.lng),
        east: Math.max(selection.start.lng, selection.end.lng),
        rotation: 0,
      } : null);

  const handleLayerUpdate = useCallback((layerId, data) => {
    setLayers(prev => ({ ...prev, [layerId]: { ...prev[layerId], ...data } }));
  }, []);

  const handleToggleVisible = (layerId) => {
    setLayers(prev => ({
      ...prev,
      [layerId]: { ...prev[layerId], visible: !(prev[layerId]?.visible !== false) }
    }));
  };

  const handleOpacityChange = (layerId, opacity) => {
    setLayers(prev => ({ ...prev, [layerId]: { ...prev[layerId], opacity } }));
  };

  const handleImportFile = (layerId, file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const def = LAYER_DEFS.find(d => d.id === layerId);
    const { width, height } = getLayerDimensions(def, mapWidth, mapHeight);

    const drawToLayer = (source) => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(source, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      handleLayerUpdate(layerId, { imageData, visible: true, opacity: 0.8, dirty: true });
      URL.revokeObjectURL(url);
    };

    // Use createImageBitmap for large files (no size limit like <img>)
    if (typeof createImageBitmap !== 'undefined') {
      createImageBitmap(file).then(drawToLayer).catch(() => {
        // Fallback to <img>
        const img = new Image();
        img.onload = () => drawToLayer(img);
        img.src = url;
      });
    } else {
      const img = new Image();
      img.onload = () => drawToLayer(img);
      img.src = url;
    }
  };

  const handleSelectionUpdate = ({ start, end }) => {
    setSelection({ start, end });
  };

  const confirmSelection = () => {
    setSelectionMode(false);
    if (selection?.start && selection?.end) {
      const b = {
        south: Math.min(selection.start.lat, selection.end.lat),
        north: Math.max(selection.start.lat, selection.end.lat),
        west: Math.min(selection.start.lng, selection.end.lng),
        east: Math.max(selection.start.lng, selection.end.lng),
        rotation: 0,
      };
      setBox(b);
      setPhase('resolution');
    }
  };

  const mercLat = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const bboxAspect = bbox
    ? (bbox.east - bbox.west) / ((mercLat(bbox.north) - mercLat(bbox.south)) * (180 / Math.PI))
    : 1;

  const handleWidthChange = (val) => {
    const w = Math.max(1, parseInt(val) || 0);
    setMapWidth(w);
    setMapHeight(Math.max(1, Math.round(w / bboxAspect)));
  };

  const handleHeightChange = (val) => {
    const h = Math.max(1, parseInt(val) || 0);
    setMapHeight(h);
    setMapWidth(Math.max(1, Math.round(h * bboxAspect)));
  };

  const confirmResolution = () => {
    if (mapWidth > 0 && mapHeight > 0) setPhase('generate');
  };

  const handleValidateAndNext = (stepId) => {
    const idx = WORKFLOW_STEPS.indexOf(stepId);
    if (idx < WORKFLOW_STEPS.length - 1) {
      const next = WORKFLOW_STEPS[idx + 1];
      setWorkflowStep(next);
      setActiveLayerId(next);
      if (next === 'climates') setColor('#ec008c');
      else if (next === 'features') setColor('#0000ff');
      else if (next === 'ground') setColor('#008080');
      else if (next === 'regions') setColor('#000000');
    } else {
      // Last step — switch to export tab
      setSideTab('export');
    }
  };

  const [groundProgress, setGroundProgress] = useState(0);

  const handleAutoGenerateGround = async () => {
    const heightLayer = layers.heights;
    if (!heightLayer?.imageData) return;
    setGeneratingGround(true);
    setGroundProgress(0);
    const result = await autoGenerateGroundTypesAsync(heightLayer.imageData, groundRanges, setGroundProgress);
    handleLayerUpdate('ground', { imageData: result, visible: true, opacity: 1, dirty: true });
    setGroundProgress(100);
    setGeneratingGround(false);
  };

  const handleAutoGenerateClimates = async () => {
    const groundLayer = layers.ground;
    if (!groundLayer?.imageData) return;
    setGeneratingClimates(true);
    await new Promise(r => setTimeout(r, 50));
    const result = autoGenerateClimates(groundLayer.imageData);
    handleLayerUpdate('climates', { imageData: result, visible: true, opacity: 1, dirty: true });
    setGeneratingClimates(false);
  };

  const handleFillClimate = (climateId) => {
    const climateDef = CLIMATE_PALETTE.find(p => p.id === climateId);
    if (!climateDef) return;
    const { r, g, b } = hexToRgb(climateDef.color);
    const def = LAYER_DEFS.find(d => d.id === 'climates');
    const { width, height } = getLayerDimensions(def, mapWidth, mapHeight);
    const result = fillSolidColor(width, height, r, g, b);
    handleLayerUpdate('climates', { imageData: result, visible: true, opacity: 1, dirty: true });
  };

  const phaseIndex = PHASES.findIndex(p => p.id === phase);
  const availableTabs = SIDEBAR_TABS[phase] ?? ['area'];

  // Auto-switch to a valid tab when phase changes
  const currentTab = availableTabs.includes(sideTab) ? sideTab : availableTabs[0];

  return (
    <div className="flex flex-col bg-slate-950 text-slate-200 overflow-hidden" style={{ height: '100vh' }}>
      {/* Header — phase stepper */}
      <div className="h-10 bg-slate-900 border-b border-slate-700 flex items-center gap-3 px-4 shrink-0">
        <Map className="w-4 h-4 text-amber-400 shrink-0" />
        <h1 className="text-sm font-bold text-slate-100 shrink-0">New Map Editor</h1>

        <div className="flex items-center gap-1 ml-2 overflow-x-auto">
          {PHASES.map((p, i) => (
            <React.Fragment key={p.id}>
              <button
                onClick={() => { if (i <= phaseIndex) setPhase(p.id); }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold transition-colors shrink-0 ${
                  phase === p.id
                    ? 'bg-amber-600 text-white'
                    : i < phaseIndex
                      ? 'bg-slate-700 text-slate-300 hover:bg-slate-600 cursor-pointer'
                      : 'text-slate-600 cursor-default'
                }`}>
                <p.icon className="w-3 h-3" />
                {p.label}
              </button>
              {i < PHASES.length - 1 && <span className="text-slate-700 text-xs shrink-0">›</span>}
            </React.Fragment>
          ))}
        </div>

        {bbox && phase !== 'browse' && phase !== 'resolution' && (
          <div className="ml-auto flex items-center gap-1 text-[11px] shrink-0">
            <span className="text-slate-500">Regions:</span>
            <span className="text-amber-400 font-mono">{mapWidth}×{mapHeight}</span>
          </div>
        )}
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left sidebar — always visible, tabs change by phase ── */}
        <div className="w-60 bg-slate-900 border-r border-slate-700 flex flex-col overflow-hidden shrink-0">
          {/* Tab bar */}
          <div className="flex border-b border-slate-700 shrink-0">
            {availableTabs.map(tabId => {
              const meta = TAB_META[tabId];
              const Icon = meta.icon;
              return (
                <button
                  key={tabId}
                  onClick={() => setSideTab(tabId)}
                  title={meta.label}
                  className={`flex-1 py-1.5 flex flex-col items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider transition-colors ${
                    currentTab === tabId
                      ? 'bg-slate-800 text-amber-400 border-b-2 border-amber-500'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}>
                  <Icon className="w-3.5 h-3.5" />
                  {meta.label}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">

            {/* ── AREA tab ── */}
            {currentTab === 'area' && (
              <div className="p-3 space-y-3">
                {/* Phase-specific content */}
                {(phase === 'browse' || phase === 'resolution') && (
                  <>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
                      {phase === 'browse' ? 'Step 1 — Select Map Area' : 'Step 2 — Set Resolution'}
                    </p>
                    <SelectionPanel
                      selectionMode={selectionMode}
                      onToggleSelection={() => setSelectionMode(m => !m)}
                      selection={selection}
                      onConfirmSelection={confirmSelection}
                      onClearSelection={() => { setSelection(null); setBox(null); setSelectionMode(false); }}
                      onBboxEdit={handleSelectionUpdate}
                    />
                    {/* Box coords editor once box is set */}
                    {box && (
                      <div className="bg-slate-800 border border-slate-700 rounded p-2 text-[10px] space-y-1.5">
                        <p className="text-amber-400 font-semibold">Interactive Box</p>
                        <p className="text-slate-400">Drag corners, center, or rotation handle on the map.</p>
                        <div className="grid grid-cols-2 gap-1">
                          {[
                            { label: 'N', field: 'north' },
                            { label: 'S', field: 'south' },
                            { label: 'W', field: 'west' },
                            { label: 'E', field: 'east' },
                          ].map(({ label, field }) => (
                            <div key={field}>
                              <p className="text-slate-500 mb-0.5">{label}</p>
                              <input type="number" step="0.01"
                                value={box[field]?.toFixed(3) ?? ''}
                                onChange={e => setBox(b => ({ ...b, [field]: parseFloat(e.target.value) || b[field] }))}
                                className="w-full bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-[10px] text-slate-100 font-mono focus:outline-none focus:border-amber-500" />
                            </div>
                          ))}
                        </div>
                        <div>
                          <p className="text-slate-500 mb-0.5">Rotation (°)</p>
                          <input type="number" step="1" min="-180" max="180"
                            value={Math.round(box.rotation ?? 0)}
                            onChange={e => setBox(b => ({ ...b, rotation: parseFloat(e.target.value) || 0 }))}
                            className="w-full bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-[10px] text-slate-100 font-mono focus:outline-none focus:border-amber-500" />
                        </div>
                      </div>
                    )}
                    {phase === 'resolution' && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <label className="text-[10px] text-slate-400 mb-1 block">Width</label>
                            <input type="number" min="64" max="4096" value={mapWidth}
                              onChange={e => handleWidthChange(e.target.value)}
                              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-[13px] text-slate-100 font-mono focus:outline-none focus:border-amber-500" />
                          </div>
                          <span className="text-slate-500 mt-4">×</span>
                          <div className="flex-1">
                            <label className="text-[10px] text-slate-400 mb-1 block">Height</label>
                            <input type="number" min="64" max="4096" value={mapHeight}
                              onChange={e => handleHeightChange(e.target.value)}
                              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-[13px] text-slate-100 font-mono focus:outline-none focus:border-amber-500" />
                          </div>
                        </div>
                        <p className="text-[9px] text-slate-500">Aspect ratio: {bboxAspect.toFixed(3)}:1</p>
                        <div className="bg-slate-800 rounded p-2 text-[10px] text-slate-400 space-y-0.5">
                          <p className="text-slate-300 font-semibold mb-1">Dimensions</p>
                          <p>regions/features: <span className="font-mono text-slate-200">{mapWidth}×{mapHeight}</span></p>
                          <p>heights/ground: <span className="font-mono text-slate-200">{mapWidth*2+1}×{mapHeight*2+1}</span></p>
                        </div>
                        <button onClick={confirmResolution}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-[11px] bg-amber-600 border border-amber-500 text-white hover:bg-amber-500 transition-colors font-semibold">
                          Confirm &amp; Generate →
                        </button>
                      </div>
                    )}
                  </>
                )}

                {phase === 'generate' && bbox && (
                  <>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-2">Step 3 — Generate Layers</p>
                    <BboxLayerGenerator
                      bbox={bbox}
                      mapWidth={mapWidth}
                      mapHeight={mapHeight}
                      onLayerUpdate={handleLayerUpdate}
                      onDone={() => setPhase('preview')}
                    />
                  </>
                )}

                {phase === 'preview' && (
                  <LayerPreviewPanel
                    layers={layers}
                    onToggleVisible={handleToggleVisible}
                    onOpacityChange={handleOpacityChange}
                    onProceed={() => { setPhase('edit'); setSideTab('workflow'); }}
                  />
                )}

                {phase === 'edit' && (
                  <div className="space-y-2">
                    <p className="text-[10px] text-slate-400">
                      Selected area: <span className="font-mono text-amber-400">{mapWidth}×{mapHeight}</span>
                    </p>
                    {bbox && (
                      <div className="text-[10px] text-slate-500 font-mono space-y-0.5">
                        <p>N {bbox.north?.toFixed(2)} / S {bbox.south?.toFixed(2)}</p>
                        <p>W {bbox.west?.toFixed(2)} / E {bbox.east?.toFixed(2)}</p>
                        {bbox.rotation ? <p>Rot {bbox.rotation?.toFixed(1)}°</p> : null}
                      </div>
                    )}
                    <button onClick={() => { setPhase('browse'); setSelection(null); setBox(null); setLayers({}); setWorkflowStep('heights'); setSideTab('area'); }}
                      className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[11px] bg-slate-800 border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors">
                      <Crop className="w-3.5 h-3.5" /> Start Over / New Area
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── LAYERS tab (reference layers + layer stack) ── */}
            {currentTab === 'layers' && (
              <div className="p-3 space-y-4">
                <ReferenceLayerControls refLayers={refLayers} onToggle={toggleRef} onOpacity={setRefOpacity} />
                {phase === 'edit' && (
                  <div className="border-t border-slate-700 pt-3">
                    <LayerSidebar
                      layers={layers}
                      activeLayerId={activeLayerId}
                      onSetActive={(id) => setActiveLayerId(id)}
                      onToggleVisible={handleToggleVisible}
                      onOpacityChange={handleOpacityChange}
                      onImport={handleImportFile}
                      mapWidth={mapWidth}
                      mapHeight={mapHeight}
                      compact
                    />
                  </div>
                )}
              </div>
            )}

            {/* ── WORKFLOW tab (edit phase) ── */}
            {currentTab === 'workflow' && phase === 'edit' && (
              <div className="space-y-0">
                <WorkflowPanel
                  layers={layers}
                  activeLayerId={activeLayerId}
                  onSetActive={(id) => { setActiveLayerId(id); setWorkflowStep(id); }}
                  onValidateAndNext={handleValidateAndNext}
                  currentStepId={workflowStep}
                  onAutoGenerateGround={handleAutoGenerateGround}
                  generatingGround={generatingGround}
                  groundProgress={groundProgress}
                  onAutoGenerateClimates={handleAutoGenerateClimates}
                  generatingClimates={generatingClimates}
                  onFillClimate={handleFillClimate}
                  groundRanges={groundRanges}
                  onGroundRangesChange={setGroundRanges}
                  onLayerUpdate={handleLayerUpdate}
                  bbox={bbox}
                  mapWidth={mapWidth}
                  mapHeight={mapHeight}
                />
                {workflowStep === 'regions' && (
                  <div className="px-3 pb-3 border-t border-slate-700 mt-2 pt-2 space-y-3">
                    <RegionsWorkshop
                      bbox={bbox}
                      layers={layers}
                      onLayerUpdate={handleLayerUpdate}
                      mapWidth={mapWidth}
                      mapHeight={mapHeight}
                      settlements={settlements}
                      onSettlementsChange={setSettlements}
                      onAssetReady={registerExtraAsset}
                    />
                    <OsmHistoricTagFetcher
                      bbox={bbox}
                      mapW={mapWidth}
                      mapH={mapHeight}
                      onAssetReady={registerExtraAsset}
                      onToggleOverlay={handleToggleHistoricOverlay}
                      visibleOverlays={historicOverlays}
                      tagStates={historicTagStates}
                      onTagStatesChange={setHistoricTagStates}
                    />
                  </div>
                )}
              </div>
            )}

            {/* ── EXPORT tab (edit phase) ── */}
            {currentTab === 'export' && phase === 'edit' && (
              <div className="p-3">
                <ExportPanel
                  layers={layers}
                  mapWidth={mapWidth}
                  mapHeight={mapHeight}
                  extraAssets={extraAssets}
                  settlements={settlements}
                  historicTagStates={historicTagStates}
                />
              </div>
            )}
          </div>
        </div>

        {/* Center: Map canvas */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          <MapCanvas
            layers={layers}
            activeLayerId={activeLayerId}
            activeTool={phase === 'edit' && currentTab === 'layers' ? activeTool : 'none'}
            brushSize={brushSize}
            color={color}
            onLayerUpdate={handleLayerUpdate}
            onCoordsChange={setCoords}
            selectionMode={selectionMode}
            selection={selection}
            onSelectionUpdate={handleSelectionUpdate}
            onPickColor={setColor}
            bboxBounds={bbox}
            refLayers={refLayers}
            box={box}
            onBoxChange={setBox}
            historicOverlays={historicOverlays}
          />
          <MapStatusBar
            coords={coords}
            activeLayerId={activeLayerId}
            layers={layers}
            mapWidth={mapWidth}
            mapHeight={mapHeight}
          />

          {phase === 'browse' && !selectionMode && !box && (
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="bg-slate-900/90 border border-amber-600/40 rounded-lg px-4 py-2 text-[12px] text-amber-300 text-center shadow-xl">
                Navigate the map, then click <strong>"Draw Selection Box"</strong> in the sidebar
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}