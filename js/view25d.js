/* Sokoban - 2.5D "tilted top-down" (3/4) view.
 * Registers window.SokobanViews.depth(ctx, palette) -> view (same interface as view2d.js).
 *
 * The grid stays axis-aligned - up is up, right is right - so the arrow keys behave exactly as
 * in the 2D view. Each cell is W wide and D deep (D < W, as if the camera were tilted forward);
 * walls and crates are extruded upward with a visible front face, and the keeper stands up.
 * Rows are drawn top to bottom (depth = y) so nearer things overlap farther ones.
 */
(function () {
  'use strict';
  window.SokobanViews = window.SokobanViews || {};

  const TAU = Math.PI * 2;
  const MIN_W = 16;
  const MAX_W = 96;

  window.SokobanViews.depth = function (ctx, C) {
    let W = 48, D = 37;           // cell width / depth on screen
    let ZT = 30, ZL = 9, CH = 20; // tall wall, low (cutaway) wall, crate height
    let originY = 0;
    let cols = 0, rows = 0, cssW = 0, cssH = 0;

    const WALL_TOP = '#2E4470', WALL_TOP_EDGE = '#3C5686', WALL_EDGE = '#0B131C';
    const CRATE = { top: '#F59E0B', front: '#D97706', edge: '#92400E', seam: 'rgba(146, 64, 14, 0.5)' };
    const DONE  = { top: '#34D399', front: '#059669', edge: '#065F46', seam: 'rgba(6, 95, 70, 0.5)' };

    // ------------------------------------------------------------------ layout

    function layout(c, r, availW, availH) {
      cols = c; rows = r;
      const w = Math.min(availW / cols, availH / (0.78 * rows + 0.7));
      W = Math.max(MIN_W, Math.min(MAX_W, Math.floor(w)));
      D = W * 0.78;
      ZT = D * 0.8;
      ZL = D * 0.25;
      CH = D * 0.55;
      originY = Math.ceil(W * 0.68);   // headroom for wall tops / the keeper's head in row 0
      cssW = W * cols;
      cssH = Math.ceil(D * rows + originY + 2);
      return { cssW, cssH };
    }

    function cellAt(px, py) {
      return { x: Math.floor(px / W), y: Math.floor((py - originY) / D) };
    }

    // ------------------------------------------------------------------ primitives

    function drawFloor(px, py) {
      ctx.fillStyle = C.floorEdge;
      ctx.fillRect(px, py, W, D);
      ctx.fillStyle = C.floor;
      ctx.fillRect(px + 0.5, py + 0.5, W - 1, D - 1);
    }

    function drawGoal(px, py) {
      const cx = px + W / 2, cy = py + D / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, W * 0.21, D * 0.21, 0, 0, TAU);
      ctx.lineWidth = Math.max(1.5, W * 0.07);
      ctx.strokeStyle = C.goal;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, cy, W * 0.07, D * 0.07, 0, 0, TAU);
      ctx.fillStyle = C.goalLight;
      ctx.fill();
    }

    /** Brick courses filling a rectangle (the front face of a wall). */
    function drawBricks(x, y, w, h) {
      ctx.fillStyle = C.mortar;
      ctx.fillRect(x, y, w, h);
      const courses = Math.max(1, Math.round(h / (W * 0.27)));
      const bh = h / courses, bw = W / 2;
      const gap = Math.max(1, W * 0.05);
      const hl = Math.max(1, W * 0.035);
      for (let r = 0; r < courses; r++) {
        const off = r % 2 === 0 ? 0 : bw / 2;
        const by = y + r * bh;
        for (let cx = -bw; cx < w + bw; cx += bw) {
          const bx = x + cx + off;
          const x0 = Math.max(bx + gap / 2, x);
          const x1 = Math.min(bx + bw - gap / 2, x + w);
          if (x1 <= x0) continue;
          ctx.fillStyle = C.wall;
          ctx.fillRect(x0, by + gap / 2, x1 - x0, bh - gap);
          ctx.fillStyle = C.wallLight;
          ctx.fillRect(x0, by + gap / 2, x1 - x0, hl);
        }
      }
    }

    function drawWall(x, y, h) {
      const px = x * W, py = originY + y * D;
      // Front face (bricks), then the top face which extends into the row behind
      drawBricks(px, py + D - h, W, h);
      ctx.fillStyle = WALL_TOP;
      ctx.fillRect(px, py - h, W, D);
      ctx.strokeStyle = WALL_EDGE;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py - h + 0.5, W - 1, D - 1);
      // Bevel on the top face
      ctx.fillStyle = WALL_TOP_EDGE;
      ctx.fillRect(px + 1, py - h + 1, W - 2, Math.max(1, W * 0.04));
      ctx.fillRect(px + 1, py - h + 1, Math.max(1, W * 0.04), D - 2);
      // Dark lip where the top meets the front face
      ctx.fillStyle = WALL_EDGE;
      ctx.fillRect(px, py + D - h - 1, W, Math.max(1, W * 0.025));
    }

    function drawShadow(cx, cy, rx, ry, alpha) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
      ctx.fillStyle = `rgba(15, 25, 35, ${alpha})`;
      ctx.fill();
    }

    /** A crate at fractional cell (x, y): a box with a lid and a front face. */
    function drawCrate(x, y, onGoal) {
      const col = onGoal ? DONE : CRATE;
      const px = x * W, py = originY + y * D;
      const ix = W * 0.12, iy = D * 0.1;
      const bw = W - ix * 2, bd = D - iy * 2;
      const lw = Math.max(1.5, W * 0.045);

      drawShadow(px + W / 2 + W * 0.02, py + D - iy, bw * 0.55, D * 0.16, 0.25);

      // Front face
      ctx.fillStyle = col.front;
      ctx.fillRect(px + ix, py + D - iy - CH, bw, CH);
      // Planks
      ctx.strokeStyle = col.seam;
      ctx.lineWidth = Math.max(1, W * 0.02);
      ctx.beginPath();
      for (const f of [1 / 3, 2 / 3]) {
        const yy = py + D - iy - CH + CH * f;
        ctx.moveTo(px + ix, yy); ctx.lineTo(px + ix + bw, yy);
      }
      ctx.stroke();
      // Lid
      ctx.fillStyle = col.top;
      ctx.fillRect(px + ix, py + iy - CH, bw, bd);
      // Cross bracing on the lid
      const pad = Math.min(bw, bd) * 0.2;
      ctx.strokeStyle = col.edge;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px + ix + pad, py + iy - CH + pad); ctx.lineTo(px + ix + bw - pad, py + iy - CH + bd - pad);
      ctx.moveTo(px + ix + bw - pad, py + iy - CH + pad); ctx.lineTo(px + ix + pad, py + iy - CH + bd - pad);
      ctx.stroke();
      // Outline
      ctx.strokeStyle = col.edge;
      ctx.lineWidth = Math.max(1.5, W * 0.035);
      ctx.lineJoin = 'round';
      ctx.strokeRect(px + ix, py + iy - CH, bw, bd + CH);
      ctx.beginPath();
      ctx.moveTo(px + ix, py + iy - CH + bd); ctx.lineTo(px + ix + bw, py + iy - CH + bd);
      ctx.stroke();
    }

    /**
     * The keeper standing at fractional cell (x, y). Facing up shows their back,
     * facing down shows their face, left/right show a profile.
     */
    function drawKeeper(x, y, facing, pose) {
      const { phase, parity, push, shove = 0, strain = 0, jitter = 0 } = pose;
      const swing = push ? 0 : phase * (parity ? 1 : -1);
      const s = W * 1.08;
      const gx = (x + 0.5) * W + jitter * strain * s * 0.02;   // trembles while straining
      const gy = originY + (y + 0.74) * D;                      // where the feet touch the floor
      const fx = facing.dx, fy = facing.dy;
      const profile = fx !== 0;
      const toward = fy > 0;
      const away = fy < 0;
      const bob = -Math.abs(swing) * s * 0.02;

      drawShadow(gx, gy, s * 0.2, s * 0.07, 0.28);

      // Feet. Stride runs along the facing direction (foreshortened when up/down);
      // feet sit side by side across it. The back foot digs in while pushing.
      const stride = swing * s * 0.09;
      const lat = profile ? { x: 0, y: s * 0.035 } : { x: s * 0.085, y: 0 };
      const dir = { x: fx, y: fy * 0.45 };
      const lf = { x: gx - lat.x + dir.x * stride, y: gy - lat.y + dir.y * stride };
      const rf = { x: gx + lat.x - dir.x * stride, y: gy + lat.y - dir.y * stride };
      if (push) {
        const bf = parity ? lf : rf;
        const dig = (shove * 0.1 + strain * 0.05) * s;
        bf.x -= dir.x * dig; bf.y -= dir.y * dig;
      }
      const hipY = gy - s * 0.25 + bob;
      const leg = foot => {
        ctx.beginPath();
        ctx.moveTo(foot.x, foot.y);
        ctx.lineTo(foot.x * 0.4 + gx * 0.6, hipY);
        ctx.lineWidth = Math.max(2, s * 0.08);
        ctx.lineCap = 'round';
        ctx.strokeStyle = C.shirtDark;
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(foot.x, foot.y, s * 0.065, s * 0.035, 0, 0, TAU);
        ctx.fillStyle = C.shoe;
        ctx.fill();
      };
      // Farther (higher on screen) foot first
      if (lf.y <= rf.y) { leg(lf); leg(rf); } else { leg(rf); leg(lf); }

      // Torso, leaning toward the crate at the shoulders while pushing
      const leanX = fx * (shove * 0.08 + strain * 0.05) * s;
      const leanY = fy * (shove * 0.03 + strain * 0.02) * s;
      const shY = gy - s * 0.52 + bob + leanY;
      const torso = () => {
        ctx.beginPath();
        ctx.moveTo(gx - s * 0.12, hipY + s * 0.02);
        ctx.lineTo(gx + s * 0.12, hipY + s * 0.02);
        ctx.lineTo(gx + s * 0.15 + leanX, shY);
        ctx.lineTo(gx - s * 0.15 + leanX, shY);
        ctx.closePath();
        ctx.fillStyle = C.shirt;
        ctx.fill();
        ctx.lineWidth = Math.max(1, s * 0.025);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = C.shirtDark;
        ctx.stroke();
        // Hi-vis band
        const t0 = 0.42, t1 = 0.58;
        const yA = hipY + s * 0.02 + (shY - hipY - s * 0.02) * t0;
        const yB = hipY + s * 0.02 + (shY - hipY - s * 0.02) * t1;
        ctx.beginPath();
        ctx.moveTo(gx - s * 0.12 + (leanX - s * 0.03) * t0, yA); ctx.lineTo(gx + s * 0.12 + (leanX + s * 0.03) * t0, yA);
        ctx.lineTo(gx + s * 0.12 + (leanX + s * 0.03) * t1, yB); ctx.lineTo(gx - s * 0.12 + (leanX - s * 0.03) * t1, yB);
        ctx.closePath();
        ctx.fillStyle = C.shirtLight;
        ctx.globalAlpha = 0.5;
        ctx.fill();
        ctx.globalAlpha = 1;
      };

      // Arms. side = -1 (screen left) / +1 (screen right).
      const shoulder = side => ({ x: gx + side * s * 0.14 + leanX, y: shY + s * 0.03 });
      const hand = side => {
        const sh = shoulder(side);
        let hang, reach;
        if (profile) {
          // Both arms swing along the facing direction; far arm opposite the near one
          const sw = swing * side * s * 0.07;
          hang = { x: sh.x + fx * sw * 0.0 + sw, y: sh.y + s * 0.2 };
          reach = { x: sh.x + fx * s * 0.27, y: sh.y + s * 0.09 };
        } else {
          hang = { x: sh.x + side * s * 0.03, y: sh.y + s * 0.2 - swing * side * s * 0.04 };
          reach = toward
            ? { x: gx + side * s * 0.1 + leanX, y: sh.y + s * 0.22 }     // toward the viewer: hands low and in
            : { x: gx + side * s * 0.1 + leanX, y: sh.y - s * 0.06 };    // away: hands up past the shoulders
        }
        return { x: hang.x + (reach.x - hang.x) * shove, y: hang.y + (reach.y - hang.y) * shove };
      };
      const arm = side => {
        const sh = shoulder(side), hd = hand(side);
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(hd.x, hd.y);
        ctx.lineWidth = Math.max(2, s * 0.095); ctx.strokeStyle = C.shirtDark; ctx.stroke();
        ctx.lineWidth = Math.max(1, s * 0.06); ctx.strokeStyle = C.shirt; ctx.stroke();
        ctx.beginPath(); ctx.arc(hd.x, hd.y, s * 0.05, 0, TAU);
        ctx.fillStyle = C.glove; ctx.fill();
        ctx.lineWidth = Math.max(1, s * 0.02); ctx.strokeStyle = C.gloveDark; ctx.stroke();
      };
      if (profile) {
        // The arm on the far side of the body is the one opposite the facing direction
        const far = -fx, near = fx;
        arm(far); torso(); arm(near);
      } else if (away) {
        arm(-1); arm(1); torso();          // back view: arms behind
      } else {
        torso(); arm(-1); arm(1);          // front view: arms in front
      }

      // Head and hard hat
      const hx = gx + leanX, hy = gy - s * 0.66 + bob + leanY;
      const headR = s * 0.11;
      ctx.beginPath(); ctx.arc(hx, hy, headR, 0, TAU);
      ctx.fillStyle = C.face; ctx.fill();
      ctx.lineWidth = Math.max(1, s * 0.015); ctx.strokeStyle = C.faceEdge; ctx.stroke();
      if (toward) {
        ctx.fillStyle = C.shoe;
        for (const side of [-1, 1]) {
          ctx.beginPath(); ctx.arc(hx + side * s * 0.04, hy + s * 0.025, s * 0.017, 0, TAU); ctx.fill();
        }
      } else if (profile) {
        ctx.fillStyle = C.shoe;
        ctx.beginPath(); ctx.arc(hx + fx * s * 0.06, hy + s * 0.025, s * 0.017, 0, TAU); ctx.fill();
      }
      // Brim, then dome. Seen from behind the dome sits lower and hides the face.
      const domeDrop = away ? s * 0.02 : 0;
      ctx.beginPath(); ctx.ellipse(hx, hy - s * 0.005 + domeDrop, s * 0.15, s * 0.05, 0, 0, TAU);
      ctx.fillStyle = C.hat; ctx.fill();
      ctx.lineWidth = Math.max(1, s * 0.015); ctx.strokeStyle = C.hatRim; ctx.stroke();
      ctx.beginPath(); ctx.arc(hx, hy - s * 0.015 + domeDrop, s * 0.125, Math.PI, TAU); ctx.closePath();
      ctx.fillStyle = C.hat; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(hx - s * 0.03, hy - s * 0.05 + domeDrop, s * 0.05, Math.PI * 1.1, Math.PI * 1.6);
      ctx.lineWidth = Math.max(1, s * 0.02); ctx.strokeStyle = C.hatRidge; ctx.stroke();

      // Effort: sweat drops fly off while straining
      if (strain > 0.3) {
        const k = (strain - 0.3) / 0.7;
        ctx.fillStyle = C.goalLight;
        for (const side of [-1, 1]) {
          const dx = hx + side * (s * 0.17 + k * s * 0.06), dy = hy - s * 0.02 - k * s * 0.05;
          ctx.beginPath();
          ctx.ellipse(dx, dy, s * 0.028, s * 0.042, side * 0.5, 0, TAU);
          ctx.fill();
        }
      }
    }

    // ------------------------------------------------------------------ frame

    function render(scene) {
      const L = scene.level;
      ctx.clearRect(0, 0, cssW, cssH);

      for (let y = 0; y < L.height; y++) {
        for (let x = 0; x < L.width; x++) {
          if (!L.floor[y][x]) continue;
          const px = x * W, py = originY + y * D;
          drawFloor(px, py);
          if (L.goals[y][x]) drawGoal(px, py);
        }
      }

      const items = [];
      const skip = scene.movingBox ? scene.movingBox.to : null;
      for (let y = 0; y < L.height; y++) {
        for (let x = 0; x < L.width; x++) {
          if (L.walls[y][x]) {
            if (!wallVisible(L, x, y)) continue;
            items.push({ d: y, k: 0, x, y, kind: 'wall', h: floorBehind(L, x, y) ? ZL : ZT });
          } else if (scene.boxes[y][x] && !(skip && skip.x === x && skip.y === y)) {
            items.push({ d: y, k: 1, x, y, kind: 'box', onGoal: L.goals[y][x] });
          }
        }
      }
      if (scene.movingBox) {
        const mb = scene.movingBox;
        items.push({ d: mb.y, k: 1, x: mb.x, y: mb.y, kind: 'box', onGoal: L.goals[mb.to.y][mb.to.x] });
      }
      items.push({ d: scene.player.y, k: 2, x: scene.player.x, y: scene.player.y, kind: 'keeper' });
      items.sort((a, b) => a.d - b.d || a.k - b.k);

      for (const it of items) {
        if (it.kind === 'wall') drawWall(it.x, it.y, it.h);
        else if (it.kind === 'box') drawCrate(it.x, it.y, it.onGoal);
        else drawKeeper(it.x, it.y, scene.facing, scene.pose);
      }
    }

    /** A tall wall would hide the cell directly behind it; use a low curb if that is floor. */
    function floorBehind(L, x, y) {
      return y > 0 && L.floor[y - 1][x];
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

    return { id: 'depth', layout, render, cellAt };
  };
})();
