import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Rectangle, useMapEvents, ImageOverlay, useMap } from 'react-leaflet';
import { hexToRgb } from '@/lib/mapLayerStore';
import { ReferenceLayerTiles } from './ReferenceLayers';
import OhmOverlay from './OhmOverlay';
import SelectionBox from './SelectionBox';
import 'leaflet/dist/leaflet.css';

function floodFill(imageData, startX, startY, fillColor) {
  const { data, width, height } = imageData;
  const idx = (y, x) => (y * width + x) * 4;
  const si = idx(startY, startX);
  const targetColor = [data[si], data[si+1], data[si+2], data[si+3]];
  if (targetColor.every((v, i) => v === fillColor[i])) return;
  const stack = [[startX, startY]];
  const match = (i) => data[i]===targetColor[0] && data[i+1]===targetColor[1] && data[i+2]===targetColor[2];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const i = idx(y, x);
    if (!match(i)) continue;
    data[i]=fillColor[0]; data[i+1]=fillColor[1]; data[i+2]=fillColor[2]; data[i+3]=fillColor[3];
    stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
  }
}

// Convert latlng → pixel coords using the fixed bbox bounds (not viewport)
function latlngToPixel(latlng, bboxBounds, imgWidth, imgHeight) {
  if (!bboxBounds) return null;
  const { north, south, west, east } = bboxBounds;
  const px = Math.round(((latlng.lng - west) / (east - west)) * (imgWidth - 1));
  const py = Math.round(((north - latlng.lat) / (north - south)) * (imgHeight - 1));
  return { px, py };
}

// Controls map drag — disable while painting, enable otherwise
function DragController({ disabled }) {
  const map = useMap();
  useEffect(() => {
    if (disabled) {
      map.dragging.disable();
    } else {
      map.dragging.enable();
    }
  }, [disabled, map]);
  return null;
}

// Scroll wheel zoom controller
function ZoomController({ disabled }) {
  const map = useMap();
  useEffect(() => {
    if (disabled) {
      map.scrollWheelZoom.disable();
    } else {
      map.scrollWheelZoom.enable();
    }
  }, [disabled, map]);
  return null;
}

function imageDataToObjectUrl(imageData) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    if (!canvas.toBlob) {
      resolve(canvas.toDataURL('image/png'));
      return;
    }
    canvas.toBlob((blob) => {
      resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png'));
    }, 'image/png');
  });
}

function revokeOverlayUrl(url) {
  if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
}

function useOverlayUrls(layers, historicOverlays) {
  const [overlayUrls, setOverlayUrls] = useState({ layers: {}, historic: {} });
  const cacheRef = useRef({ layers: {}, historic: {} });

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      const nextCache = { layers: {}, historic: {} };
      const jobs = [];

      const queue = (kind, id, imageData) => {
        const cached = cacheRef.current[kind][id];
        if (cached?.src === imageData) {
          nextCache[kind][id] = cached;
          return;
        }
        jobs.push(
          imageDataToObjectUrl(imageData).then((url) => ({ kind, id, src: imageData, url }))
        );
      };

      for (const [id, layer] of Object.entries(layers)) {
        if (layer?.imageData && layer.visible !== false) queue('layers', id, layer.imageData);
      }
      for (const [id, imageData] of Object.entries(historicOverlays)) {
        if (imageData) queue('historic', id, imageData);
      }

      Promise.all(jobs).then((results) => {
        if (cancelled) {
          for (const item of results) revokeOverlayUrl(item.url);
          return;
        }
        for (const item of results) nextCache[item.kind][item.id] = item;

        const keptUrls = new Set([
          ...Object.values(nextCache.layers).map(item => item.url),
          ...Object.values(nextCache.historic).map(item => item.url),
        ]);
        for (const group of Object.values(cacheRef.current)) {
          for (const item of Object.values(group)) {
            if (!keptUrls.has(item.url)) revokeOverlayUrl(item.url);
          }
        }

        cacheRef.current = nextCache;
        setOverlayUrls({
          layers: Object.fromEntries(Object.entries(nextCache.layers).map(([id, item]) => [id, item.url])),
          historic: Object.fromEntries(Object.entries(nextCache.historic).map(([id, item]) => [id, item.url])),
        });
      });
    }, 40);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [layers, historicOverlays]);

  useEffect(() => () => {
    for (const group of Object.values(cacheRef.current)) {
      for (const item of Object.values(group)) revokeOverlayUrl(item.url);
    }
  }, []);

  return overlayUrls;
}

