/**
 * TileRasterizer — rasterizes web map tile layers into an ImageData at a target resolution.
 *
 * Strategy:
 *  - Compute which tiles cover the bbox at a chosen zoom level
 *  - Fetch each tile as an <img> (CORS: anonymous)
 *  - Draw them onto an intermediate canvas (true tile coordinates)
 *  - Clip and scale to target width×height using nearest-neighbor (imageSmoothingEnabled=false)
 *  - Return an ImageData object
 *
 * All standard slippy-map tile sources (OSM, OpenTopoMap, Terrarium, OHM) use
 * EPSG:3857 Web Mercator, so bboxes in WGS84 lat/lon map correctly.
 */

// Web Mercator helpers
function lon2tile(lon, zoom) {
  return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
}
function lat2tile(lat, zoom) {
  return Math.floor(
    (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI)
    / 2 * Math.pow(2, zoom)
  );
}
function tile2lon(x, zoom) {
  return x / Math.pow(2, zoom) * 360 - 180;
}
function tile2lat(y, zoom) {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, zoom);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

const TILE_SIZE = 256;

async function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load tile: ${url}`));
    img.src = url;
  });
}

function buildUrl(urlTemplate, x, y, z) {
  const subdomains = ['a', 'b', 'c'];
  const s = subdomains[(x + y) % 3];
  return urlTemplate
    .replace('{z}', z)
    .replace('{x}', x)
    .replace('{y}', y)
    .replace('{s}', s);
}

/**
 * Rasterize a tile URL template for the given bbox into an ImageData of width×height.
 * Uses nearest-neighbor scaling (no anti-aliasing).
 *
 * @param {string} urlTemplate  Leaflet-style URL with {z}/{x}/{y} and optional {s}
 * @param {{south,north,west,east}} bbox
 * @param {number} width        Target pixel width
 * @param {number} height       Target pixel height
 * @param {function} [onProgress]  Called with (fetched, total)
 * @returns {Promise<ImageData>}
 */
export async function rasterizeTiles(urlTemplate, bbox, width, height, onProgress, options) {
  // Pick zoom level: aim for ~2×the target resolution so we have plenty of detail
  let zoom = 5;
  for (let z = 3; z <= 12; z++) {
    const tileW = lon2tile(bbox.east, z) - lon2tile(bbox.west, z) + 1;
    const tileH = lat2tile(bbox.south, z) - lat2tile(bbox.north, z) + 1;
    const canvasW = tileW * TILE_SIZE;
    const canvasH = tileH * TILE_SIZE;
    zoom = z;
    if (canvasW >= width * 1.5 && canvasH >= height * 1.5) break;
  }

  const xMin = lon2tile(bbox.west, zoom);
  const xMax = lon2tile(bbox.east, zoom);
  const yMin = lat2tile(bbox.north, zoom); // note: y increases southward
  const yMax = lat2tile(bbox.south, zoom);

  const tilesX = xMax - xMin + 1;
  const tilesY = yMax - yMin + 1;
  const fullW = tilesX * TILE_SIZE;
  const fullH = tilesY * TILE_SIZE;

  // Intermediate canvas covering all tiles
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = fullW;
  tileCanvas.height = fullH;
  const tileCtx = tileCanvas.getContext('2d');
  tileCtx.imageSmoothingEnabled = false;

  const total = tilesX * tilesY;
  let fetched = 0;

  // Fetch tiles in parallel batches of 8
  const tasks = [];
  for (let tx = xMin; tx <= xMax; tx++) {
    for (let ty = yMin; ty <= yMax; ty++) {
      tasks.push({ tx, ty });
    }
  }

  const BATCH = 8;
  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(async ({ tx, ty }) => {
      const url = buildUrl(urlTemplate, tx, ty, zoom);
      try {
        const img = await loadImage(url);
        const dx = (tx - xMin) * TILE_SIZE;
        const dy = (ty - yMin) * TILE_SIZE;
        tileCtx.drawImage(img, dx, dy, TILE_SIZE, TILE_SIZE);
      } catch (e) {
        // tile load failed — leave blank
      }
      fetched++;
      onProgress?.(fetched, total);
    }));
  }

  // Now clip to exact bbox in tile space and scale to target resolution
  // Compute pixel coordinates within the tile canvas for the bbox edges
  const lonToTilePixel = (lon) => ((lon2tile(lon, zoom) - xMin) + (lon - tile2lon(Math.floor(lon2tile(lon, zoom)), zoom)) / (tile2lon(Math.floor(lon2tile(lon, zoom)) + 1, zoom) - tile2lon(Math.floor(lon2tile(lon, zoom)), zoom))) * TILE_SIZE;
  
  // Simpler pixel mapping using Mercator directly
  const mercX = (lon) => (lon - tile2lon(xMin, zoom)) / (tile2lon(xMax + 1, zoom) - tile2lon(xMin, zoom)) * fullW;
  const mercY = (lat) => {
    const latRad = lat * Math.PI / 180;
    const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    const northRad = tile2lat(yMin, zoom) * Math.PI / 180;
    const southRad = tile2lat(yMax + 1, zoom) * Math.PI / 180;
    const mercNorth = Math.log(Math.tan(Math.PI / 4 + northRad / 2));
    const mercSouth = Math.log(Math.tan(Math.PI / 4 + southRad / 2));
    return ((mercNorth - mercN) / (mercNorth - mercSouth)) * fullH;
  };

  const sx = mercX(bbox.west);
  const sy = mercY(bbox.north);
  const sw = mercX(bbox.east) - sx;
  const sh = mercY(bbox.south) - sy;

  // Output canvas at target resolution
  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d');
  outCtx.imageSmoothingEnabled = false; // nearest-neighbor
  outCtx.drawImage(tileCanvas, sx, sy, sw, sh, 0, 0, width, height);

  const imageData = outCtx.getImageData(0, 0, width, height);

  if (options?.grayscale) {
    // Terrarium tiles encode elevation as: elevation = (R*256 + G + B/256) - 32768
    // elevation <= 0  → sea  → (0, 0, 255)
    // elevation >  0  → land → grayscale 1–255 (normalised to max land elevation)
    const d = imageData.data;
    const len = d.length;

    // Decode all elevations first
    const elevs = new Float32Array(len / 4);
    for (let i = 0; i < len; i += 4) {
      elevs[i / 4] = d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
    }

    // Find max land elevation for normalisation
    let maxElev = 0;
    for (let j = 0; j < elevs.length; j++) {
      if (elevs[j] > maxElev) maxElev = elevs[j];
    }
    const range = maxElev || 1;

    // Write output: sea pixels → blue, land → grayscale 1–255
    for (let i = 0; i < len; i += 4) {
      const elev = elevs[i / 4];
      if (elev <= 0) {
        d[i] = 0; d[i + 1] = 0; d[i + 2] = 255; d[i + 3] = 255;
      } else {
        const v = Math.max(1, Math.round(elev / range * 255));
        d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
      }
    }
  }

  return imageData;
}