import React, { useState, useCallback } from 'react';
import { AlertTriangle, CheckCircle, Wand2, RefreshCw } from 'lucide-react';

/**
 * RiverChecker — validates the features (rivers) layer against M2TW rules:
 *   1. All river pixels must be pure blue (0,0,255)
 *   2. Exactly one white origin pixel (255,255,255) must exist
 *   3. No river pixel may have more than 2 river neighbors (8-directional)
 *
 * Also provides a "Fix All" button that re-runs the post-process algorithm.
 */

function isRiverPx(data, i) {
  return data[i] === 0 && data[i+1] === 0 && data[i+2] === 255 && data[i+3] > 0;
}
function isWhitePx(data, i) {
  return data[i] === 255 && data[i+1] === 255 && data[i+2] === 255 && data[i+3] > 0;
}

function checkRivers(imageData) {
  const { data, width, height } = imageData;
  const issues = [];
  let whiteCount = 0;
  let whitePx = null;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
      if (a === 0) continue;

      const isWhite = isWhitePx(data, i);
      const isRiver = isRiverPx(data, i);

      // Count white origin pixels
      if (isWhite) {
        whiteCount++;
        whitePx = { x, y };
      }

      // Blue-ish but not pure blue — impure river pixel
      if (!isWhite && a > 0 && b > 100 && b > r + 20 && b > g + 20 && !(r === 0 && g === 0 && b === 255)) {
        issues.push({ type: 'impure', x, y, desc: `Impure river pixel at (${x},${y}): rgb(${r},${g},${b})` });
      }

      // River pixel with >2 neighbors
      if (isRiver) {
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ni = (ny * width + nx) * 4;
            if (isRiverPx(data, ni) || isWhitePx(data, ni)) count++;
          }
        }
        if (count > 2) {
          issues.push({ type: 'branching', x, y, desc: `Branching pixel at (${x},${y}) has ${count} neighbors` });
        }
      }
    }
  }

  if (whiteCount === 0) {
    issues.push({ type: 'no_origin', desc: 'No white origin pixel found' });
  } else if (whiteCount > 1) {
    issues.push({ type: 'multi_origin', desc: `${whiteCount} white origin pixels found (expected 1)` });
  }

  return { issues, stats: { whiteCount, whitePx } };
}

function fixRivers(imageData) {
  const { data, width, height } = imageData;

  // 1. Normalize: blue-ish → pure blue
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
    if (a > 0 && b > 100 && b > r + 20 && b > g + 20 && !(r === 0 && g === 0 && b === 255)) {
      data[i] = 0; data[i+1] = 0; data[i+2] = 255; data[i+3] = 255;
    }
  }

  // 2. Remove white origin pixels (will re-set below)
  for (let i = 0; i < data.length; i += 4) {
    if (isWhitePx(data, i)) {
      // Check if adjacent to a river pixel
      const x = (i / 4) % width, y = Math.floor((i / 4) / width);
      let hasRiverNeighbor = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = (ny * width + nx) * 4;
          if (isRiverPx(data, ni)) { hasRiverNeighbor = true; break; }
        }
        if (hasRiverNeighbor) break;
      }
      // Convert origin-adjacent white back to blue so it can be thinned properly
      if (hasRiverNeighbor) {
        data[i] = 0; data[i+1] = 0; data[i+2] = 255; data[i+3] = 255;
      }
    }
  }

  // 3. Thin: remove pixels with >2 river neighbors, up to 8 passes
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (!isRiverPx(data, i)) continue;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ni = (ny * width + nx) * 4;
            if (isRiverPx(data, ni)) count++;
          }
        }
        if (count > 2) {
          data[i] = 0; data[i+1] = 0; data[i+2] = 0; data[i+3] = 0;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // 4. Set first river pixel (top-left-most) to white
  let originSet = false;
  for (let y = 0; y < height && !originSet; y++) {
    for (let x = 0; x < width && !originSet; x++) {
      const i = (y * width + x) * 4;
      if (isRiverPx(data, i)) {
        data[i] = 255; data[i+1] = 255; data[i+2] = 255; data[i+3] = 255;
        originSet = true;
      }
    }
  }

  return imageData;
}

