import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CheckCircle, AlertTriangle, Wrench, RefreshCw, Info } from 'lucide-react';

/**
 * RiverChecker — validates and auto-fixes the features (rivers) layer.
 *
 * Rules enforced (M2TW map_features.tga):
 *   1. River pixels must be pure blue (0,0,255) or white (255,255,255) [origin].
 *   2. Exactly ONE white pixel (the river origin/source).
 *   3. Each river pixel must have ≤ 2 river neighbors (8-directional) — no junctions/blobs.
 *   4. No isolated river pixel (0 neighbors) — rivers must connect.
 *
 * A pixel is a "river pixel" if it is pure blue OR white.
 */

function isRiverPixel(r, g, b, a) {
  if (a < 128) return false;
  if (r === 0 && g === 0 && b === 255) return true;   // blue
  if (r === 255 && g === 255 && b === 255) return true; // white origin
  return false;
}

function runValidation(imageData) {
  const { data, width, height } = imageData;
  const issues = [];

  let whiteCount = 0;
  let blueCount = 0;
  const overNeighborPixels = [];
  const isolatedPixels = [];
  const wrongColorPixels = []; // non-transparent, non-blue, non-white, non-black

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 10) continue; // transparent — skip

      const isBlue  = r === 0 && g === 0 && b === 255;
      const isWhite = r === 255 && g === 255 && b === 255;
      const isBlack = r === 0 && g === 0 && b === 0; // allowed (non-river terrain marker)

      if (isWhite) whiteCount++;
      if (isBlue)  blueCount++;

      if (!isBlue && !isWhite && !isBlack) {
        wrongColorPixels.push({ x, y });
      }

      if (isBlue || isWhite) {
        // Count river neighbors
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ni = (ny * width + nx) * 4;
            if (isRiverPixel(data[ni], data[ni + 1], data[ni + 2], data[ni + 3])) neighbors++;
          }
        }
        if (neighbors > 2) overNeighborPixels.push({ x, y, neighbors });
        if (neighbors === 0) isolatedPixels.push({ x, y });
      }
    }
  }

  if (blueCount === 0 && whiteCount === 0) {
    issues.push({ type: 'info', msg: 'No river pixels found on this layer.' });
  }
  if (whiteCount === 0 && blueCount > 0) {
    issues.push({ type: 'error', msg: 'Missing origin pixel — no white (255,255,255) pixel found.' });
  }
  if (whiteCount > 1) {
    issues.push({ type: 'error', msg: `Multiple origin pixels (${whiteCount} white pixels). Should be exactly 1.` });
  }
  if (overNeighborPixels.length > 0) {
    issues.push({ type: 'error', msg: `${overNeighborPixels.length} river pixel(s) have >2 neighbors (thick junctions). Auto-fix can thin them.` });
  }
  if (isolatedPixels.length > 0) {
    issues.push({ type: 'warn', msg: `${isolatedPixels.length} isolated river pixel(s) with 0 neighbors. Consider removing them.` });
  }
  if (wrongColorPixels.length > 0) {
    issues.push({ type: 'warn', msg: `${wrongColorPixels.length} non-standard pixel(s) (not blue, white, or black). Auto-fix will remove them.` });
  }

  return {
    issues,
    blueCount,
    whiteCount,
    overNeighborPixels,
    isolatedPixels,
    wrongColorPixels,
    ok: issues.filter(i => i.type === 'error').length === 0,
  };
}

