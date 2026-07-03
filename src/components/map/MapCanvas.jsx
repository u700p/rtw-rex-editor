import React, { useRef, useEffect, useCallback, useState } from 'react';
import { LAYER_DEFS } from './mapLayerConstants';
import MapPixelTooltip from './MapPixelTooltip';

const DRAW_ORDER = ['heights', 'ground', 'climates', 'regions', 'features', 'fog'];
const MIN_SCALE = 0.05;
const MAX_SCALE = 100;

const CURSOR_PENCIL  = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Crect x='10' y='2' width='4' height='3' rx='1' fill='%23f59e0b' stroke='%23000' stroke-width='1' transform='rotate(-45 12 12)'/%3E%3Crect x='10' y='5' width='4' height='11' fill='%23fff' stroke='%23000' stroke-width='1' transform='rotate(-45 12 12)'/%3E%3Cpolygon points='10,16 14,16 12,20' fill='%23f5c842' stroke='%23000' stroke-width='1' transform='rotate(-45 12 12)'/%3E%3Cpolygon points='10.5,19 13.5,19 12,22' fill='%23333' transform='rotate(-45 12 12)'/%3E%3C/svg%3E") 2 22, crosshair`;
const CURSOR_PIPETTE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Crect x='9' y='3' width='6' height='10' rx='3' fill='%2338bdf8' stroke='%23000' stroke-width='1.2'/%3E%3Crect x='10.5' y='13' width='3' height='5' fill='%2338bdf8' stroke='%23000' stroke-width='1'/%3E%3Cpolygon points='10.5,18 13.5,18 12,22' fill='%2338bdf8' stroke='%23000' stroke-width='1'/%3E%3Crect x='10' y='5' width='4' height='1.5' rx='0.5' fill='white' opacity='0.6'/%3E%3C/svg%3E") 12 22, crosshair`;
const CURSOR_BUCKET  = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M3 8 L8 3 L11 6 L6 11 Z' fill='%23f59e0b' stroke='%23000' stroke-width='1'/%3E%3Crect x='9' y='8' width='3' height='7' rx='1' fill='%23ccc' stroke='%23000' stroke-width='0.8' transform='rotate(-45 10.5 11.5)'/%3E%3Cpath d='M13 11 Q18 13 19 16 Q21 20 18 21 Q15 22 14 19 Q13 16 13 11 Z' fill='%2338bdf8' stroke='%23000' stroke-width='1'/%3E%3Ccircle cx='17.5' cy='20' r='1.5' fill='%2338bdf8' stroke='%23000' stroke-width='0.8'/%3E%3C/svg%3E") 20 20, crosshair`;

function makeBlackTransparent(data, width, height) {
  const rgba = new Uint8ClampedArray(data);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] < 12 && rgba[i+1] < 12 && rgba[i+2] < 12) rgba[i+3] = 0;
  }
  return createImageBitmap(new ImageData(rgba, width, height));
}

function makeWhiteTransparent(data, width, height) {
  const rgba = new Uint8ClampedArray(data);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] > 243 && rgba[i+1] > 243 && rgba[i+2] > 243) rgba[i+3] = 0;
  }
  return createImageBitmap(new ImageData(rgba, width, height));
}

function buildCitiesPortsBitmap(data, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2];
    const isCity = r < 12 && g < 12 && b < 12;
    const isPort = r > 243 && g > 243 && b > 243;
    if (isCity || isPort) { out[i]=r; out[i+1]=g; out[i+2]=b; out[i+3]=255; }
  }
  return createImageBitmap(new ImageData(out, width, height));
}

function getCanvasSize(layers) {
  const reg = layers['regions'];
  if (reg?.bitmap) return { w: reg.bitmap.width, h: reg.bitmap.height };
  let w = 0, h = 0;
  for (const def of LAYER_DEFS) {
    const s = layers[def.id];
    if (s?.bitmap) { if (s.bitmap.width > w) w = s.bitmap.width; if (s.bitmap.height > h) h = s.bitmap.height; }
  }
  return { w, h };
}

