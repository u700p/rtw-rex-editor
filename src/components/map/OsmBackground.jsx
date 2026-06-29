import { useEffect, useRef, useState } from 'react';

/**
 * OsmBackground — renders OSM Humanitarian tiles behind TGA layers.
 *
 * Key design decisions:
 *  - CSS `opacity` on the container div drives the opacity slider (instant, no redraw).
 *  - Tiles loaded via HTMLImageElement with crossOrigin="anonymous" (works for OSM/HOT servers).
 *  - Zoom is picked dynamically from transform.scale so tiles sharpen on zoom-in.
 *  - Rendered inside MapCanvas container, below the TGA <canvas> in DOM order.
 */

// OSM Humanitarian (HOT) — great river/coastline visibility
// Falls back to standard OSM if HOT has CORS issues
const TILE_SOURCES = [
  'https://tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
];

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

function chooseBestZoom(bbox, mapW, scale) {
  const screenW = mapW * Math.max(scale, 0.05);
  // Pick the highest zoom where tiles aren't absurdly tiny (>=64px wide).
  // No upper bound — at deep zoom we just use more/larger tiles so OSM stays visible.
  for (let z = 13; z >= 1; z--) {
    const tileCount = lonToTileX(bbox.east, z) - lonToTileX(bbox.west, z);
    const pxPerTile = screenW / tileCount;
    if (pxPerTile >= 64) return z;
  }
  return 1;
}

// Global tile image cache: url → HTMLImageElement | Promise<HTMLImageElement|null>
const tileCache = new Map();

function loadTileImage(url) {
  const cached = tileCache.get(url);
  if (cached instanceof HTMLImageElement) return Promise.resolve(cached);
  if (cached instanceof Promise)          return cached;

  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => { tileCache.set(url, img); resolve(img); };
    img.onerror = () => {
      // Try fallback source if first fails
      if (url.includes('hot')) {
        const fallback = url.replace('tile.openstreetmap.fr/hot', 'tile.openstreetmap.org');
        const img2 = new Image();
        img2.crossOrigin = 'anonymous';
        img2.onload  = () => { tileCache.set(url, img2); resolve(img2); };
        img2.onerror = () => { tileCache.set(url, null); resolve(null); };
        img2.src = fallback;
      } else {
        tileCache.set(url, null);
        resolve(null);
      }
    };
    img.src = url;
  });
  tileCache.set(url, p);
  return p;
}

export default function OsmBackground({ bbox, mapW, mapH, transform, opacity = 0.6 }) {
  const containerRef = useRef(null);
  const canvasRef    = useRef(null);
  const renderIdRef  = useRef(0);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Track container dimensions
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

  // Redraw whenever transform/bbox/size change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bbox || size.w <= 0) return;

    const W = size.w;
    const H = size.h;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const effectiveMapW = mapW > 0 ? mapW : W;
    const effectiveMapH = mapH > 0 ? mapH : H;

    const zoom = chooseBestZoom(bbox, effectiveMapW, transform.scale);
    const n    = Math.pow(2, zoom);

    const txMin = Math.floor(lonToTileX(bbox.west,  zoom));
    const txMax = Math.ceil( lonToTileX(bbox.east,  zoom));
    const tyMin = Math.floor(latToTileY(bbox.north, zoom));
    const tyMax = Math.ceil( latToTileY(bbox.south, zoom));

    const mercNorth = latToMercY(bbox.north);
    const mercSouth = latToMercY(bbox.south);
    const mercRange = mercNorth - mercSouth;
    const lonWest   = bbox.west * Math.PI / 180;
    const lonRange  = (bbox.east - bbox.west) * Math.PI / 180;

    const tileToMercN  = ty => Math.PI * (1 - 2 * ty / n);
    const tileToLonRad = tx => (tx / n) * 2 * Math.PI - Math.PI;

    const geoToScreen = (mercN, lonRad) => ({
      x: ((lonRad - lonWest) / lonRange) * effectiveMapW * transform.scale + transform.x,
      y: ((mercNorth - mercN) / mercRange) * effectiveMapH * transform.scale + transform.y,
    });

    const renderId = ++renderIdRef.current;

    const jobs = [];
    for (let tx = txMin; tx < txMax; tx++) {
      for (let ty = tyMin; ty < tyMax; ty++) {
        const url = TILE_SOURCES[0].replace('{z}', zoom).replace('{x}', tx).replace('{y}', ty);
        jobs.push(loadTileImage(url).then(img => ({ img, tx, ty })));
      }
    }

    // Draw immediately with whatever is already cached
    const drawAll = (tiles) => {
      if (renderIdRef.current !== renderId) return;
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      for (const { img, tx, ty } of tiles) {
        if (!img) continue;
        const tl = geoToScreen(tileToMercN(ty),     tileToLonRad(tx));
        const br = geoToScreen(tileToMercN(ty + 1), tileToLonRad(tx + 1));
        const dw = br.x - tl.x;
        const dh = br.y - tl.y;
        if (dw <= 0 || dh <= 0) continue;
        try { ctx.drawImage(img, tl.x, tl.y, dw, dh); } catch {}
      }
    };

    // Do an optimistic draw with already-cached tiles, then again when all load
    const cachedTiles = [];
    const pendingJobs = [];
    for (let tx = txMin; tx < txMax; tx++) {
      for (let ty = tyMin; ty < tyMax; ty++) {
        const url = TILE_SOURCES[0].replace('{z}', zoom).replace('{x}', tx).replace('{y}', ty);
        const cached = tileCache.get(url);
        if (cached instanceof HTMLImageElement) {
          cachedTiles.push({ img: cached, tx, ty });
        }
        pendingJobs.push(loadTileImage(url).then(img => ({ img, tx, ty })));
      }
    }

    if (cachedTiles.length > 0) drawAll(cachedTiles);

    Promise.all(pendingJobs).then(tiles => drawAll(tiles));

    return () => { renderIdRef.current++; };
  }, [bbox, mapW, mapH, transform, size]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        opacity,
        transition: 'opacity 0.15s',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </div>
  );
}