function autoFixRivers(imageData) {
  const { data, width, height } = imageData;
  const fixed = new ImageData(new Uint8ClampedArray(data), width, height);
  const fd = fixed.data;

  const isRiver = (i) => {
    const r = fd[i], g = fd[i + 1], b = fd[i + 2], a = fd[i + 3];
    return isRiverPixel(r, g, b, a);
  };

  // Step 1: normalize all near-blue pixels to pure blue; remove wrong-color non-transparent pixels
  for (let i = 0; i < fd.length; i += 4) {
    const r = fd[i], g = fd[i + 1], b = fd[i + 2], a = fd[i + 3];
    if (a < 10) continue;
    const isBlue  = r === 0 && g === 0 && b === 255;
    const isWhite = r === 255 && g === 255 && b === 255;
    const isBlack = r === 0 && g === 0 && b === 0;
    if (!isBlue && !isWhite && !isBlack) {
      // Remove non-standard pixels
      fd[i + 3] = 0;
    }
  }

  // Step 2: fix white count — keep only first white pixel found (top-left scan)
  let originSet = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = fd[i], g = fd[i + 1], b = fd[i + 2], a = fd[i + 3];
      if (a < 10) continue;
      if (r === 255 && g === 255 && b === 255) {
        if (!originSet) {
          originSet = true; // keep this one
        } else {
          // Convert extra white pixels to blue
          fd[i] = 0; fd[i + 1] = 0; fd[i + 2] = 255;
        }
      }
    }
  }

  // Step 3: if no origin exists but there are blue pixels, set first blue pixel to white
  if (!originSet) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (fd[i] === 0 && fd[i + 1] === 0 && fd[i + 2] === 255 && fd[i + 3] > 128) {
          fd[i] = 255; fd[i + 1] = 255; fd[i + 2] = 255;
          break;
        }
      }
      if (originSet) break;
    }
  }

  // Step 4: thin rivers — remove pixels with >2 river neighbors (up to 5 passes)
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (!isRiver(i)) continue;
        // Don't remove origin
        if (fd[i] === 255 && fd[i + 1] === 255 && fd[i + 2] === 255) continue;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            if (isRiver((ny * width + nx) * 4)) count++;
          }
        }
        if (count > 2) {
          fd[i + 3] = 0;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  return fixed;
}

/** Render a small preview canvas highlighting errors */
function ValidationPreview({ imageData, overNeighborPixels, isolatedPixels, wrongColorPixels }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageData) return;
    const { width, height } = imageData;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);

    // Highlight problematic pixels
    const highlight = (pixels, color) => {
      ctx.fillStyle = color;
      pixels.forEach(({ x, y }) => ctx.fillRect(x - 1, y - 1, 3, 3));
    };
    highlight(overNeighborPixels, 'rgba(255,60,60,0.9)');
    highlight(isolatedPixels, 'rgba(255,200,0,0.9)');
    highlight(wrongColorPixels, 'rgba(255,0,255,0.9)');
  }, [imageData, overNeighborPixels, isolatedPixels, wrongColorPixels]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full border border-slate-700 rounded"
      style={{ imageRendering: 'pixelated', maxHeight: 180 }}
    />
  );
}

