/**
 * Auto-generate map_ground_types from:
 *   - heightmap (map_heights.tga) — determines sea vs land and elevation
 *   - optionally a topo reference ImageData (greyscale brightness)
 *
 * M2TW ground type RGB values (canonical):
 *   Sea pixels from heightmap = (0,0,255) → map to sea types by depth bucket
 *   Land pixels = elevation 1-255 → map to ground types by elevation + slope hint
 */

// M2TW canonical ground type colors (RGB)
const GT = {
  fertile_low:      [0,   128, 128],
  fertile_medium:   [96,  160, 64 ],
  fertile_high:     [101, 124, 0  ],
  wilderness:       [0,   0,   0  ],
  mountains_high:   [196, 128, 128],
  mountains_low:    [98,  65,  65 ],
  hills:            [128, 128, 64 ],
  forest_dense:     [0,   64,  0  ],
  forest_sparse:    [0,   128, 0  ],
  swamp:            [0,   255, 128],
  beach:            [255, 255, 255],
  impassable_land:  [64,  64,  64 ],
  impassable_sea:   [0,   0,   64 ],
  ocean:            [64,  0,   0  ],
  sea_deep:         [128, 0,   0  ],
  sea_shallow:      [196, 0,   0  ],
};

/**
 * Generates ground types ImageData from the heightmap.
 * @param {ImageData} heightData - the heights layer (2W+1 × 2H+1)
 * @param {ImageData|null} topoData - optional topo reference (same or different resolution, will be sampled)
 * @returns {ImageData} - ground types image at same size as heightData
 */
export function autoGenerateGroundTypes(heightData, topoData) {
  const { width, height, data: hd } = heightData;
  const out = new ImageData(width, height);
  const od = out.data;

  // Pre-compute average elevation to calibrate thresholds
  let totalLand = 0, countLand = 0;
  for (let i = 0; i < hd.length; i += 4) {
    const isSea = hd[i] === 0 && hd[i+1] === 0 && hd[i+2] === 255;
    if (!isSea) {
      const elev = (hd[i] + hd[i+1] + hd[i+2]) / 3;
      totalLand += elev;
      countLand++;
    }
  }
  const avgElev = countLand > 0 ? totalLand / countLand : 100;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = hd[i], g = hd[i+1], b = hd[i+2];

      let gt;

      // Sea pixel
      if (r === 0 && g === 0 && b === 255) {
        // sample the topo for depth hint (darker = deeper)
        const topoV = topoData ? sampleTopo(topoData, x, y, width, height) : 128;
        if (topoV < 40) gt = GT.ocean;
        else if (topoV < 90) gt = GT.sea_deep;
        else gt = GT.sea_shallow;
      } else {
        // Land pixel — elevation = grayscale brightness
        const elev = (r + g + b) / 3;

        // Compute local slope by sampling neighbours
        const slope = getSlope(hd, x, y, width, height);

        // Also use topo reference for additional hints
        const topoV = topoData ? sampleTopo(topoData, x, y, width, height) : 128;

        if (elev > 220 || slope > 180) {
          gt = GT.mountains_high;
        } else if (elev > 180 || slope > 130) {
          gt = GT.mountains_low;
        } else if (elev > 140 || slope > 80) {
          gt = GT.hills;
        } else if (elev < 5) {
          // Just above sea level — beach
          gt = GT.beach;
        } else if (elev < avgElev * 0.3 && slope < 20) {
          // Low flat land — look at topo for vegetation hints
          if (topoV > 160) gt = GT.fertile_low;
          else if (topoV > 100) gt = GT.forest_sparse;
          else gt = GT.fertile_low;
        } else if (elev < avgElev * 0.6) {
          if (slope > 40) gt = GT.hills;
          else if (topoV > 180) gt = GT.fertile_medium;
          else if (topoV > 120) gt = GT.forest_sparse;
          else gt = GT.fertile_medium;
        } else {
          // Mid elevation
          if (slope > 60) gt = GT.mountains_low;
          else if (topoV < 80) gt = GT.wilderness;
          else gt = GT.fertile_high;
        }
      }

      od[i]   = gt[0];
      od[i+1] = gt[1];
      od[i+2] = gt[2];
      od[i+3] = 255;
    }
  }

  return out;
}

