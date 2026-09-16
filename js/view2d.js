/* Sokoban - classic top-down (2D) view.
 * Registers window.SokobanViews.flat(ctx, palette) -> view.
 * A view exposes:
 *   layout(cols, rows, availW, availH) -> { cssW, cssH }   choose a scale to fit the space
 *   render(scene)                                          draw one frame
 *   cellAt(px, py) -> { x, y }                             canvas pixel -> grid cell
 * scene = { level, boxes, player:{x,y}, movingBox:{x,y,to}|null, facing:{dx,dy}, pose:{phase,parity,push} }
 */
(function () {
  'use strict';
  window.SokobanViews = window.SokobanViews || {};

  const MAX_TILE = 72;
  const MIN_TILE = 12;
  const TAU = Math.PI * 2;

  window.SokobanViews.flat = function (ctx, C) {
    let tile = 40;
    let facing = { dx: 0, dy: 1 };

    function layout(cols, rows, availW, availH) {
      tile = Math.floor(Math.min(availW / cols, availH / rows));
      tile = Math.max(MIN_TILE, Math.min(MAX_TILE, tile));
      return { cssW: tile * cols, cssH: tile * rows };
    }

    function cellAt(px, py) {
      return { x: Math.floor(px / tile), y: Math.floor(py / tile) };
    }

    function render(scene) {
      const L = scene.level;
      facing = scene.facing;
      ctx.clearRect(0, 0, tile * L.width, tile * L.height);

      for (let y = 0; y < L.height; y++) {
        for (let x = 0; x < L.width; x++) {
          const px = x * tile, py = y * tile;
          if (L.walls[y][x]) {
            drawWall(px, py);
          } else if (L.floor[y][x]) {
            drawFloor(px, py);
            if (L.goals[y][x]) drawGoal(px, py);
          }
        }
      }

      const skip = scene.movingBox ? scene.movingBox.to : null;
      for (let y = 0; y < L.height; y++) {
        for (let x = 0; x < L.width; x++) {
          if (!scene.boxes[y][x]) continue;
          if (skip && skip.x === x && skip.y === y) continue;
          drawBox(x * tile, y * tile, L.goals[y][x]);
        }
      }
      if (scene.movingBox) {
        const mb = scene.movingBox;
        drawBox(mb.x * tile, mb.y * tile, L.goals[mb.to.y][mb.to.x]);
      }

      drawPlayer(scene.player.x * tile, scene.player.y * tile, scene.pose);
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function drawFloor(x, y) {
      ctx.fillStyle = C.floorEdge;
      ctx.fillRect(x, y, tile, tile);
      ctx.fillStyle = C.floor;
      ctx.fillRect(x + 0.5, y + 0.5, tile - 1, tile - 1);
    }

    function drawGoal(x, y) {
      const cx = x + tile / 2, cy = y + tile / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, tile * 0.22, 0, TAU);
      ctx.lineWidth = Math.max(1.5, tile * 0.08);
      ctx.strokeStyle = C.goal;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, tile * 0.07, 0, TAU);
      ctx.fillStyle = C.goalLight;
      ctx.fill();
    }

    function drawWall(x, y) {
      ctx.fillStyle = C.mortar;
      ctx.fillRect(x, y, tile, tile);
      const gap = Math.max(1, tile * 0.06);
      const bh = tile / 2, bw = tile / 2;
      const hl = Math.max(1, tile * 0.045);
      for (let r = 0; r < 2; r++) {
        const off = r === 0 ? 0 : bw / 2;
        const by = y + r * bh;
        for (let cx = -bw; cx < tile + bw; cx += bw) {
          const bx = x + cx + off;
          const x0 = Math.max(bx + gap / 2, x);
          const x1 = Math.min(bx + bw - gap / 2, x + tile);
          if (x1 <= x0) continue;
          ctx.fillStyle = C.wall;
          ctx.fillRect(x0, by + gap / 2, x1 - x0, bh - gap);
          ctx.fillStyle = C.wallLight;
          ctx.fillRect(x0, by + gap / 2, x1 - x0, hl);
        }
      }
    }

    function drawBox(x, y, onGoal) {
      const inset = tile * 0.1;
      const s = tile - inset * 2;
      const r = Math.max(2, tile * 0.1);
      const base = onGoal ? C.boxDone : C.box;
      const dark = onGoal ? C.boxDoneDark : C.boxDark;
      const light = onGoal ? C.boxDoneLight : C.boxLight;

      ctx.fillStyle = 'rgba(15, 25, 35, 0.22)';
      roundRect(x + inset + 1.5, y + inset + 2.5, s, s, r);
      ctx.fill();

      ctx.fillStyle = base;
      roundRect(x + inset, y + inset, s, s, r);
      ctx.fill();

      ctx.fillStyle = light;
      ctx.globalAlpha = 0.55;
      roundRect(x + inset, y + inset, s, s * 0.22, r);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.lineWidth = Math.max(1.5, tile * 0.06);
      ctx.strokeStyle = dark;
      roundRect(x + inset, y + inset, s, s, r);
      ctx.stroke();

      const pad = s * 0.22;
      ctx.lineWidth = Math.max(1.5, tile * 0.07);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + inset + pad, y + inset + pad);
      ctx.lineTo(x + inset + s - pad, y + inset + s - pad);
      ctx.moveTo(x + inset + s - pad, y + inset + pad);
      ctx.lineTo(x + inset + pad, y + inset + s - pad);
      ctx.stroke();
    }

    /**
     * The warehouse keeper seen from directly above: hard hat, shoulders, arms
     * and boots. Drawn facing "up" in a local frame and rotated to the facing
     * direction. pose.phase (0 -> 1 -> 0 over a step) drives the walk cycle
     * or, when pose.push is set, the push pose.
     */
    function drawPlayer(x, y, pose) {
      const t = tile;
      const { phase, parity, push, shove = 0, strain = 0, jitter = 0 } = pose;
      const swing = push ? 0 : phase * (parity ? 1 : -1);
      const angle = Math.atan2(facing.dx, -facing.dy);

      ctx.save();
      ctx.translate(x + t / 2, y + t / 2);
      ctx.rotate(angle);

      // Ground shadow
      ctx.beginPath();
      ctx.ellipse(0, t * 0.05, t * 0.30, t * 0.25, 0, 0, TAU);
      ctx.fillStyle = 'rgba(15, 25, 35, 0.28)';
      ctx.fill();

      // Lean into the crate while pushing (more while straining, with a tremble);
      // tiny bob while walking
      ctx.translate(jitter * strain * t * 0.02, -shove * t * 0.06 - strain * t * 0.03 - Math.abs(swing) * t * 0.015);

      // Boots. Walking: alternate forward/back. Pushing: back foot digs in.
      const footY = t * 0.07;
      const stride = swing * t * 0.14;
      let leftY = footY - stride, rightY = footY + stride;
      if (push) { const dig = (shove * 0.13 + strain * 0.06) * t; if (parity) leftY += dig; else rightY += dig; }
      drawBoot(-t * 0.13, leftY, t);
      drawBoot(t * 0.13, rightY, t);

      // Shoulders / torso
      ctx.beginPath();
      ctx.ellipse(0, t * 0.02, t * 0.30, t * 0.21, 0, 0, TAU);
      ctx.fillStyle = C.shirt;
      ctx.fill();
      ctx.lineWidth = Math.max(1, t * 0.035);
      ctx.strokeStyle = C.shirtDark;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, t * 0.02, t * 0.26, t * 0.17, 0, Math.PI * 1.15, Math.PI * 1.85);
      ctx.lineWidth = Math.max(1, t * 0.04);
      ctx.strokeStyle = C.shirtLight;
      ctx.globalAlpha = 0.55;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Arms and gloves
      const shoulderX = t * 0.25, shoulderY = 0;
      const handBaseY = -t * 0.17;
      const handX = t * (0.26 - shove * 0.09 - strain * 0.02);
      const leftHandY = handBaseY + swing * t * 0.09 - shove * t * 0.25;
      const rightHandY = handBaseY - swing * t * 0.09 - shove * t * 0.25;
      ctx.lineCap = 'round';
      for (const [sx, hx, hy] of [[-shoulderX, -handX, leftHandY], [shoulderX, handX, rightHandY]]) {
        ctx.beginPath();
        ctx.moveTo(sx, shoulderY);
        ctx.lineTo(hx, hy);
        ctx.lineWidth = Math.max(2, t * 0.14);
        ctx.strokeStyle = C.shirtDark;
        ctx.stroke();
        ctx.lineWidth = Math.max(1, t * 0.09);
        ctx.strokeStyle = C.shirt;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hx, hy, t * 0.075, 0, TAU);
        ctx.fillStyle = C.glove;
        ctx.fill();
        ctx.lineWidth = Math.max(1, t * 0.025);
        ctx.strokeStyle = C.gloveDark;
        ctx.stroke();
      }

      // Hard hat
      const headY = -t * 0.03, headR = t * 0.19;
      ctx.beginPath();
      ctx.arc(0, headY, headR, 0, TAU);
      ctx.fillStyle = C.hat;
      ctx.fill();
      ctx.lineWidth = Math.max(1, t * 0.03);
      ctx.strokeStyle = C.hatRim;
      ctx.stroke();
      ctx.fillStyle = C.hat;
      ctx.strokeStyle = C.hatRim;
      roundRect(-t * 0.15, headY - headR - t * 0.06, t * 0.30, t * 0.09, t * 0.03);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, headY - headR * 0.8);
      ctx.lineTo(0, headY + headR * 0.75);
      ctx.lineWidth = Math.max(1.5, t * 0.05);
      ctx.strokeStyle = C.hatRidge;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, headY - headR * 0.8);
      ctx.lineTo(0, headY + headR * 0.75);
      ctx.lineWidth = Math.max(0.75, t * 0.015);
      ctx.strokeStyle = C.hatRim;
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Effort: a couple of sweat drops fly off while straining
      if (strain > 0.3) {
        const k = (strain - 0.3) / 0.7;
        ctx.fillStyle = C.goalLight;
        for (const side of [-1, 1]) {
          const dx = side * (t * 0.24 + k * t * 0.07), dy = headY - t * 0.05 - k * t * 0.05;
          ctx.beginPath();
          ctx.ellipse(dx, dy, t * 0.03, t * 0.045, side * 0.5, 0, TAU);
          ctx.fill();
        }
      }

      ctx.restore();
    }

    function drawBoot(x, y, t) {
      ctx.beginPath();
      ctx.ellipse(x, y, t * 0.085, t * 0.12, 0, 0, TAU);
      ctx.fillStyle = C.shoe;
      ctx.fill();
    }

    return { id: 'flat', layout, render, cellAt };
  };
})();