const ISSUE_COLORS = {
  impure:       'text-yellow-400',
  branching:    'text-red-400',
  no_origin:    'text-orange-400',
  multi_origin: 'text-orange-400',
};
const ISSUE_ICONS = {
  impure:       '⚠',
  branching:    '✕',
  no_origin:    '○',
  multi_origin: '○',
};

export default function RiverChecker({ featuresLayer, onLayerUpdate }) {
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  const runCheck = useCallback(() => {
    if (!featuresLayer?.imageData) return;
    setRunning(true);
    // Yield to let UI update
    setTimeout(() => {
      const copy = new ImageData(
        new Uint8ClampedArray(featuresLayer.imageData.data),
        featuresLayer.imageData.width,
        featuresLayer.imageData.height
      );
      const res = checkRivers(copy);
      setResult(res);
      setRunning(false);
    }, 30);
  }, [featuresLayer]);

  const runFix = useCallback(() => {
    if (!featuresLayer?.imageData) return;
    setRunning(true);
    setTimeout(() => {
      const copy = new ImageData(
        new Uint8ClampedArray(featuresLayer.imageData.data),
        featuresLayer.imageData.width,
        featuresLayer.imageData.height
      );
      fixRivers(copy);
      onLayerUpdate('features', { imageData: copy, visible: true, opacity: 0.9, dirty: true });
      // Re-check
      const res = checkRivers(copy);
      setResult(res);
      setRunning(false);
    }, 30);
  }, [featuresLayer, onLayerUpdate]);

  const hasLayer = !!featuresLayer?.imageData;
  const ok = result && result.issues.length === 0;

  // Group issues by type for display
  const branchingCount  = result?.issues.filter(i => i.type === 'branching').length ?? 0;
  const impureCount     = result?.issues.filter(i => i.type === 'impure').length ?? 0;
  const otherIssues     = result?.issues.filter(i => i.type !== 'branching' && i.type !== 'impure') ?? [];

  return (
    <div className="space-y-2 rounded border border-slate-700 bg-slate-900/60 p-2">
      <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">River Validator</p>

      {!hasLayer && (
        <p className="text-[9px] text-slate-600 italic">No features layer loaded yet.</p>
      )}

      {hasLayer && (
        <>
          <div className="flex gap-1">
            <button onClick={runCheck} disabled={running}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[10px] bg-slate-700 border border-slate-600 text-slate-200 hover:bg-slate-600 disabled:opacity-50 transition-colors font-semibold">
              <RefreshCw className={`w-3 h-3 ${running ? 'animate-spin' : ''}`} />
              Check Rivers
            </button>
            <button onClick={runFix} disabled={running || !result}
              title="Fix all issues automatically"
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[10px] bg-blue-700 border border-blue-600 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors font-semibold">
              <Wand2 className={`w-3 h-3 ${running ? 'animate-spin' : ''}`} />
              Auto-Fix
            </button>
          </div>

          {result && (
            <div className="space-y-1.5">
              {ok ? (
                <div className="flex items-center gap-1.5 text-green-400 text-[10px] font-semibold">
                  <CheckCircle className="w-3.5 h-3.5" /> All river rules pass ✓
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 text-red-400 text-[10px] font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {result.issues.length} issue{result.issues.length !== 1 ? 's' : ''} found
                  </div>

                  <div className="text-[9px] space-y-0.5">
                    {branchingCount > 0 && (
                      <p className="text-red-400">✕ {branchingCount} branching pixel{branchingCount !== 1 ? 's' : ''} (&gt;2 neighbors)</p>
                    )}
                    {impureCount > 0 && (
                      <p className="text-yellow-400">⚠ {impureCount} impure river pixel{impureCount !== 1 ? 's' : ''} (not pure blue)</p>
                    )}
                    {otherIssues.map((iss, i) => (
                      <p key={i} className={ISSUE_COLORS[iss.type] ?? 'text-slate-400'}>
                        {ISSUE_ICONS[iss.type] ?? '!'} {iss.desc}
                      </p>
                    ))}
                  </div>

                  <p className="text-[9px] text-slate-500">
                    Click <strong className="text-slate-300">Auto-Fix</strong> to apply the thinning + origin algorithm automatically, then paint by hand for any remaining touch-ups.
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}