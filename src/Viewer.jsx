import { useEffect, useRef } from 'react';

/** Axial slice viewer with an outline overlay. Wheel scrolls; pointer events drive the outline or brush tool. */
export default function Viewer({ vol, dims, spacing, gd, mask, version, slice, win, tool, onSlice, onOutline, onBrush }) {
  const base = useRef(null), over = useRef(null), wrap = useRef(null), drag = useRef(null);
  const [, H, W] = dims;

  useEffect(() => {
    const ctx = base.current.getContext('2d');
    const img = ctx.createImageData(W, H);
    const lo = win.level - win.width / 2, k = slice * H * W, sc = 255 / win.width;
    for (let i = 0; i < H * W; i++) {
      let v = (vol[k + i] - lo) * sc;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      const j = i * 4;
      img.data[j] = img.data[j + 1] = img.data[j + 2] = v; img.data[j + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [vol, slice, win, W, H]);

  useEffect(() => {
    const [, ny, nx] = gd, ctx = over.current.getContext('2d');
    const img = ctx.createImageData(nx, ny), k = slice * ny * nx;
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = k + y * nx + x;
      if (!mask[i]) continue;
      const edge = x === 0 || y === 0 || x === nx - 1 || y === ny - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - nx] || !mask[i + nx];
      const j = (y * nx + x) * 4;
      img.data[j] = 255; img.data[j + 1] = edge ? 60 : 0; img.data[j + 2] = 0; img.data[j + 3] = edge ? 255 : 60;
    }
    ctx.putImageData(img, 0, 0);
  }, [mask, version, slice, gd]);

  useEffect(() => {
    const el = wrap.current;
    const onWheel = (e) => { e.preventDefault(); onSlice((s) => s + (e.deltaY > 0 ? 1 : -1)); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onSlice]);

  const pos = (e) => {
    const r = wrap.current.getBoundingClientRect();
    return { x: Math.max(0, Math.min(W - 1, ((e.clientX - r.left) * W) / r.width)), y: Math.max(0, Math.min(H - 1, ((e.clientY - r.top) * H) / r.height)) };
  };
  const down = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pos(e);
    drag.current = p;
    if (tool === 'outline') onOutline({ z: slice, ...p, distMm: 0 });
    else onBrush({ z: slice, ...p, erase: tool === 'erase' || e.shiftKey });
  };
  const move = (e) => {
    if (!drag.current) return;
    const p = pos(e);
    if (tool === 'outline') {
      const s = drag.current;
      onOutline({ z: slice, x: s.x, y: s.y, distMm: Math.hypot((p.x - s.x) * spacing[2], (p.y - s.y) * spacing[1]) });
    } else onBrush({ z: slice, ...p, erase: tool === 'erase' || e.shiftKey });
  };
  const up = () => { drag.current = null; };

  return (
    <div ref={wrap} className="viewer" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <canvas ref={base} width={W} height={H} />
      <canvas ref={over} width={gd[2]} height={gd[1]} className="overlay" />
    </div>
  );
}
