/**
 * Auto-generate map_ground_types from:
 *   - heightmap (map_heights.tga) — determines sea vs land and elevation
 *   - groundRanges: ordered array of { gtId, max } bands
 *
 * M2TW ground type RGB values (canonical):
 *   Sea pixels from heightmap = (0,0,255) → sea_shallow (default)
 *   Land pixels = elevation 1-255 → mapped via groundRanges
 */

// M2TW canonical ground type colors (RGB)
export const GT = {
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
 * Build a lookup function from groundRanges (ordered array of { gtId, max }).
 * Returns the ground type color [r,g,b] for a given grayscale brightness (0–255).
 */
function buildRangeLookup(groundRanges) {
  // Pre-build a 256-entry table for O(1) lookup
  const table = new Array(256);
  for (let v = 0; v < 256; v++) {
    let color = GT.fertile_medium; // fallback
    for (const band of groundRanges) {
      if (v <= band.max) {
        color = GT[band.gtId] ?? GT.fertile_medium;
        break;
      }
    }
    table[v] = color;
  }
  return table;
}

/**
 * Generates ground types ImageData from the heightmap using groundRanges config.
 * Runs synchronously — caller should offload to a worker or chunk if needed.
 * @param {ImageData} heightData - the heights layer
 * @param {Array} groundRanges - ordered band config [{gtId, max}, ...]
 * @returns {ImageData}
 */
export function autoGenerateGroundTypes(heightData, groundRanges) {
  const { width, height, data: hd } = heightData;
  const out = new ImageData(width, height);
  const od = out.data;

  const table = buildRangeLookup(groundRanges);

  for (let i = 0; i < hd.length; i += 4) {
    const r = hd[i], g = hd[i + 1], b = hd[i + 2];

    let gt;
    if (r === 0 && g === 0 && b === 255) {
      // Sea pixel
      gt = GT.sea_shallow;
    } else {
      // Land pixel — elevation = average brightness
      const elev = Math.round((r + g + b) / 3);
      gt = table[Math.min(255, Math.max(0, elev))];
    }

    od[i]     = gt[0];
    od[i + 1] = gt[1];
    od[i + 2] = gt[2];
    od[i + 3] = 255;
  }

  return out;
}

/**
 * Chunked async version — yields control every CHUNK_SIZE rows to keep UI responsive.
 * @param {ImageData} heightData
 * @param {Array} groundRanges
 * @param {function} onProgress (pct: 0–100) optional
 * @returns {Promise<ImageData>}
 */
export async function autoGenerateGroundTypesAsync(heightData, groundRanges, onProgress) {
  const { width, height, data: hd } = heightData;
  const out = new ImageData(width, height);
  const od = out.data;
  const table = buildRangeLookup(groundRanges);

  const CHUNK_ROWS = 64; // process 64 rows per tick
  for (let startY = 0; startY < height; startY += CHUNK_ROWS) {
    const endY = Math.min(startY + CHUNK_ROWS, height);
    for (let y = startY; y < endY; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = hd[i], g = hd[i + 1], b = hd[i + 2];
        let gt;
        if (r === 0 && g === 0 && b === 255) {
          gt = GT.sea_shallow;
        } else {
          const elev = Math.round((r + g + b) / 3);
          gt = table[Math.min(255, Math.max(0, elev))];
        }
        od[i]     = gt[0];
        od[i + 1] = gt[1];
        od[i + 2] = gt[2];
        od[i + 3] = 255;
      }
    }
    if (onProgress) onProgress(Math.round((endY / height) * 100));
    // Yield to the event loop
    await new Promise(r => setTimeout(r, 0));
  }

  return out;
}

// M2TW canonical climate colors (RGB) keyed by ground type id
const CLIMATE_FROM_GT = {
  ocean:          [0,   114, 188],
  sea_deep:       [0,   114, 188],
  sea_shallow:    [0,   114, 188],
  impassable_sea: [0,   114, 188],
  beach:          [236, 0,   140],
  fertile_low:    [236, 0,   140],
  fertile_medium: [237, 20,  91 ],
  fertile_high:   [242, 101, 34 ],
  wilderness:     [237, 28,  36 ],
  forest_sparse:  [242, 101, 34 ],
  forest_dense:   [247, 148, 29 ],
  swamp:          [255, 242, 0  ],
  hills:          [141, 198, 63 ],
  mountains_low:  [57,  181, 74 ],
  mountains_high: [0,   166, 81 ],
  impassable_land:[57,  181, 74 ],
};

/**
 * Auto-generate climates ImageData from a ground types ImageData.
 */
export function autoGenerateClimates(groundData) {
  const { width, height, data: gd } = groundData;
  const out = new ImageData(width, height);
  const od = out.data;

  // Build reverse lookup: "r,g,b" → climate [r,g,b]
  const lookup = new Map();
  for (const [gtId, rgb] of Object.entries(GT)) {
    const key = `${rgb[0]},${rgb[1]},${rgb[2]}`;
    const climate = CLIMATE_FROM_GT[gtId] ?? [236, 0, 140];
    lookup.set(key, climate);
  }

  for (let i = 0; i < gd.length; i += 4) {
    const key = `${gd[i]},${gd[i + 1]},${gd[i + 2]}`;
    const c = lookup.get(key) ?? [236, 0, 140];
    od[i]     = c[0];
    od[i + 1] = c[1];
    od[i + 2] = c[2];
    od[i + 3] = 255;
  }

  return out;
}

/**
 * Fill an entire layer with a solid color.
 */
export function fillSolidColor(width, height, r, g, b) {
  const out = new ImageData(width, height);
  const od = out.data;
  for (let i = 0; i < od.length; i += 4) {
    od[i]     = r;
    od[i + 1] = g;
    od[i + 2] = b;
    od[i + 3] = 255;
  }
  return out;
}