// Map event handler
function MapEventHandler({ onMouseDown, onMouseMove, onMouseUp, onCoordsChange, selectionMode, onSelectionUpdate }) {
  const selecting = useRef(false);
  const startLatLng = useRef(null);

  useMapEvents({
    mousemove(e) {
      onCoordsChange(e.latlng);
      if (selectionMode && selecting.current) {
        onSelectionUpdate({ start: startLatLng.current, end: e.latlng });
      } else if (!selectionMode) {
        onMouseMove(e.latlng);
      }
    },
    mousedown(e) {
      if (selectionMode) {
        selecting.current = true;
        startLatLng.current = e.latlng;
      } else {
        onMouseDown(e.latlng);
      }
    },
    mouseup(e) {
      if (selectionMode) {
        selecting.current = false;
        onSelectionUpdate({ start: startLatLng.current, end: e.latlng, confirmed: true });
      } else {
        onMouseUp(e.latlng);
      }
    },
  });
  return null;
}

export default function MapCanvas({
  layers, activeLayerId, activeTool, brushSize, color,
  onLayerUpdate, onCoordsChange, selectionMode, selection, onSelectionUpdate,
  onPickColor, bboxBounds,
  refLayers,
  ohmVisible, ohmYear, ohmOpacity,
  // CotaMap-style box
  box, onBoxChange,
  // Historic tag overlays: key → ImageData
  historicOverlays = {},
}) {
  const isPainting = useRef(false);
  const [dragDisabled, setDragDisabled] = useState(false);
  const overlayUrls = useOverlayUrls(layers, historicOverlays);

  const isPaintTool = activeTool === 'brush' || activeTool === 'eraser' || activeTool === 'river' || activeTool === 'fill';

  const applyPaint = useCallback((latlng) => {
    const layer = layers[activeLayerId];
    if (!layer?.imageData) return;
    const iw = layer.imageData.width;
    const ih = layer.imageData.height;
    const pos = latlngToPixel(latlng, bboxBounds, iw, ih);
    if (!pos) return;
    const { px, py } = pos;
    if (px < 0 || py < 0 || px >= iw || py >= ih) return;

    const rgb = activeTool === 'eraser' ? { r: 0, g: 0, b: 0 } : hexToRgb(color);
    const { r, g, b } = rgb;

    if (activeTool === 'fill') {
      const copy = new ImageData(new Uint8ClampedArray(layer.imageData.data), iw, ih);
      floodFill(copy, px, py, [r, g, b, 255]);
      onLayerUpdate(activeLayerId, { ...layer, imageData: copy, dirty: true });
    } else {
      const copy = new ImageData(new Uint8ClampedArray(layer.imageData.data), iw, ih);
      const radius = activeTool === 'river' ? 0 : Math.max(1, brushSize / 2);
      const radiusSq = radius * radius;
      const x0 = Math.max(0, Math.floor(px - radius));
      const x1 = Math.min(iw - 1, Math.ceil(px + radius));
      const y0 = Math.max(0, Math.floor(py - radius));
      const y1 = Math.min(ih - 1, Math.ceil(py + radius));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (radius > 0) {
            const dx = x - px;
            const dy = y - py;
            if (dx * dx + dy * dy > radiusSq) continue;
          }
          const i = (y * iw + x) * 4;
          copy.data[i] = r;
          copy.data[i + 1] = g;
          copy.data[i + 2] = b;
          copy.data[i + 3] = 255;
        }
      }
      onLayerUpdate(activeLayerId, { ...layer, imageData: copy, dirty: true });
    }
  }, [activeTool, brushSize, color, layers, activeLayerId, onLayerUpdate, bboxBounds]);

  const pickColor = useCallback((latlng) => {
    const layer = layers[activeLayerId];
    if (!layer?.imageData) return;
    const iw = layer.imageData.width;
    const ih = layer.imageData.height;
    const pos = latlngToPixel(latlng, bboxBounds, iw, ih);
    if (!pos) return;
    const { px, py } = pos;
    if (px < 0 || py < 0 || px >= iw || py >= ih) return;
    const d = layer.imageData.data;
    const i = (py * iw + px) * 4;
    const hex = '#' + [d[i],d[i+1],d[i+2]].map(v => v.toString(16).padStart(2,'0')).join('');
    onPickColor(hex);
  }, [layers, activeLayerId, bboxBounds, onPickColor]);

  const handleMouseDown = useCallback((latlng) => {
    if (activeTool === 'picker') {
      pickColor(latlng);
      return;
    }
    if (isPaintTool) {
      isPainting.current = true;
      setDragDisabled(true);
      applyPaint(latlng);
    }
  }, [activeTool, isPaintTool, applyPaint, pickColor]);

  const handleMouseMove = useCallback((latlng) => {
    if (isPainting.current && isPaintTool) {
      applyPaint(latlng);
    }
  }, [isPaintTool, applyPaint]);

  const handleMouseUp = useCallback((latlng) => {
    if (isPainting.current) {
      applyPaint(latlng);
      isPainting.current = false;
      setDragDisabled(false);
    }
  }, [applyPaint]);

  const layerBounds = bboxBounds
    ? [[bboxBounds.south, bboxBounds.west], [bboxBounds.north, bboxBounds.east]]
    : [[-85.051129, -180], [85.051129, 180]];

  return (
    <MapContainer
      center={[45, 15]} zoom={4}
      style={{ width: '100%', height: '100%' }}
      zoomControl={true}
    >
      {refLayers ? (
        <ReferenceLayerTiles refLayers={refLayers} />
      ) : (
        <TileLayer
          url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenTopoMap contributors'
          opacity={0.7}
          maxZoom={17}
        />
      )}

      {ohmVisible && ohmYear && (
        <OhmOverlay ohmYear={ohmYear} opacity={ohmOpacity ?? 0.5} />
      )}

      {Object.entries(layers).map(([id, layer]) => {
        if (!layer?.imageData || layer.visible === false) return null;
        const url = overlayUrls.layers[id];
        if (!url) return null;
        return (
          <ImageOverlay key={id} url={url} bounds={layerBounds}
            opacity={layer.opacity ?? 0.7}
            className="pixelated-overlay"
          />
        );
      })}

      {/* Historic tag overlays (show/hide from sidebar) */}
      {Object.entries(historicOverlays).map(([key, imageData]) => {
        if (!imageData) return null;
        const url = overlayUrls.historic[key];
        if (!url) return null;
        return (
          <ImageOverlay key={`historic-${key}`} url={url} bounds={layerBounds}
            opacity={0.9} className="pixelated-overlay" />
        );
      })}

      {bboxBounds && (
        <Rectangle
          bounds={[[bboxBounds.south, bboxBounds.west], [bboxBounds.north, bboxBounds.east]]}
          pathOptions={{ color: '#f59e0b', weight: 2, fillOpacity: 0, dashArray: '6 3' }}
        />
      )}

      {/* CotaMap-style interactive selection box */}
      {box && <SelectionBox box={box} onChange={onBoxChange} />}

      {/* Legacy simple rectangle during initial draw */}
      {selectionMode && !box && selection?.start && selection?.end && (
        <Rectangle
          bounds={[
            [Math.min(selection.start.lat, selection.end.lat), Math.min(selection.start.lng, selection.end.lng)],
            [Math.max(selection.start.lat, selection.end.lat), Math.max(selection.start.lng, selection.end.lng)],
          ]}
          pathOptions={{ color: '#f59e0b', weight: 2, fillOpacity: 0.15 }}
        />
      )}

      <DragController disabled={dragDisabled || selectionMode} />
      <ZoomController disabled={selectionMode} />
      <MapEventHandler
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onCoordsChange={onCoordsChange}
        selectionMode={selectionMode}
        onSelectionUpdate={onSelectionUpdate}
      />
    </MapContainer>
  );
}
