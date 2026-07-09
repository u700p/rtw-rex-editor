import React, { useRef, useEffect, useCallback, useState } from 'react';
import { LAYER_DEFS, LAYER_BY_ID } from './mapLayerConstants';
import MapPixelTooltip from './MapPixelTooltip';

const DRAW_ORDER = ['heights', 'ground', 'climates', 'regions', 'features', 'fog'];
const DRAW_LAYERS = DRAW_ORDER.map(id => [id, LAYER_BY_ID[id]]);
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

function closeBitmap(bitmap) {
  if (bitmap && typeof bitmap.close === 'function') bitmap.close();
}

function replaceCachedBitmap(cache, key, next) {
  const prev = cache[key];
  if (prev?.bmp && prev.bmp !== next?.bmp) closeBitmap(prev.bmp);
  if (next) cache[key] = next;
  else delete cache[key];
  return !!prev || !!next;
}

function buildRegionHighlightBitmap(data, width, height, hr, hg, hb) {
  const out = new Uint8ClampedArray(width * height * 4);
  const rowSize = width * 4;
  const isRegionAt = (idx) => data[idx] === hr && data[idx + 1] === hg && data[idx + 2] === hb;

  for (let y = 0; y < height; y++) {
    const row = y * rowSize;
    for (let x = 0; x < width; x++) {
      const idx = row + x * 4;
      if (!isRegionAt(idx)) continue;
      const isBorder =
        x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
        !isRegionAt(idx - 4) ||
        !isRegionAt(idx + 4) ||
        !isRegionAt(idx - rowSize) ||
        !isRegionAt(idx + rowSize);
      if (!isBorder) continue;
      out[idx] = 255;
      out[idx + 1] = 220;
      out[idx + 2] = 0;
      out[idx + 3] = 255;
    }
  }

  return createImageBitmap(new ImageData(out, width, height));
}

