/* Sokoban - 2.5D isometric view.
 * Registers window.SokobanViews.iso(ctx, palette) -> view (same interface as view2d.js).
 *
 * Projection: 2:1 dimetric. Grid cell (x, y) maps to a diamond whose top corner is at
 *   sx = (x - y) * W/2 + originX,   sy = (x + y) * H/2 + originY       (H = W/2)
 * so grid "up" (y-1) is up-right on screen, grid "right" (x+1) is down-right.
 * Everything is drawn back-to-front by depth = x + y (painter's algorithm).
 */
(function () {
  'use strict';
  window.SokobanViews = window.SokobanViews || {};

  const TAU = Math.PI * 2;
  const MIN_W = 20;
  const MAX_W = 128;

  window.SokobanViews.iso = function (ctx, C) {
    let W = 64, H = 32;        // diamond width / height
    let ZH = 32, ZL = 12, CH = 23;   // tall wall, low (cutaway) wall, crate height
    let originX = 0, originY = 0;
    let cols = 0, rows = 0, cssW = 0, cssH = 0;

    const WALL  = { top: '#2E4470', left: '#1B2A4A', right: '#131F38', edge: '#0B131C', seam: 'rgba(11, 19, 28, 0.55)' };
    const CRATE = { top: '#F59E0B', left: '#D97706', right: '#B45309', edge: '#92400E', seam: 'rgba(146, 64, 14, 0.45)' };
    const DONE  = { top: '#34D399', left: '#059669', right: '#047857', edge: '#065F46', seam: 'rgba(6, 95, 70, 0.45)' };

    // ------------------------------------------------------------------ layout

    function layout(c, r, availW, availH) {
      cols = c; rows = r;
      const n = cols + rows;
      // canvas width = n * W/2 ; height = n * W/4 + headroom for walls / the keeper's head
      const w = Math.min(availW / (n / 2), availH / (n / 4 + 0.85));
      W = Math.max(MIN_W, Math.min(MAX_W, Math.floor(w)));
      H = W / 2;
      ZH = W * 0.5;
      ZL = W * 0.18;
      CH = W * 0.36;
      originX = rows * W / 2;
      originY = W * 0.82;
      cssW = Math.ceil(n * W / 2);
      cssH = Math.ceil(n * H / 2 + originY + 2);
      return { cssW, cssH };
    }

    function ground(x, y) {   // centre of the cell's floor diamond
      return { sx: (x - y) * W / 2 + originX, sy: (x + y) * H / 2 + originY + H / 2 };
    }

    function cellAt(px, py) {
      const u = (px - originX) / (W / 2);
      const v = (py - originY - H / 2) / (H / 2);
      return { x: Math.round((u + v) / 2), y: Math.round((v - u) / 2) };
    }

    // ------------------------------------------------------------------ primitives

    function diamondPath(cx, cy, s, z) {
      const hw = W / 2 * s, hh = H / 2 * s, y = cy - z;
      ctx.beginPath();
      ctx.moveTo(cx, y - hh);
      ctx.lineTo(cx + hw, y);
      ctx.lineTo(cx, y + hh);
      ctx.lineTo(cx - hw, y);
      ctx.closePath();
    }

    function drawFloor(cx, cy) {
      diamondPath(cx, cy, 1, 0);
      ctx.fillStyle = C.floor;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = C.floorEdge;
      ctx.stroke();
    }

    function drawGoal(cx, cy) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, W * 0.2, H * 0.2, 0, 0, TAU);
      ctx.lineWidth = Math.max(1.5, W * 0.045);
      ctx.strokeStyle = C.goal;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, cy, W * 0.065, H * 0.065, 0, 0, TAU);
      ctx.fillStyle = C.goalLight;
      ctx.fill();
    }

    /** An extruded diamond (prism) standing on the floor at (cx, cy). */
    function drawBlock(cx, cy, s, h, col) {
      const hw = W / 2 * s, hh = H / 2 * s;
      ctx.lineJoin = 'round';

      ctx.fillStyle = col.left;
      ctx.beginPath();
      ctx.moveTo(cx - hw, cy); ctx.lineTo(cx, cy + hh); ctx.lineTo(cx, cy + hh - h); ctx.lineTo(cx - hw, cy - h);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = col.right;
      ctx.beginPath();
      ctx.moveTo(cx, cy + hh); ctx.lineTo(cx + hw, cy); ctx.lineTo(cx + hw, cy - h); ctx.lineTo(cx, cy + hh - h);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = col.top;
      diamondPath(cx, cy, s, h);
      ctx.fill();

      ctx.strokeStyle = col.edge;
      ctx.lineWidth = Math.max(1, W * 0.016);
      diamondPath(cx, cy, s, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - hw, cy - h); ctx.lineTo(cx - hw, cy); ctx.lineTo(cx, cy + hh); ctx.lineTo(cx + hw, cy); ctx.lineTo(cx + hw, cy - h);
      ctx.moveTo(cx, cy + hh - h); ctx.lineTo(cx, cy + hh);
      ctx.stroke();
    }

    /** Horizontal courses across both side faces of a block at fractions of its height. */
    function drawCourses(cx, cy, s, h, fracs, color, width) {
      const hw = W / 2 * s, hh = H / 2 * s;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const f of fracs) {
        const k = h * f;
        ctx.moveTo(cx - hw, cy - k); ctx.lineTo(cx, cy + hh - k); ctx.lineTo(cx + hw, cy - k);
      }
      ctx.stroke();
    }

    function drawWall(cx, cy, h) {
      drawBlock(cx, cy, 1, h, WALL);
      const hw = W / 2, hh = H / 2;
      const lw = Math.max(1, W * 0.014);
      const courses = Math.max(1, Math.round(h / (W * 0.17)));
      const fr = [];
      for (let i = 1; i < courses; i++) fr.push(i / courses);
      if (fr.length) drawCourses(cx, cy, 1, h, fr, WALL.seam, lw);
      // Staggered vertical seams (brick ends), alternating per course
      ctx.strokeStyle = WALL.seam;
      ctx.lineWidth = lw;
      ctx.beginPath();
      const seam = (fx, k0, k1) => {   // fx: 0 = left corner .. 1 = bottom corner .. 2 = right corner
        let x, yg;
        if (fx <= 1) { x = cx - hw + hw * fx; yg = cy + hh * fx; }
        else { x = cx + hw * (fx - 1); yg = cy + hh - hh * (fx - 1); }
        ctx.moveTo(x, yg - h * k0); ctx.lineTo(x, yg - h * k1);
      };
      for (let i = 0; i < courses; i++) {
        const k0 = i / courses, k1 = (i + 1) / courses;
        if (i % 2 === 0) { seam(0.5, k0, k1); seam(1.5, k0, k1); }
        else { seam(0.25, k0, k1); seam(0.75, k0, k1); seam(1.25, k0, k1); seam(1.75, k0, k1); }
      }
      ctx.stroke();
    }

    function drawShadow(cx, cy, rx, ry, alpha) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
      ctx.fillStyle = `rgba(15, 25, 35, ${alpha})`;
      ctx.fill();
    }

    function drawCrate(cx, cy, onGoal) {
      const col = onGoal ? DONE : CRATE;
      const s = 0.72;
      drawShadow(cx + W * 0.02, cy + H * 0.04, W * 0.4, H * 0.4, 0.22);
      drawBlock(cx, cy, s, CH, col);
      drawCourses(cx, cy, s, CH, [1 / 3, 2 / 3], col.seam, Math.max(1, W * 0.014));
      // Cross bracing on the lid
      const hw = W / 2 * s * 0.62, hh = H / 2 * s * 0.62, top = cy - CH;
      ctx.strokeStyle = col.edge;
      ctx.lineWidth = Math.max(1.5, W * 0.03);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - hw, top); ctx.lineTo(cx + hw, top);
      ctx.moveTo(cx, top - hh); ctx.lineTo(cx, top + hh);
      ctx.stroke();
    }

    function norm(x, y) { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; }

    /**
     * The keeper, standing upright at fractional cell (x, y).
     * f = screen direction they face, l = screen direction of their left side.
     */
    function drawKeeper(x, y, facing, pose) {
      const g = ground(x, y);
      const { phase, parity, push } = pose;
      const swing = push ? 0 : phase * (parity ? 1 : -1);
      const shove = push ? phase : 0;
      const f = norm((facing.dx - facing.dy) * W / 2, (facing.dx + facing.dy) * H / 2);
      const ldx = facing.dy, ldy = -facing.dx;
      const l = norm((ldx - ldy) * W / 2, (ldx + ldy) * H / 2);
      const toward = f.y > 0;                    // facing the viewer: face visible
      const s = W * 1.12;
      const bob = -Math.abs(swing) * s * 0.02;
      const leanX = f.x * shove * s * 0.08, leanY = f.y * shove * s * 0.03;

      drawShadow(g.sx, g.sy, s * 0.2, s * 0.1, 0.28);

      // Feet: stride along f while walking; when pushing the back foot plants further back.
      const stride = swing * s * 0.09;
      const back = shove * s * 0.1;
      const lf = { x: g.sx + l.x * s * 0.075 - f.x * stride, y: g.sy + l.y * s * 0.075 - f.y * stride };
      const rf = { x: g.sx - l.x * s * 0.075 + f.x * stride, y: g.sy - l.y * s * 0.075 + f.y * stride };
      if (push) { const bf = parity ? lf : rf; bf.x -= f.x * back; bf.y -= f.y * back; }
      const hipY = g.sy - s * 0.26 + bob;
      const leg = (foot, side) => {
        ctx.beginPath();
        ctx.moveTo(foot.x, foot.y);
        ctx.lineTo(g.sx + l.x * side * s * 0.05, hipY);
        ctx.lineWidth = Math.max(2, s * 0.075);
        ctx.lineCap = 'round';
        ctx.strokeStyle = C.shirtDark;
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(foot.x, foot.y, s * 0.06, s * 0.035, 0, 0, TAU);
        ctx.fillStyle = C.shoe;
        ctx.fill();
      };
      // Far leg first
      if (l.y < 0) { leg(lf, 1); leg(rf, -1); } else { leg(rf, -1); leg(lf, 1); }

      // Torso: a slightly tapered slab, leaning at the shoulders when pushing
      const shY = g.sy - s * 0.5 + bob + leanY;
      const torso = () => {
        ctx.beginPath();
        ctx.moveTo(g.sx - s * 0.12, hipY + s * 0.02);
        ctx.lineTo(g.sx + s * 0.12, hipY + s * 0.02);
        ctx.lineTo(g.sx + s * 0.145 + leanX, shY);
        ctx.lineTo(g.sx - s * 0.145 + leanX, shY);
        ctx.closePath();
        ctx.fillStyle = C.shirt;
        ctx.fill();
        ctx.lineWidth = Math.max(1, s * 0.025);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = C.shirtDark;
        ctx.stroke();
        // Hi-vis band
        const t0 = 0.45, t1 = 0.6;
        const bx0 = g.sx - s * 0.12 + (leanX - s * 0.025) * t0, bx1 = g.sx + s * 0.12 + (leanX + s * 0.025) * t0;
        const by = hipY + s * 0.02 + (shY - hipY - s * 0.02) * t0;
        const cx0 = g.sx - s * 0.12 + (leanX - s * 0.025) * t1, cx1 = g.sx + s * 0.12 + (leanX + s * 0.025) * t1;
        const cy = hipY + s * 0.02 + (shY - hipY - s * 0.02) * t1;
        ctx.beginPath();
        ctx.moveTo(bx0, by); ctx.lineTo(bx1, by); ctx.lineTo(cx1, cy); ctx.lineTo(cx0, cy);
        ctx.closePath();
        ctx.fillStyle = C.shirtLight;
        ctx.globalAlpha = 0.5;
        ctx.fill();
        ctx.globalAlpha = 1;
      };

      // Arms
      const shoulder = side => ({ x: g.sx + l.x * side * s * 0.13 + leanX, y: shY + l.y * side * s * 0.13 * 0.5 + s * 0.03 });
      const hand = side => {
        const sh = shoulder(side);
        const hang = { x: sh.x + f.x * swing * side * s * 0.07, y: sh.y + s * 0.2 + f.y * swing * side * s * 0.07 };
        const reach = { x: sh.x + f.x * s * 0.27, y: sh.y + f.y * s * 0.27 + s * 0.07 };
        return { x: hang.x + (reach.x - hang.x) * shove, y: hang.y + (reach.y - hang.y) * shove };
      };
      const arm = side => {
        const sh = shoulder(side), hd = hand(side);
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(hd.x, hd.y);
        ctx.lineWidth = Math.max(2, s * 0.09); ctx.strokeStyle = C.shirtDark; ctx.stroke();
        ctx.lineWidth = Math.max(1, s * 0.055); ctx.strokeStyle = C.shirt; ctx.stroke();
        ctx.beginPath(); ctx.arc(hd.x, hd.y, s * 0.045, 0, TAU);
        ctx.fillStyle = C.glove; ctx.fill();
        ctx.lineWidth = Math.max(1, s * 0.018); ctx.strokeStyle = C.gloveDark; ctx.stroke();
      };
      const farSide = l.y < 0 ? 1 : -1;
      if (push && !toward) { arm(1); arm(-1); torso(); }
      else if (push && toward) { torso(); arm(1); arm(-1); }
      else { arm(farSide); torso(); arm(-farSide); }

      // Head + hard hat
      const hx = g.sx + leanX, hy = g.sy - s * 0.64 + bob + leanY;
      const headR = s * 0.105;
      ctx.beginPath(); ctx.arc(hx, hy, headR, 0, TAU);
      ctx.fillStyle = C.face; ctx.fill();
      ctx.lineWidth = Math.max(1, s * 0.015); ctx.strokeStyle = C.faceEdge; ctx.stroke();
      if (toward) {
        ctx.fillStyle = C.shoe;
        for (const side of [1, -1]) {
          ctx.beginPath();
          ctx.arc(hx + f.x * s * 0.025 + l.x * side * s * 0.04, hy + s * 0.02 + l.y * side * s * 0.01, s * 0.016, 0, TAU);
          ctx.fill();
        }
      }
      // Brim then dome
      ctx.beginPath(); ctx.ellipse(hx, hy - s * 0.01, s * 0.145, s * 0.045, 0, 0, TAU);
      ctx.fillStyle = C.hat; ctx.fill();
      ctx.lineWidth = Math.max(1, s * 0.015); ctx.strokeStyle = C.hatRim; ctx.stroke();
      ctx.beginPath(); ctx.arc(hx, hy - s * 0.02, s * 0.12, Math.PI, TAU); ctx.closePath();
      ctx.fillStyle = C.hat; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(hx - s * 0.03, hy - s * 0.05, s * 0.05, Math.PI * 1.1, Math.PI * 1.6);
      ctx.lineWidth = Math.max(1, s * 0.02); ctx.strokeStyle = C.hatRidge; ctx.stroke();
    }

    /** Small compass in the empty top-left corner: which way each arrow key moves. */
    function drawCompass() {
      const r = W * 0.5;
      const cx = r * 1.4, cy = r * 1.4;
      if (rows < 5) return;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.25, 0, TAU);
      ctx.fillStyle = 'rgba(27, 42, 74, 0.7)'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.stroke();
      const dirs = [
        { label: '↑', dx: 0, dy: -1 }, { label: '→', dx: 1, dy: 0 },
        { label: '↓', dx: 0, dy: 1 },  { label: '←', dx: -1, dy: 0 },
      ];
      ctx.font = `bold ${Math.max(9, W * 0.24)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const d of dirs) {
        const v = norm((d.dx - d.dy) * W / 2, (d.dx + d.dy) * H / 2);
        ctx.beginPath();
        ctx.moveTo(cx + v.x * r * 0.15, cy + v.y * r * 0.15);
        ctx.lineTo(cx + v.x * r * 0.62, cy + v.y * r * 0.62);
        ctx.lineWidth = Math.max(1.5, W * 0.035); ctx.lineCap = 'round';
        ctx.strokeStyle = C.goalLight; ctx.stroke();
        // arrow head
        const ax = cx + v.x * r * 0.62, ay = cy + v.y * r * 0.62;
        const p = { x: -v.y, y: v.x };
        ctx.beginPath();
        ctx.moveTo(ax + v.x * r * 0.14, ay + v.y * r * 0.14);
        ctx.lineTo(ax + p.x * r * 0.1, ay + p.y * r * 0.1);
        ctx.lineTo(ax - p.x * r * 0.1, ay - p.y * r * 0.1);
        ctx.closePath(); ctx.fillStyle = C.goalLight; ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(d.label, cx + v.x * r * 1.0, cy + v.y * r * 1.0);
      }
      ctx.restore();
    }

    // ------------------------------------------------------------------ frame

    function render(scene) {
      const L = scene.level;
      ctx.clearRect(0, 0, cssW, cssH);

      for (let y = 0; y < L.height; y++) {
        for (let x = 0; x < L.width; x++) {
          if (!L.floor[y][x]) continue;
          const g = ground(x, y);
          drawFloor(g.sx, g.sy);
          if (L.goals[y][x]) drawGoal(g.sx, g.sy);
        }
      }

      const items = [];
      const skip = scene.movingBox ? scene.movingBox.to : null;
      for (let y = 0; y < L.height; y++) {
        for (let x = 0; x < L.width; x++) {
          if (L.walls[y][x]) {
            // Walls that touch nothing visible can be skipped
            if (!wallVisible(L, x, y)) continue;
            items.push({ d: x + y, k: 0, x, y, kind: 'wall', h: occludesFloor(L, x, y) ? ZL : ZH });
          } else if (scene.boxes[y][x] && !(skip && skip.x === x && skip.y === y)) {
            items.push({ d: x + y, k: 1, x, y, kind: 'box', onGoal: L.goals[y][x] });
          }
        }
      }
      if (scene.movingBox) {
        const mb = scene.movingBox;
        items.push({ d: mb.x + mb.y, k: 1, x: mb.x, y: mb.y, kind: 'box', onGoal: L.goals[mb.to.y][mb.to.x] });
      }
      items.push({ d: scene.player.x + scene.player.y, k: 2, x: scene.player.x, y: scene.player.y, kind: 'keeper' });
      items.sort((a, b) => a.d - b.d || a.k - b.k);

      for (const it of items) {
        if (it.kind === 'keeper') { drawKeeper(it.x, it.y, scene.facing, scene.pose); continue; }
        const g = ground(it.x, it.y);
        if (it.kind === 'wall') drawWall(g.sx, g.sy, it.h);
        else drawCrate(g.sx, g.sy, it.onGoal);
      }

      drawCompass();
    }

    /**
     * A full-height wall hides the three cells behind it on screen: (x-1,y),
     * (x,y-1) and (x-1,y-1). If any of those is playable floor the wall is
     * drawn as a low curb instead, so the player can always see the board.
     */
    function occludesFloor(L, x, y) {
      const f = (ax, ay) => ax >= 0 && ay >= 0 && L.floor[ay] && L.floor[ay][ax];
      return f(x - 1, y) || f(x, y - 1) || f(x - 1, y - 1);
    }

    /** A wall is worth drawing if any of its 8 neighbours is interior floor. */
    function wallVisible(L, x, y) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= L.width || ny >= L.height) continue;
          if (L.floor[ny][nx]) return true;
        }
      }
      return false;
    }

    return { id: 'iso', layout, render, cellAt };
  };
})();
