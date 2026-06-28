import { useEffect, useRef, useState } from 'react';

/**
 * OsmBackground — renders OpenStreetMap tiles behind the TGA layers in CampaignMap.
 *
 * The TGA map uses a simple pixel coordinate system where (0,0) = top-left,
 * matching Web Mercator tile rendering. We compute which tiles cover the bbox,
 * fetch them, and draw them clipped to the exact bbox at the correct sub-pixel
 * offset driven by the current pan/zoom transform.
 */

const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_SIZE = 256;

function latToMercY(lat) {
  const r = lat * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + r / 2));
}

function latToTileY(lat, zoom) {
  const n = Math.pow(2, zoom);
  const r = lat * Math.PI / 180;
  return (n * (1 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / Math.PI)) / 2;
}

function lonToTileX(lon, zoom) {
  return ((lon + 180) / 360) * Math.pow(2, zoom);
}

function chooseBestZoom(bbox, mapW, mapH) {
  // Pick zoom so ~2–6 tiles cover the map dimension
  for (let z = 10; z >= 0; z--) {
    const x0 = lonToTileX(bbox.west, z);
    const x1 = lonToTileX(bbox.east, z);
    if (Math.ceil(x1) - Math.floor(x0) <= 8) return z;
  }
  return 3;
}

const tileCache = new Map(); // url → ImageBitmap | 'loading' | 'error'

function fetchTile(url) {
  if (tileCache.has(url)) return tileCache.get(url);
  const p = fetch(url)
    .then(r => r.blob())
    .then(b => createImageBitmap(b))
    .then(bmp => { tileCache.set(url, bmp); return bmp; })
    .catch(() => { tileCache.set(url, 'error'); return null; });
  tileCache.set(url, p);
  return p;
}

export default function OsmBackground({ bbox, mapW, mapH, transform, opacity = 0.6 }) {
  const canvasRef    = useRef(null);
  const containerRef = useRef(null);
  const abortRef     = useRef(false);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) });
      }
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const canvasW = size.w || 1;
  const canvasH = size.h || 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bbox || mapW === 0) return;
    canvas.width  = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvasW, canvasH);
    if (opacity <= 0) return;

    const zoom = chooseBestZoom(bbox, mapW, mapH);

    // Tile indices covering the bbox
    const txMin = Math.floor(lonToTileX(bbox.west, zoom));
    const txMax = Math.ceil(lonToTileX(bbox.east, zoom));
    const tyMin = Math.floor(latToTileY(bbox.north, zoom));
    const tyMax = Math.ceil(latToTileY(bbox.south, zoom));

    // Mercator extents for the entire tile grid covering our bbox
    const totalTilesX = Math.pow(2, zoom);
    const totalTilesY = Math.pow(2, zoom);

    // Convert a tile pixel position to map pixel position
    // Map pixel (0,0) = bbox top-left in Mercator space
    const mercNorth = latToMercY(bbox.north);
    const mercSouth = latToMercY(bbox.south);
    const mercWest  = bbox.west  * Math.PI / 180; // lon in radians (linear)
    const mercEast  = bbox.east  * Math.PI / 180;

    // Full Mercator range at this zoom (tile 0 = merN=PI, tile 2^z = merN=-PI)
    const mercRange = Math.PI; // log(tan(pi/2)) = log(inf) capped; use standard -π to π
    // Standard Web Mercator: y tile = (1 - mercN/π) / 2 * 2^z
    // So mercN from tile y: mercN = π * (1 - 2*ty/2^z)
    const tileToMercN = (ty) => Math.PI * (1 - 2 * ty / totalTilesY);
    const tileToLonRad = (tx) => (tx / totalTilesX) * 2 * Math.PI - Math.PI;

    // Map pixel coordinate from geographic point (Mercator Y, lon in radians)
    const mercRangeMap = mercNorth - mercSouth;
    const lonRangeMap  = mercEast  - mercWest;

    const geoToMapPx = (mercN, lonRad) => ({
      x: ((lonRad - mercWest) / lonRangeMap) * mapW,
      y: ((mercNorth - mercN) / mercRangeMap) * mapH,
    });

    // Map px → screen px
    const mapToScreen = (mx, my) => ({
      sx: mx * transform.scale + transform.x,
      sy: my * transform.scale + transform.y,
    });

    abortRef.current = false;

    const draw = async () => {
      ctx.clearRect(0, 0, canvasW, canvasH);
      ctx.globalAlpha = opacity;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const promises = [];
      for (let tx = txMin; tx < txMax; tx++) {
        for (let ty = tyMin; ty < tyMax; ty++) {
          const url = OSM_URL
            .replace('{z}', zoom)
            .replace('{x}', tx)
            .replace('{y}', ty);
          const p = fetchTile(url);
          const result = p instanceof Promise ? p : Promise.resolve(p instanceof ImageBitmap ? p : null);
          promises.push(result.then(bmp => ({ bmp, tx, ty })));
        }
      }

      const tiles = await Promise.all(promises);
      if (abortRef.current) return;

      ctx.clearRect(0, 0, canvasW, canvasH);
      ctx.globalAlpha = opacity;
      ctx.imageSmoothingEnabled = true;

      for (const { bmp, tx, ty } of tiles) {
        if (!bmp) continue;

        // Geographic corners of this tile
        const mercTop    = tileToMercN(ty);
        const mercBottom = tileToMercN(ty + 1);
        const lonLeft    = tileToLonRad(tx);
        const lonRight   = tileToLonRad(tx + 1);

        // Map pixel corners
        const topLeft     = geoToMapPx(mercTop, lonLeft);
        const bottomRight = geoToMapPx(mercBottom, lonRight);

        const screenTL = mapToScreen(topLeft.x, topLeft.y);
        const screenBR = mapToScreen(bottomRight.x, bottomRight.y);

        const drawW = screenBR.sx - screenTL.sx;
        const drawH = screenBR.sy - screenTL.sy;
        if (drawW <= 0 || drawH <= 0) continue;

        ctx.drawImage(bmp, screenTL.sx, screenTL.sy, drawW, drawH);
      }
    };

    draw();

    return () => { abortRef.current = true; };
  }, [bbox, mapW, mapH, transform, canvasW, canvasH, opacity]);

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'auto' }}
      />
    </div>
  );
}