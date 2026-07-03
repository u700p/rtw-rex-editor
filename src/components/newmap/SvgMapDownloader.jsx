/**
 * SvgMapDownloader — fetches reference tile layers (OpenTopo, OSM Humanitarian)
 * for a bbox and packages them as an SVG with an embedded raster <image>.
 * The SVG viewBox uses decimal degrees so it is geographically scaled.
 */
import React, { useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { rasterizeTiles } from './TileRasterizer';

const REFERENCE_MAPS = [
  {
    id: 'opentopo',
    label: 'OpenTopoMap',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    color: 'bg-green-900/40 border-green-600/50 text-green-300 hover:bg-green-800/50',
  },
  {
    id: 'humanitarian',
    label: 'OSM Humanitarian',
    url: 'https://tile-a.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    color: 'bg-rose-900/40 border-rose-600/50 text-rose-300 hover:bg-rose-800/50',
  },
];

// Resolution for embedded raster — high enough for decent SVG quality
const SVG_RASTER_WIDTH = 2048;

function downloadSvg(svgContent, filename) {
  const blob = new Blob([svgContent], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function imageDataToDataUrl(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

export default function SvgMapDownloader({ bbox }) {
  const [status, setStatus] = useState({});
  const [progress, setProgress] = useState({});

  const lonSpan = bbox.east - bbox.west;
  const latSpan = bbox.north - bbox.south;
  // Preserve aspect ratio: width = lonSpan, height = latSpan (degrees)
  const svgW = lonSpan;
  const svgH = latSpan;
  const rasterH = Math.round(SVG_RASTER_WIDTH * (latSpan / lonSpan));

  const fetchAndDownload = async (map) => {
    setStatus(p => ({ ...p, [map.id]: `Fetching ${map.label} tiles…` }));
    setProgress(p => ({ ...p, [map.id]: 0 }));
    let imageData;
    try {
      imageData = await rasterizeTiles(
        map.url, bbox, SVG_RASTER_WIDTH, rasterH,
        (done, total) => setProgress(p => ({ ...p, [map.id]: Math.round(done / Math.max(total, 1) * 100) }))
      );
    } catch (e) {
      setStatus(p => ({ ...p, [map.id]: `Error: ${e.message}` }));
      setProgress(p => ({ ...p, [map.id]: null }));
      return;
    }

    const dataUrl = imageDataToDataUrl(imageData);

    // Build SVG: viewBox in decimal-degree space, image covers the full bbox
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 ${svgW.toFixed(6)} ${svgH.toFixed(6)}"
     width="${svgW.toFixed(6)}" height="${svgH.toFixed(6)}">
  <title>${map.label} — ${bbox.west.toFixed(3)}°W ${bbox.south.toFixed(3)}°S ${bbox.east.toFixed(3)}°E ${bbox.north.toFixed(3)}°N</title>
  <!-- Geographic bounds: W=${bbox.west} S=${bbox.south} E=${bbox.east} N=${bbox.north} -->
  <!-- CRS: WGS84 (EPSG:4326), origin top-left (NW corner) -->
  <image x="0" y="0"
         width="${svgW.toFixed(6)}" height="${svgH.toFixed(6)}"
         preserveAspectRatio="none"
         xlink:href="${dataUrl}" />
</svg>`;

    const filename = `${map.id}_${bbox.west.toFixed(2)}_${bbox.south.toFixed(2)}_${bbox.east.toFixed(2)}_${bbox.north.toFixed(2)}.svg`;
    downloadSvg(svg, filename);
    setStatus(p => ({ ...p, [map.id]: `✓ Downloaded ${map.label} SVG` }));
    setProgress(p => ({ ...p, [map.id]: null }));
  };

  return (
    <div className="border border-slate-700 rounded p-2.5 space-y-2">
      <p className="text-[10px] text-slate-300 font-semibold">Reference Map SVG Downloads</p>
      <p className="text-[9px] text-slate-500 leading-snug">
        Downloads the selected reference map for this bounding box as a scalable SVG with an embedded high-res raster. The SVG viewBox uses decimal degrees so it can be overlaid on geographic tools.
      </p>
      {REFERENCE_MAPS.map(map => (
        <div key={map.id} className="space-y-1">
          {status[map.id] && (
            <p className={`text-[9px] px-2 py-1 rounded border ${
              status[map.id].startsWith('✓') ? 'bg-green-900/20 border-green-600/30 text-green-400'
              : status[map.id].startsWith('Error') ? 'bg-red-900/20 border-red-600/30 text-red-400'
              : 'bg-slate-800 border-slate-600 text-slate-400'
            }`}>
              {status[map.id]}
              {progress[map.id] != null && ` (${progress[map.id]}%)`}
            </p>
          )}
          <button
            onClick={() => fetchAndDownload(map)}
            disabled={progress[map.id] != null}
            className={`w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-colors disabled:opacity-50 font-semibold ${map.color}`}
          >
            {progress[map.id] != null
              ? <RefreshCw className="w-3 h-3 animate-spin" />
              : <Download className="w-3 h-3" />}
            {progress[map.id] != null
              ? `Fetching… ${progress[map.id]}%`
              : `Download ${map.label} (SVG)`}
          </button>
        </div>
      ))}
    </div>
  );
}