export function floodFillRGB(data, width, height, sx, sy, nr, ng, nb, tolerance = 4) {
  const startI = (sy * width + sx) * 4;
  const tr = data[startI], tg = data[startI+1], tb = data[startI+2];
  if (tr === nr && tg === ng && tb === nb) return;
  const stack = [[sx, sy]];
  const visited = new Uint8Array(width * height);
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const pi = y * width + x;
    if (visited[pi]) continue;
    visited[pi] = 1;
    const i = pi * 4;
    if (Math.abs(data[i]-tr) > tolerance || Math.abs(data[i+1]-tg) > tolerance || Math.abs(data[i+2]-tb) > tolerance) continue;
    data[i] = nr; data[i+1] = ng; data[i+2] = nb;
    stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
  }
}

function drawPixelGrid(ctx, layerW, layerH, mapW, mapH, scale, color = 'rgba(255,255,255,0.15)') {
  const pxW = mapW / layerW * scale;
  const pxH = mapH / layerH * scale;
  if (pxW < 2 || pxH < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5 / scale;
  for (let x = 0; x <= layerW; x++) { const mx = x * (mapW / layerW); ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, mapH); ctx.stroke(); }
  for (let y = 0; y <= layerH; y++) { const my = y * (mapH / layerH); ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(mapW, my); ctx.stroke(); }
  ctx.restore();
}

