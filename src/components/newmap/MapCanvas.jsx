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
    } else if (activeTool === 'river') {
      // Direct pixel write — 1px
      const copy = new ImageData(new Uint8ClampedArray(layer.imageData.data), iw, ih);
      const i = (py * iw + px) * 4;
      copy.data[i] = r; copy.data[i+1] = g; copy.data[i+2] = b; copy.data[i+3] = 255;
      onLayerUpdate(activeLayerId, { ...layer, imageData: copy, dirty: true });
    } else {
      // brush / eraser — draw circle on canvas
      const canvas = document.createElement('canvas');
      canvas.width = iw; canvas.height = ih;
      const ctx = canvas.getContext('2d');
      ctx.putImageData(layer.imageData, 0, 0);
      const radius = Math.max(1, brushSize / 2);
      if (activeTool === 'eraser') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgb(0,0,0)';
      } else {
        ctx.fillStyle = `rgb(${r},${g},${b})`;
      }
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
      const updated = ctx.getImageData(0, 0, iw, ih);
      onLayerUpdate(activeLayerId, { ...layer, imageData: updated, dirty: true });
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

  const getLayerDataURL = (layerId) => {
    const layer = layers[layerId];
    if (!layer?.imageData || layer.visible === false) return null;
    const canvas = document.createElement('canvas');
    canvas.width = layer.imageData.width; canvas.height = layer.imageData.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(layer.imageData, 0, 0);
    return canvas.toDataURL();
  };

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
        const url = getLayerDataURL(id);
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
        const canvas = document.createElement('canvas');
        canvas.width = imageData.width; canvas.height = imageData.height;
        canvas.getContext('2d').putImageData(imageData, 0, 0);
        return (
          <ImageOverlay key={`historic-${key}`} url={canvas.toDataURL()} bounds={layerBounds}
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