function getSlope(data, x, y, width, height) {
  const neighbours = [
    [x-1, y], [x+1, y], [x, y-1], [x, y+1]
  ];
  const ci = (y * width + x) * 4;
  const ce = (data[ci] + data[ci+1] + data[ci+2]) / 3;
  let maxDiff = 0;
  for (const [nx, ny] of neighbours) {
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
    const ni = (ny * width + nx) * 4;
    const ne = (data[ni] + data[ni+1] + data[ni+2]) / 3;
    const isSea = data[ni] === 0 && data[ni+1] === 0 && data[ni+2] === 255;
    if (isSea) continue;
    maxDiff = Math.max(maxDiff, Math.abs(ce - ne));
  }
  return maxDiff;
}

function sampleTopo(topoData, x, y, targetW, targetH) {
  const sx = Math.round((x / targetW) * topoData.width);
  const sy = Math.round((y / targetH) * topoData.height);
  const cx = Math.min(sx, topoData.width - 1);
  const cy = Math.min(sy, topoData.height - 1);
  const i = (cy * topoData.width + cx) * 4;
  return (topoData.data[i] + topoData.data[i+1] + topoData.data[i+2]) / 3;
}

// M2TW canonical climate colors (RGB) keyed by ground type
const CLIMATE_FROM_GT = {
  // Sea types → semi_arid (blue-ish, unused on land)
  ocean:          [0,   114, 188],
  sea_deep:       [0,   114, 188],
  sea_shallow:    [0,   114, 188],
  impassable_sea: [0,   114, 188],
  // Beach/low fertile → mediterranean
  beach:          [236, 0,   140],
  fertile_low:    [236, 0,   140],
  // Medium fertile → temperate grassland
  fertile_medium: [237, 20,  91 ],
  fertile_high:   [242, 101, 34 ],
  // Wilderness → steppe
  wilderness:     [237, 28,  36 ],
  // Forest → temperate deciduous
  forest_sparse:  [242, 101, 34 ],
  forest_dense:   [247, 148, 29 ],
  // Swamp
  swamp:          [255, 242, 0  ],
  // Hills → highland
  hills:          [141, 198, 63 ],
  // Mountains → alpine
  mountains_low:  [57,  181, 74 ],
  mountains_high: [0,   166, 81 ],
  impassable_land:[57,  181, 74 ],
};

/**
 * Auto-generate climates ImageData from a ground types ImageData.
 * Maps each ground type pixel to a climate color.
 * @param {ImageData} groundData
 * @returns {ImageData}
 */
export function autoGenerateClimates(groundData) {
  const { width, height, data: gd } = groundData;
  const out = new ImageData(width, height);
  const od = out.data;

  // Build a reverse lookup: [r,g,b] string → climate [r,g,b]
  const lookup = new Map();
  for (const [gtId, rgb] of Object.entries(GT)) {
    const key = `${rgb[0]},${rgb[1]},${rgb[2]}`;
    const climate = CLIMATE_FROM_GT[gtId] ?? [236, 0, 140]; // default mediterranean
    lookup.set(key, climate);
  }

  for (let i = 0; i < gd.length; i += 4) {
    const key = `${gd[i]},${gd[i+1]},${gd[i+2]}`;
    const c = lookup.get(key) ?? [236, 0, 140];
    od[i]   = c[0];
    od[i+1] = c[1];
    od[i+2] = c[2];
    od[i+3] = 255;
  }

  return out;
}

/**
 * Fill an entire layer with a solid color.
 * @param {number} width
 * @param {number} height
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {ImageData}
 */
export function fillSolidColor(width, height, r, g, b) {
  const out = new ImageData(width, height);
  const od = out.data;
  for (let i = 0; i < od.length; i += 4) {
    od[i]   = r;
    od[i+1] = g;
    od[i+2] = b;
    od[i+3] = 255;
  }
  return out;
}