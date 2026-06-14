import React, { useRef, useState, useEffect, useCallback } from 'react';

/**
 * Interactive canvas that shows a TGA/image and:
 *  - Draws all existing sprite rectangles for the active page
 *  - Lets the user drag to define a new rectangle (selectionMode=true)
 *  - Calls onSelect({ left, top, right, bottom }) when drag ends
 *  - Highlights hoveredSprite (index)
 */
export default function SpriteCanvas({
  imageUrl,
  pageWidth,
  pageHeight,
  sprites,      // all sprites for this page
  hoveredIdx,
  onHover,
  selectionMode,
  onSelect,
}) {
  const canvasRef = useRef(null);
  const [img, setImg] = useState(null);
  const [scale, setScale] = useState(1);
  const [dragging, setDragging] = useState(null); // {startX,startY}
  const [dragRect, setDragRect] = useState(null);

  // Load image
  useEffect(() => {
    if (!imageUrl) { setImg(null); return; }
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = imageUrl;
  }, [imageUrl]);

  // Compute scale to fit canvas container
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const containerW = canvas.parentElement?.clientWidth ?? 600;
    const s = Math.min(containerW / pageWidth, 600 / pageHeight, 2);
    setScale(s);
    canvas.width = Math.round(pageWidth * s);
    canvas.height = Math.round(pageHeight * s);
  }, [pageWidth, pageHeight, imageUrl]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background checkerboard when no image
    if (!img) {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#2a2a3e';
      for (let y = 0; y < canvas.height; y += 16)
        for (let x = (y / 16 % 2) * 16; x < canvas.width; x += 32)
          ctx.fillRect(x, y, 16, 16);
    } else {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }

    // Draw sprites
    sprites.forEach((sp) => {
      const isHovered = sp.index === hoveredIdx;
      ctx.strokeStyle = isHovered ? '#facc15' : 'rgba(100,200,255,0.7)';
      ctx.lineWidth = isHovered ? 2 : 1;
      ctx.strokeRect(
        sp.left * scale, sp.top * scale,
        (sp.right - sp.left) * scale, (sp.bottom - sp.top) * scale
      );
      if (isHovered) {
        ctx.fillStyle = 'rgba(250,204,21,0.15)';
        ctx.fillRect(
          sp.left * scale, sp.top * scale,
          (sp.right - sp.left) * scale, (sp.bottom - sp.top) * scale
        );
        ctx.fillStyle = '#facc15';
        ctx.font = '10px monospace';
        ctx.fillText(sp.name, sp.left * scale + 2, sp.top * scale + 11);
      }
    });

    // Draw drag selection
    if (dragRect) {
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(dragRect.x * scale, dragRect.y * scale, dragRect.w * scale, dragRect.h * scale);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(249,115,22,0.15)';
      ctx.fillRect(dragRect.x * scale, dragRect.y * scale, dragRect.w * scale, dragRect.h * scale);
    }
  }, [img, sprites, hoveredIdx, dragRect, scale, pageWidth, pageHeight]);

  const getPosOnPage = useCallback((e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) / scale),
      y: Math.round((e.clientY - rect.top) / scale),
    };
  }, [scale]);

  const handleMouseMove = useCallback((e) => {
    const { x, y } = getPosOnPage(e);
    if (dragging) {
      const rx = Math.min(x, dragging.startX);
      const ry = Math.min(y, dragging.startY);
      const rw = Math.abs(x - dragging.startX);
      const rh = Math.abs(y - dragging.startY);
      setDragRect({ x: rx, y: ry, w: rw, h: rh });
      return;
    }
    // Hit-test for hover
    for (const sp of sprites) {
      if (x >= sp.left && x <= sp.right && y >= sp.top && y <= sp.bottom) {
        onHover?.(sp.index);
        return;
      }
    }
    onHover?.(null);
  }, [dragging, getPosOnPage, sprites, onHover]);

  const handleMouseDown = useCallback((e) => {
    if (!selectionMode) return;
    const { x, y } = getPosOnPage(e);
    setDragging({ startX: x, startY: y });
    setDragRect(null);
  }, [selectionMode, getPosOnPage]);

  const handleMouseUp = useCallback((e) => {
    if (!dragging) return;
    const { x, y } = getPosOnPage(e);
    const left = Math.min(x, dragging.startX);
    const top  = Math.min(y, dragging.startY);
    const right  = Math.max(x, dragging.startX);
    const bottom = Math.max(y, dragging.startY);
    setDragging(null);
    if (right - left > 2 && bottom - top > 2) {
      onSelect?.({ left, top, right, bottom });
    }
    setDragRect(null);
  }, [dragging, getPosOnPage, onSelect]);

  return (
    <canvas
      ref={canvasRef}
      className={`block border border-slate-700 rounded ${selectionMode ? 'cursor-crosshair' : 'cursor-default'}`}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { onHover?.(null); }}
    />
  );
}