import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

const WHEEL_STEP = 80; // wheel pixels per slice: one mouse notch is one slice; trackpad movement accumulates
const MAX_ZOOM = 10;
const PAD_TOP = 52, PAD_BOTTOM = 14; // room kept around the image at 100%: the hint line sits above it
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Axial slice viewer that fills the whole stage. At 100% the image sits centred; zooming grows it across
 * the dark area behind it. Wheel scrolls slices; Ctrl/Cmd+wheel or pinch zooms at the cursor;
 * Space+drag, the middle button or Alt+drag pans.
 */
const Viewer = forwardRef(function Viewer(
  { vol, dims, spacing, gd, mask, others, version, slice, win, tool, onSlice, onOutline, onBrush, onGesture, showOutline, axes, orient, onViewChange }, ref,
) {
  const base = useRef(null), over = useRef(null), wrap = useRef(null), drag = useRef(null);
  const wheelAcc = useRef(0), space = useRef(false), zoomAtRef = useRef(null), viewRef = useRef(null), fitRef = useRef(null), boxRef = useRef(null);
  const [view, setView] = useState({ s: 1, X: 0, Y: 0 }); // X, Y: top-left of the image in stage pixels
  const [box, setBox] = useState({ cw: 0, ch: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false), [panning, setPanning] = useState(false);
  const [, H, W] = dims;

  // size of the image at 100%, and where it sits
  const availW = box.cw - 28, availH = box.ch - PAD_TOP - PAD_BOTTOM;
  const S = Math.max(120, Math.min(availW, availH));
  const fit = { S, fx: (box.cw - S) / 2, fy: PAD_TOP + (availH - S) / 2 };
  viewRef.current = view; fitRef.current = fit; boxRef.current = box;

  // keep the image on the stage: centred while smaller than the stage, edge to edge once larger
  const place = (s, X, Y) => {
    const f = fitRef.current, b = boxRef.current, ns = clamp(s, 1, MAX_ZOOM), cs = f.S * ns;
    const nx = cs <= b.cw ? (b.cw - cs) / 2 : clamp(X, b.cw - cs, 0);
    const cy = f.fy + f.S / 2;
    const ny = cs <= b.ch ? clamp(cy - cs / 2, 0, b.ch - cs) : clamp(Y, b.ch - cs, 0);
    const next = { s: ns, X: nx, Y: ny };
    viewRef.current = next; // update at once, so several fast wheel events in one frame all count
    setView(next);
    if (onViewChange) onViewChange(ns);
  };
  const zoomAt = (factor, lx, ly) => {
    const v = viewRef.current, ns = clamp(v.s * factor, 1, MAX_ZOOM), k = ns / v.s;
    place(ns, lx - (lx - v.X) * k, ly - (ly - v.Y) * k); // keep the point under the cursor fixed
  };
  zoomAtRef.current = zoomAt;
  useImperativeHandle(ref, () => ({
    zoomBy: (f) => zoomAt(f, boxRef.current.cw / 2, boxRef.current.ch / 2),
    fit: () => place(1, 0, 0),
    png: () => { // the slice as displayed, with the outline on it, as a PNG data URL
      const b = base.current, c = document.createElement('canvas');
      c.width = b.width; c.height = b.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(b, 0, 0);
      ctx.imageSmoothingEnabled = false;
      if (showOutline) ctx.drawImage(over.current, 0, 0, b.width, b.height);
      return c.toDataURL('image/png');
    },
  }));

  // follow the stage size
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setBox({ cw: e.contentRect.width, ch: e.contentRect.height }));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { if (box.cw) { const v = viewRef.current; place(v.s, v.X, v.Y); } }, [box.cw, box.ch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (box.cw) place(1, 0, 0); }, [vol]); // eslint-disable-line react-hooks/exhaustive-deps

  // base slice
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

  // outline overlay
  useEffect(() => {
    const [, ny, nx] = gd, ctx = over.current.getContext('2d');
    const img = ctx.createImageData(nx, ny), k = slice * ny * nx;
    if (others) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { // the scan's other tumours: a faint outline only
      const i = k + y * nx + x;
      if (!others[i]) continue;
      if (!(x === 0 || y === 0 || x === nx - 1 || y === ny - 1 || !others[i - 1] || !others[i + 1] || !others[i - nx] || !others[i + nx])) continue;
      const j = (y * nx + x) * 4;
      img.data[j] = 253; img.data[j + 1] = 253; img.data[j + 2] = 249; img.data[j + 3] = 120;
    }
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = k + y * nx + x;
      if (!mask[i]) continue;
      const edge = x === 0 || y === 0 || x === nx - 1 || y === ny - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - nx] || !mask[i + nx];
      const j = (y * nx + x) * 4;
      // warm coral-red: stands out on grey CT and sits well with the teal and sand theme
      img.data[j] = edge ? 255 : 236; img.data[j + 1] = edge ? 104 : 88; img.data[j + 2] = edge ? 72 : 66; img.data[j + 3] = edge ? 255 : 70;
    }
    ctx.putImageData(img, 0, 0);
  }, [mask, others, version, slice, gd]);

  // wheel: slices (accumulated) or zoom
  useEffect(() => {
    const el = wrap.current;
    const onWheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { // pinch on a trackpad arrives as ctrl+wheel
        const r = el.getBoundingClientRect();
        zoomAtRef.current(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
        return;
      }
      wheelAcc.current += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const n = Math.trunc(wheelAcc.current / WHEEL_STEP);
      if (n) { wheelAcc.current -= n * WHEEL_STEP; onSlice((s) => s + n); }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onSlice]);

  // Space held = pan mode
  useEffect(() => {
    // Space belongs to a focused control (buttons, checkboxes, text fields, selects); only elsewhere it means pan
    const typing = (t) => ['TEXTAREA', 'SELECT', 'INPUT', 'BUTTON'].includes(t.tagName);
    const dn = (e) => { if (e.code === 'Space' && !typing(e.target)) { e.preventDefault(); space.current = true; setSpaceHeld(true); } };
    const up = (e) => { if (e.code === 'Space') { space.current = false; setSpaceHeld(false); } };
    window.addEventListener('keydown', dn); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);

  // pointer position in image pixels, accounting for zoom and pan
  const pos = (e) => {
    const r = wrap.current.getBoundingClientRect(), v = viewRef.current, f = fitRef.current;
    const ix = ((e.clientX - r.left - v.X) / v.s / f.S) * W, iy = ((e.clientY - r.top - v.Y) / v.s / f.S) * H;
    return { x: clamp(ix, 0, W - 1), y: clamp(iy, 0, H - 1), inside: ix >= 0 && ix < W && iy >= 0 && iy < H };
  };
  const down = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 1 || space.current || e.altKey) { // pan
      e.preventDefault();
      drag.current = { pan: true, x: e.clientX, y: e.clientY, X: view.X, Y: view.Y };
      setPanning(true);
      return;
    }
    const p = pos(e);
    if (!p.inside) return; // clicks on the dark area beside the image do nothing
    drag.current = p;
    if (onGesture) onGesture(true);
    if (tool === 'outline') onOutline({ z: slice, x: p.x, y: p.y, distMm: 0, start: true });
    else onBrush({ z: slice, x: p.x, y: p.y, erase: tool === 'erase' || e.shiftKey, start: true });
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    if (d.pan) { place(view.s, d.X + (e.clientX - d.x), d.Y + (e.clientY - d.y)); return; }
    const p = pos(e);
    if (tool === 'outline') onOutline({ z: slice, x: d.x, y: d.y, distMm: Math.hypot((p.x - d.x) * spacing[2], (p.y - d.y) * spacing[1]) });
    else onBrush({ z: slice, x: p.x, y: p.y, erase: tool === 'erase' || e.shiftKey });
  };
  const up = () => { if (drag.current && !drag.current.pan && onGesture) onGesture(false); drag.current = null; setPanning(false); };

  // image pixel -> stage pixel (for the labels, which are not scaled with the image)
  const toStage = (ix, iy) => [view.X + (ix / W) * S * view.s, view.Y + (iy / H) * S * view.s];
  const kx = W / gd[2], ky = H / gd[1];
  const P = (pt) => [(pt[1] + 0.5) * kx, (pt[0] + 0.5) * ky]; // grid pixel (y, x) -> image pixel (x, y)
  const showAxes = showOutline && axes && axes.slice === slice;

  const line = (a, b, color, key) => {
    const [x1, y1] = P(a), [x2, y2] = P(b), r = (3.4 / view.s) * (W / S);
    return (
      <g key={key}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(0,0,0,.6)" strokeWidth="3.6" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
        <circle cx={x1} cy={y1} r={r} fill={color} stroke="rgba(0,0,0,.6)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <circle cx={x2} cy={y2} r={r} fill={color} stroke="rgba(0,0,0,.6)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </g>
    );
  };
  // a text label at the far end of a line, so the lines say what they are
  const label = (name, mm, a, b, cls) => {
    const [ax, ay] = toStage(...P(a)), [bx, by] = toStage(...P(b));
    const right = bx >= ax;
    return (
      <div key={name} className={`alabel ${cls}`} style={{ left: bx, top: by, transform: right ? 'translate(10px, -50%)' : 'translate(calc(-100% - 10px), -50%)' }}>
        <i /> {name} <b>{mm.toFixed(1)} mm</b>
      </div>
    );
  };

  // R/L/A/P letters at the edges of the visible image (they stay on screen while zoomed)
  const x0 = Math.max(view.X, 0), x1 = Math.min(view.X + S * view.s, box.cw), y0 = Math.max(view.Y, 0), y1 = Math.min(view.Y + S * view.s, box.ch);
  const midX = (x0 + x1) / 2, midY = (y0 + y1) / 2;

  return (
    <div ref={wrap} className={`viewer ${spaceHeld ? 'grab' : ''} ${panning ? 'grabbing' : ''}`}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onContextMenu={(e) => e.preventDefault()}>
      <div className="vcontent" style={{ width: S, height: S, transform: `translate(${view.X}px, ${view.Y}px) scale(${view.s})` }}>
        <canvas ref={base} width={W} height={H} />
        <canvas ref={over} width={gd[2]} height={gd[1]} className="overlay" style={{ visibility: showOutline ? 'visible' : 'hidden' }} />
        {showAxes && (
          <svg className="axes" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            {line(axes.q1, axes.q2, '#9fd3d6', 'short')}
            {line(axes.p1, axes.p2, '#fdfdf9', 'long')}
          </svg>
        )}
      </div>
      {orient && (
        <div className="vorient" aria-hidden="true">
          <span style={{ left: x0 + 10, top: midY }}>{orient.left}</span>
          <span style={{ left: x1 - 10, top: midY }}>{orient.right}</span>
          <span style={{ left: midX, top: y0 + 12 }}>{orient.top}</span>
          <span style={{ left: midX, top: y1 - 12 }}>{orient.bottom}</span>
        </div>
      )}
      {showAxes && (
        <div className="vlabels">
          {label('Long', axes.longMm, axes.p1, axes.p2, 'long')}
          {label('Short', axes.shortMm, axes.q1, axes.q2, 'short')}
        </div>
      )}
    </div>
  );
});

export default Viewer;