function colorKey(r, g, b) {
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

function hashColor(name) {
  let hash = 2166136261;
  for (const ch of String(name || 'region')) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const h = Math.abs(hash) % 360;
  const c = 0.52;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = 0.34;
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

function factionPrimaryColor(factionColors, faction) {
  const direct = factionColors?.[faction]?.primaryColor;
  if (direct) return direct;
  const lower = String(faction || '').toLowerCase();
  const key = Object.keys(factionColors || {}).find(name => name.toLowerCase() === lower);
  return key ? factionColors[key]?.primaryColor : null;
}

function buildStrategicOverlayBitmap(data, width, height, regionsData, overlayItems, factionColors, mode = 'owners') {
  const ownerByRegion = new Map();
  for (const item of overlayItems || []) {
    if (item?.category !== 'settlement' || !item.region || !item.faction) continue;
    ownerByRegion.set(String(item.region).toLowerCase(), item.faction);
  }

  const colorByRegionRgb = new Map();
  for (const region of regionsData || []) {
    const regionName = String(region.regionName || '').toLowerCase();
    const faction = ownerByRegion.get(regionName) || region.factionCreator || region.rebelFaction || '';
    if (!faction || String(faction).toLowerCase() === 'slave') continue;
    const fc = factionPrimaryColor(factionColors, faction) || hashColor(faction);
    colorByRegionRgb.set(colorKey(region.r, region.g, region.b), {
      r: Math.round(fc.r * 0.82 + 28),
      g: Math.round(fc.g * 0.82 + 28),
      b: Math.round(fc.b * 0.82 + 28),
    });
  }

  const out = new Uint8ClampedArray(width * height * 4);
  if (!colorByRegionRgb.size) return createImageBitmap(new ImageData(out, width, height));

  for (let pixel = 0; pixel < width * height; pixel++) {
    const i = pixel * 4;
    const color = colorByRegionRgb.get(colorKey(data[i], data[i + 1], data[i + 2]));
    if (!color) continue;
    out[i] = color.r;
    out[i + 1] = color.g;
    out[i + 2] = color.b;
    out[i + 3] = mode === 'solid' ? 235 : 185;
  }

  const rowSize = width * 4;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * rowSize + x * 4;
      if (!out[i + 3]) continue;
      const key = colorKey(data[i], data[i + 1], data[i + 2]);
      if (
        colorKey(data[i - 4], data[i - 3], data[i - 2]) !== key ||
        colorKey(data[i + 4], data[i + 5], data[i + 6]) !== key ||
        colorKey(data[i - rowSize], data[i - rowSize + 1], data[i - rowSize + 2]) !== key ||
        colorKey(data[i + rowSize], data[i + rowSize + 1], data[i + rowSize + 2]) !== key
      ) {
        out[i] = 18;
        out[i + 1] = 20;
        out[i + 2] = 26;
        out[i + 3] = 220;
      }
    }
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

function mapToLayerPixel(mapX, mapY, layer, mapW, mapH) {
  if (!layer?.data || mapW <= 0 || mapH <= 0) return null;
  const lx = Math.floor(mapX * (layer.width / mapW));
  const ly = Math.floor(mapY * (layer.height / mapH));
  if (lx < 0 || ly < 0 || lx >= layer.width || ly >= layer.height) return null;
  return { lx, ly };
}

export function floodFillRGB(data, width, height, sx, sy, nr, ng, nb, tolerance = 4) {
  if (!data || width <= 0 || height <= 0) return;
  sx = Math.trunc(sx);
  sy = Math.trunc(sy);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return;
  const startI = (sy * width + sx) * 4;
  const tr = data[startI], tg = data[startI+1], tb = data[startI+2];
  if (tr === nr && tg === ng && tb === nb) return;
  const total = width * height;
  const stack = new Int32Array(total);
  const visited = new Uint8Array(total);
  let top = 0;
  const startPi = sy * width + sx;
  stack[top++] = startPi;
  visited[startPi] = 1;
  while (top > 0) {
    const pi = stack[--top];
    const i = pi * 4;
    if (Math.abs(data[i]-tr) > tolerance || Math.abs(data[i+1]-tg) > tolerance || Math.abs(data[i+2]-tb) > tolerance) continue;
    data[i] = nr; data[i+1] = ng; data[i+2] = nb;
    const x = pi % width;
    const push = (next) => {
      if (!visited[next]) {
        visited[next] = 1;
        stack[top++] = next;
      }
    };
    if (x + 1 < width) push(pi + 1);
    if (x > 0) push(pi - 1);
    if (pi + width < total) push(pi + width);
    if (pi - width >= 0) push(pi - width);
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
  stratOverlayMode = 'off',
  stratOverlayOpacity = 0.65,
  overlayItems = [],
  factionColors = null,
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
  const featuresLayer = layers['features'];
  const fogLayer = layers['fog'];
  const regionsLayer = layers['regions'];
  const highlightR = highlightRegion?.r;
  const highlightG = highlightRegion?.g;
  const highlightB = highlightRegion?.b;
  const stratOverlaySignature = React.useMemo(() => {
    if (stratOverlayMode === 'off') return '';
    const settlements = (overlayItems || [])
      .filter(item => item?.category === 'settlement' && item.region && item.faction)
      .map(item => `${item.region}:${item.faction}`)
      .sort()
      .join('|');
    const regions = (regionsData || [])
      .map(region => `${region.regionName}:${region.r},${region.g},${region.b}:${region.factionCreator || ''}:${region.rebelFaction || ''}`)
      .join('|');
    const colors = Object.entries(factionColors || {})
      .map(([name, fc]) => `${name}:${fc?.primaryColor?.r ?? 0},${fc?.primaryColor?.g ?? 0},${fc?.primaryColor?.b ?? 0}`)
      .sort()
      .join('|');
    return `${stratOverlayMode}|${settlements}|${regions}|${colors}`;
  }, [stratOverlayMode, overlayItems, regionsData, factionColors]);

  // Build highlight bitmap — border-only outline of the selected region
  useEffect(() => {
    if (!regionsLayer?.data || highlightR == null || highlightG == null || highlightB == null) {
      if (replaceCachedBitmap(transCache.current, 'highlight', null)) setTransCacheVer(v => v + 1);
      return;
    }

    const cached = transCache.current.highlight;
    if (cached?.src === regionsLayer.data && cached.r === highlightR && cached.g === highlightG && cached.b === highlightB) return;

    let cancelled = false;
    const { data, width, height } = regionsLayer;
    buildRegionHighlightBitmap(data, width, height, highlightR, highlightG, highlightB).then(bmp => {
      if (cancelled) {
        closeBitmap(bmp);
        return;
      }
      replaceCachedBitmap(transCache.current, 'highlight', { bmp, src: data, r: highlightR, g: highlightG, b: highlightB });
      setTransCacheVer(v => v + 1);
    });
    return () => { cancelled = true; };
  }, [regionsLayer?.data, regionsLayer?.width, regionsLayer?.height, highlightR, highlightG, highlightB]);

  useEffect(() => {
    if (stratOverlayMode === 'off' || !regionsLayer?.data || !regionsData?.length) {
      if (replaceCachedBitmap(transCache.current, 'stratOverlay', null)) setTransCacheVer(v => v + 1);
      return;
    }
    const cached = transCache.current.stratOverlay;
    if (cached?.src === regionsLayer.data && cached.signature === stratOverlaySignature) return;

    let cancelled = false;
    buildStrategicOverlayBitmap(
      regionsLayer.data,
      regionsLayer.width,
      regionsLayer.height,
      regionsData,
      overlayItems,
      factionColors,
      stratOverlayMode
    ).then(bmp => {
      if (cancelled) {
        closeBitmap(bmp);
        return;
      }
      replaceCachedBitmap(transCache.current, 'stratOverlay', { bmp, src: regionsLayer.data, signature: stratOverlaySignature });
      setTransCacheVer(v => v + 1);
    });
    return () => { cancelled = true; };
  }, [
    stratOverlayMode,
    stratOverlaySignature,
    regionsLayer?.data,
    regionsLayer?.width,
    regionsLayer?.height,
    regionsData,
    overlayItems,
    factionColors,
  ]);

  useEffect(() => {
    let cancelled = false;
    const updateCache = (key, layer, builder) => {
      if (!layer?.data) {
        if (replaceCachedBitmap(transCache.current, key, null)) setTransCacheVer(v => v + 1);
        return;
      }
      if (transCache.current[key]?.src === layer.data) return;
      const src = layer.data;
      builder(src, layer.width, layer.height).then(bmp => {
        if (cancelled) {
          closeBitmap(bmp);
          return;
        }
        replaceCachedBitmap(transCache.current, key, { bmp, src });
        setTransCacheVer(v => v + 1);
      });
    };

    updateCache('features', featuresLayer, makeBlackTransparent);
    updateCache('fog', fogLayer, makeWhiteTransparent);
    updateCache('citiesports', regionsLayer, buildCitiesPortsBitmap);

    return () => { cancelled = true; };
  }, [
    featuresLayer?.data, featuresLayer?.width, featuresLayer?.height,
    fogLayer?.data, fogLayer?.width, fogLayer?.height,
    regionsLayer?.data, regionsLayer?.width, regionsLayer?.height,
  ]);

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

    for (const [id, def] of DRAW_LAYERS) {
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

    if (stratOverlayMode !== 'off' && transCache.current.stratOverlay?.bmp) {
      ctx.globalAlpha = stratOverlayOpacity;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(transCache.current.stratOverlay.bmp, 0, 0, mapW, mapH);
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
  }, [layers, transform, mapW, mapH, regionsMode, stratOverlayMode, stratOverlayOpacity, transCacheVer, showPixelGrid, highlightRegion]);

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
    const coords = mapToLayerPixel(mapX, mapY, layers[layerId], mapW, mapH);
    return coords ? { ...coords, mapX: Math.floor(mapX), mapY: Math.floor(mapY) } : null;
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
    if (mapW === 0 || !showTooltip) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const mapX = (sx - transform.x) / transform.scale;
    const mapY = (sy - transform.y) / transform.scale;
    if (mapX < 0 || mapY < 0 || mapX >= mapW || mapY >= mapH) { setProbe(null); return; }
    const regLayer = layers['regions'];
    const probeLayer = regLayer?.data ? regLayer : { data: true, width: mapW, height: mapH };
    const probeCoord = mapToLayerPixel(mapX, mapY, probeLayer, mapW, mapH);
    if (!probeCoord) { setProbe(null); return; }
    const dispX = probeCoord.lx;
    const sourceY = probeCoord.ly;
    const dispY = probeLayer.height - 1 - sourceY;
    const pixelData = {};
    for (const def of LAYER_DEFS) {
      const state = layers[def.id];
      if (!state?.data) continue;
      const layerCoord = mapToLayerPixel(mapX, mapY, state, mapW, mapH);
      if (!layerCoord) continue;
      const idx = (layerCoord.ly * state.width + layerCoord.lx) * 4;
      pixelData[def.id] = { r: state.data[idx], g: state.data[idx+1], b: state.data[idx+2], a: state.data[idx+3] };
    }
    setProbe({ x: dispX, y: dispY, sourceX: dispX, sourceY, screenX: sx, screenY: sy, pixelData });
  }, [paintState, doPencil, layers, transform, mapW, mapH, showTooltip]);

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
      const coords = mapToLayerPixel(mapX, mapY, regL?.data ? regL : { data: true, width: mapW, height: mapH }, mapW, mapH);
      if (coords) onRegionClick(coords.lx, coords.ly);
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