export default function RiverChecker({ featureLayer, onLayerUpdate }) {
  const [result, setResult] = useState(null);
  const [fixing, setFixing] = useState(false);

  const runCheck = useCallback(() => {
    if (!featureLayer?.imageData) return;
    const r = runValidation(featureLayer.imageData);
    setResult(r);
  }, [featureLayer]);

  // Auto-run whenever the layer changes
  useEffect(() => {
    if (featureLayer?.imageData) runCheck();
    else setResult(null);
  }, [featureLayer, runCheck]);

  const handleAutoFix = async () => {
    if (!featureLayer?.imageData) return;
    setFixing(true);
    await new Promise(r => setTimeout(r, 30));
    const fixed = autoFixRivers(featureLayer.imageData);
    onLayerUpdate('features', { imageData: fixed, visible: true, opacity: featureLayer.opacity ?? 0.9, dirty: true });
    setFixing(false);
  };

  if (!featureLayer?.imageData) {
    return (
      <div className="text-[10px] text-slate-500 text-center py-4">
        No features layer loaded yet.
      </div>
    );
  }

  const hasErrors = result && result.issues.some(i => i.type === 'error');
  const hasWarns  = result && result.issues.some(i => i.type === 'warn');

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">River Validator</p>
        <button onClick={runCheck}
          className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-slate-700 border border-slate-600 text-slate-300 hover:bg-slate-600 transition-colors">
          <RefreshCw className="w-2.5 h-2.5" /> Re-check
        </button>
      </div>

      {/* Stats */}
      {result && (
        <div className="bg-slate-800 rounded border border-slate-700 px-2 py-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px]">
          <span className="text-slate-500">River pixels (blue)</span>
          <span className="text-slate-200 font-mono">{result.blueCount}</span>
          <span className="text-slate-500">Origin pixel (white)</span>
          <span className="text-slate-200 font-mono">{result.whiteCount}</span>
          <span className="text-slate-500">Over-neighbor pixels</span>
          <span className={`font-mono ${result.overNeighborPixels.length > 0 ? 'text-red-400' : 'text-slate-200'}`}>
            {result.overNeighborPixels.length}
          </span>
          <span className="text-slate-500">Isolated pixels</span>
          <span className={`font-mono ${result.isolatedPixels.length > 0 ? 'text-yellow-400' : 'text-slate-200'}`}>
            {result.isolatedPixels.length}
          </span>
        </div>
      )}

      {/* Issues list */}
      {result?.issues.length > 0 && (
        <div className="space-y-1">
          {result.issues.map((issue, i) => (
            <div key={i} className={`flex items-start gap-1.5 px-2 py-1.5 rounded text-[9px] border ${
              issue.type === 'error' ? 'bg-red-900/20 border-red-700/40 text-red-300' :
              issue.type === 'warn'  ? 'bg-yellow-900/20 border-yellow-700/40 text-yellow-300' :
                                       'bg-slate-800 border-slate-700 text-slate-400'
            }`}>
              {issue.type === 'error' ? <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> :
               issue.type === 'warn'  ? <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> :
                                        <Info className="w-3 h-3 shrink-0 mt-0.5" />}
              <span>{issue.msg}</span>
            </div>
          ))}
        </div>
      )}

      {/* All good */}
      {result?.ok && result.blueCount > 0 && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px] bg-green-900/20 border border-green-700/40 text-green-300">
          <CheckCircle className="w-3.5 h-3.5 shrink-0" />
          Rivers look valid!
        </div>
      )}

      {/* Preview with highlights */}
      {result && (result.overNeighborPixels.length > 0 || result.isolatedPixels.length > 0 || result.wrongColorPixels.length > 0) && (
        <div>
          <p className="text-[9px] text-slate-500 mb-1">
            Preview — <span className="text-red-400">red</span> = over-neighbor, <span className="text-yellow-400">yellow</span> = isolated, <span className="text-fuchsia-400">purple</span> = wrong color
          </p>
          <ValidationPreview
            imageData={featureLayer.imageData}
            overNeighborPixels={result.overNeighborPixels}
            isolatedPixels={result.isolatedPixels}
            wrongColorPixels={result.wrongColorPixels}
          />
        </div>
      )}

      {/* Auto-fix */}
      {result && (hasErrors || hasWarns) && (
        <button onClick={handleAutoFix} disabled={fixing}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded text-[11px] bg-amber-600 border border-amber-500 text-white hover:bg-amber-500 disabled:opacity-50 transition-colors font-semibold">
          <Wrench className={`w-3.5 h-3.5 ${fixing ? 'animate-spin' : ''}`} />
          {fixing ? 'Fixing…' : 'Auto-fix Rivers'}
        </button>
      )}

      <div className="text-[9px] text-slate-600 space-y-0.5">
        <p>Switch to the <strong className="text-slate-400">Paint</strong> tab to edit rivers by hand (brush = blue, eraser = remove).</p>
        <p>Use a 1px brush for precise river editing.</p>
      </div>
    </div>
  );
}