export default function MapCanvas({
  layers, regionsMode = 'fill',
  onRegionClick, jumpRef,
  paintState, onPaint,
  showPixelGrid = false,
  showTooltip = true,
  osmBackground = null,
  onTransformChange,
  regionsData,
  settlementNames,
  highlightRegion,
}) {
  const canvasRef    = useRef(null);
  const containerRef = useRef(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });

  useEffect(() => { if (onTransformChange) onTransformChange(transform); }, [transform, onTransformChange]);

  const dragging   = useRef(false);
  const lastMouse  = useRef({ x: 0, y: 0 });
  const didDrag    = useRef(false);
  const isPainting = useRef(false);
  const [probe, setProbe] = useState(null);
  const transCache = useRef({});
  const [transCacheVer, setTransCacheVer] = useState(0);
  const { w: mapW, h: mapH } = getCanvasSize(layers);

  // Build highlight bitmap — border-only outline of the selected region
  useEffect(() => {
    const regState = layers['regions'];
    if (!regState?.data || !highlightRegion) {
      delete transCache.current.highlight;
      setTransCacheVer(v => v + 1);
      return;
    }
    const { r: hr, g: hg, b: hb } = highlightRegion;
    const { data, width, height } = regState;
    // Build a mask of which pixels belong to the region
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i] === hr && data[i + 1] === hg && data[i + 2] === hb) mask[y * width + x] = 1;
      }
    }
    // Only draw pixels that are on the edge (have at least one non-region neighbour)
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!mask[y * width + x]) continue;
        let isBorder = false;
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]) { isBorder = true; break; }
        }
        if (isBorder) {
          const oi = (y * width + x) * 4;
          out[oi] = 255; out[oi + 1] = 220; out[oi + 2] = 0; out[oi + 3] = 255;
        }
      }
    }
    createImageBitmap(new ImageData(out, width, height)).then(bmp => {
      transCache.current.highlight = { bmp, r: hr, g: hg, b: hb };
      setTransCacheVer(v => v + 1);
    });
  }, [layers, highlightRegion]);

  useEffect(() => {
    const featState = layers['features'];
    if (featState?.data && transCache.current.features?.src !== featState.data) {
      makeBlackTransparent(featState.data, featState.width, featState.height)
        .then(bmp => { transCache.current.features = { bmp, src: featState.data }; setTransCacheVer(v => v+1); });
    }
    if (!featState?.data) delete transCache.current.features;

    const fogState = layers['fog'];
    if (fogState?.data && transCache.current.fog?.src !== fogState.data) {
      makeWhiteTransparent(fogState.data, fogState.width, fogState.height)
        .then(bmp => { transCache.current.fog = { bmp, src: fogState.data }; setTransCacheVer(v => v+1); });
    }
    if (!fogState?.data) delete transCache.current.fog;

    const regState = layers['regions'];
    if (regState?.data && transCache.current.citiesports?.src !== regState.data) {
      buildCitiesPortsBitmap(regState.data, regState.width, regState.height)
        .then(bmp => { transCache.current.citiesports = { bmp, src: regState.data }; setTransCacheVer(v => v+1); });
    }
    if (!regState?.data) delete transCache.current.citiesports;

    setTransCacheVer(v => v + 1);
  }, [layers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || mapW === 0) return;
    const container = containerRef.current;
    canvas.width  = container.clientWidth;
    canvas.height = container.clientHeight;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);

    for (const id of DRAW_ORDER) {
      const def   = LAYER_DEFS.find(d => d.id === id);
      const state = layers[id];
      if (!state?.bitmap) continue;
      if (!(state.visible ?? def.defaultVisible)) continue;
      ctx.globalAlpha = state.opacity ?? def.defaultOpacity;
      ctx.globalCompositeOperation = 'source-over';
      if (id === 'features' && transCache.current.features?.bmp) {
        ctx.drawImage(transCache.current.features.bmp, 0, 0, mapW, mapH);
      } else if (id === 'fog' && transCache.current.fog?.bmp) {
        ctx.drawImage(transCache.current.fog.bmp, 0, 0, mapW, mapH);
      } else if (id === 'regions' && regionsMode === 'citiesports' && transCache.current.citiesports?.bmp) {
        ctx.drawImage(transCache.current.citiesports.bmp, 0, 0, mapW, mapH);
      } else {
        ctx.drawImage(state.bitmap, 0, 0, mapW, mapH);
      }
    }

    // Draw region highlight overlay
    if (transCache.current.highlight?.bmp) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(transCache.current.highlight.bmp, 0, 0, mapW, mapH);
    }

    if (showPixelGrid) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      const fineLayer = layers['regions'] || layers['features'];
      if (fineLayer?.width) drawPixelGrid(ctx, fineLayer.width, fineLayer.height, mapW, mapH, transform.scale, 'rgba(255,255,255,0.18)');
      const coarseLayer = layers['ground'] || layers['climates'];
      if (coarseLayer?.width) drawPixelGrid(ctx, coarseLayer.width, coarseLayer.height, mapW, mapH, transform.scale, 'rgba(255,200,80,0.10)');
    }
    ctx.restore();
  }, [layers, transform, mapW, mapH, regionsMode, transCacheVer, showPixelGrid, highlightRegion]);

  const fitToContainer = useCallback(() => {
    const container = containerRef.current;
    if (!container || mapW === 0) return;
    const scale = Math.min(container.clientWidth / mapW, container.clientHeight / mapH);
    setTransform({ x: 0, y: 0, scale });
  }, [mapW, mapH]);

  useEffect(() => { if (mapW > 0) fitToContainer(); }, [mapW]);

  useEffect(() => {
    if (!jumpRef) return;
    jumpRef.current = (mapX, mapY) => {
      const container = containerRef.current;
      if (!container) return;
      const cx = container.clientWidth / 2, cy = container.clientHeight / 2;
      setTransform(t => ({ scale: t.scale, x: cx - mapX * t.scale, y: cy - mapY * t.scale }));
    };
  }, [jumpRef]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? 1.15 : 1/1.15;
    setTransform(t => {
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.scale * delta));
      const factor   = newScale / t.scale;
      return { scale: newScale, x: mx - factor*(mx-t.x), y: my - factor*(my-t.y) };
    });
  }, []);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const screenToLayer = useCallback((clientX, clientY, layerId) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left, sy = clientY - rect.top;
    const mapX = (sx - transform.x) / transform.scale;
    const mapY = (sy - transform.y) / transform.scale;
    const layer = layers[layerId];
    if (!layer?.data) return null;
    const lx = Math.round(mapX * (layer.width  / mapW));
    const ly = Math.round(mapY * (layer.height / mapH));
    if (lx < 0 || ly < 0 || lx >= layer.width || ly >= layer.height) return null;
    return { lx, ly, mapX: Math.round(mapX), mapY: Math.round(mapY) };
  }, [transform, layers, mapW, mapH]);

  const doPencil = useCallback((clientX, clientY) => {
    if (!paintState?.active || !onPaint) return;
    const { layerId, paintColor, brushSize } = paintState;
    const coords = screenToLayer(clientX, clientY, layerId);
    if (!coords) return;
    const layer = layers[layerId];
    const half = Math.floor(brushSize / 2);
    const patches = [];
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const px = coords.lx + dx, py = coords.ly + dy;
        if (px >= 0 && py >= 0 && px < layer.width && py < layer.height) patches.push({ x: px, y: py });
      }
    }
    onPaint('pencil', layerId, paintColor, patches, null);
  }, [paintState, onPaint, screenToLayer, layers]);

  const doBucket = useCallback((clientX, clientY) => {
    if (!paintState?.active || !onPaint) return;
    const { layerId, paintColor } = paintState;
    const coords = screenToLayer(clientX, clientY, layerId);
    if (!coords) return;
    onPaint('bucket', layerId, paintColor, null, { x: coords.lx, y: coords.ly });
  }, [paintState, onPaint, screenToLayer]);

  const doPipette = useCallback((clientX, clientY) => {
    if (!paintState?.active || !onPaint) return;
    const { layerId } = paintState;
    const coords = screenToLayer(clientX, clientY, layerId);
    if (!coords) return;
    const layer = layers[layerId];
    const i = (coords.ly * layer.width + coords.lx) * 4;
    onPaint('pipette', layerId, { r: layer.data[i], g: layer.data[i+1], b: layer.data[i+2] }, null, null);
  }, [paintState, onPaint, screenToLayer, layers]);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (paintState?.active) {
      isPainting.current = true;
      didDrag.current = false;
      if (paintState.tool === 'bucket') doBucket(e.clientX, e.clientY);
      else if (paintState.tool === 'pipette') doPipette(e.clientX, e.clientY);
      else doPencil(e.clientX, e.clientY);
      return;
    }
    dragging.current = true;
    didDrag.current = false;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, [paintState, doPencil, doBucket, doPipette]);

  const handleMouseMove = useCallback((e) => {
    if (isPainting.current && paintState?.active && paintState.tool === 'pencil') doPencil(e.clientX, e.clientY);
    if (dragging.current) {
      const dx = e.clientX - lastMouse.current.x, dy = e.clientY - lastMouse.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDrag.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      setTransform(t => ({ ...t, x: t.x + dx, y: t.y + dy }));
    }
    if (mapW === 0) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const regLayer = layers['regions'];
    let dispX = 0, dispY = 0;
    if (regLayer?.width) {
      dispX = Math.round((sx - transform.x) / transform.scale * (regLayer.width  / mapW));
      dispY = Math.round((sy - transform.y) / transform.scale * (regLayer.height / mapH));
    } else {
      dispX = Math.round((sx - transform.x) / transform.scale);
      dispY = Math.round((sy - transform.y) / transform.scale);
    }
    const mapX = Math.round((sx - transform.x) / transform.scale);
    const mapY = Math.round((sy - transform.y) / transform.scale);
    if (mapX < 0 || mapY < 0 || mapX >= mapW || mapY >= mapH) { setProbe(null); return; }
    const pixelData = {};
    for (const def of LAYER_DEFS) {
      const state = layers[def.id];
      if (!state?.data) continue;
      const nx = Math.round(mapX * (state.width / mapW));
      const ny = Math.round(mapY * (state.height / mapH));
      const idx = (ny * state.width + nx) * 4;
      pixelData[def.id] = { r: state.data[idx], g: state.data[idx+1], b: state.data[idx+2], a: state.data[idx+3] };
    }
    setProbe({ x: dispX, y: dispY, screenX: sx, screenY: sy, pixelData });
  }, [paintState, doPencil, layers, transform, mapW, mapH]);

  const handleMouseUp = useCallback((e) => {
    if (isPainting.current) { isPainting.current = false; return; }
    const wasDrag = didDrag.current;
    dragging.current = false;
    didDrag.current = false;
    if (!wasDrag && mapW > 0 && onRegionClick) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const mapX = (sx - transform.x) / transform.scale;
      const mapY = (sy - transform.y) / transform.scale;
      const regL = layers['regions'];
      const rx = Math.floor(mapX * ((regL?.width || mapW) / mapW));
      const ry = Math.floor(mapY * ((regL?.height || mapH) / mapH));
      onRegionClick(rx, ry);
    }
  }, [mapW, onRegionClick, transform, layers]);

  const handleMouseLeave = () => { dragging.current = false; isPainting.current = false; setProbe(null); };
  const anyLoaded = Object.values(layers).some(s => s?.bitmap);
  const cursorStyle = paintState?.active
    ? (paintState.tool === 'pencil' ? CURSOR_PENCIL : paintState.tool === 'pipette' ? CURSOR_PIPETTE : CURSOR_BUCKET)
    : 'crosshair';
  const regLayer = layers['regions'];
  const dispW = regLayer?.width || mapW;
  const dispH = regLayer?.height || mapH;

  return (
    <div ref={containerRef} className={`relative w-full h-full select-none ${osmBackground ? 'bg-transparent' : 'bg-slate-950'}`}>
      {osmBackground}
      {!anyLoaded && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-600 text-sm flex-col gap-3">
          <div className="text-4xl">🗺️</div>
          <div>Load TGA map files from the layer panel or use the folder import</div>
          <div className="text-xs text-slate-700">Use the Layers tab on the right →</div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ imageRendering: 'pixelated', cursor: cursorStyle }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />
      {probe && showTooltip && (
        <MapPixelTooltip probe={probe} layers={layers} mapWidth={dispW} mapHeight={dispH} regionsData={regionsData} settlementNames={settlementNames} />
      )}
      <div className="absolute bottom-3 right-3 flex flex-col gap-1">
        <button onClick={() => setTransform(t => ({ ...t, scale: Math.min(MAX_SCALE, t.scale*1.5) }))}
          className="w-7 h-7 rounded bg-slate-800/80 border border-slate-600/50 text-slate-300 hover:bg-slate-700 text-sm font-bold flex items-center justify-center">+</button>
        <button onClick={() => setTransform(t => ({ ...t, scale: Math.max(MIN_SCALE, t.scale/1.5) }))}
          className="w-7 h-7 rounded bg-slate-800/80 border border-slate-600/50 text-slate-300 hover:bg-slate-700 text-sm font-bold flex items-center justify-center">−</button>
        <button onClick={fitToContainer}
          className="w-7 h-7 rounded bg-slate-800/80 border border-slate-600/50 text-slate-300 hover:bg-slate-700 text-[10px] flex items-center justify-center" title="Fit to view">⊡</button>
      </div>
      {anyLoaded && (
        <div className="absolute bottom-3 left-3 text-[10px] text-slate-600 font-mono">
          {probe ? `${probe.x},${probe.y}` : `${dispW}×${dispH}`} · zoom {Math.round(transform.scale * 100)}%
          {paintState?.active && <span className="text-amber-500 ml-2">● PAINT [{paintState.tool}]</span>}
        </div>
      )}
    </div>
  );
}