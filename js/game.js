/* Sokoban - game engine, renderer and UI. Plain ES2020, no dependencies. */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const DIRS = {
    up:    { dx: 0,  dy: -1 },
    down:  { dx: 0,  dy: 1 },
    left:  { dx: -1, dy: 0 },
    right: { dx: 1,  dy: 0 },
  };
  const DIR_LIST = Object.values(DIRS);

  const STORAGE_PROGRESS = 'sokoban2.progress.v1';
  const STORAGE_CURRENT  = 'sokoban2.current.v1';

  const ANIM_MS   = 110;  // one walking step
  const PUSH_MS   = 150;  // one pushing step (a little heavier)
  const WALK_MS   = 110;  // per step when auto-walking
  const MAX_TILE  = 72;
  const MIN_TILE  = 12;

  const C = {
    outside:      '#0F1923',
    floor:        '#E2E8F0',
    floorEdge:    '#CBD5E1',
    wall:         '#1B2A4A',
    wallLight:    '#2E4470',
    mortar:       '#0B131C',
    goal:         '#0891B2',
    goalLight:    '#06B6D4',
    box:          '#D97706',
    boxDark:      '#92400E',
    boxLight:     '#F59E0B',
    boxDone:      '#059669',
    boxDoneDark:  '#065F46',
    boxDoneLight: '#34D399',
    shirt:        '#0E7490',
    shirtDark:    '#164E63',
    shirtLight:   '#22D3EE',
    hat:          '#F1F5F9',
    hatRim:       '#94A3B8',
    hatRidge:     '#FFFFFF',
    glove:        '#D4A373',
    gloveDark:    '#8B5E34',
    shoe:         '#1E293B',
  };

  // ---------------------------------------------------------------------------
  // Level parsing
  // ---------------------------------------------------------------------------
  function parseLevel(text) {
    const rows = text.replace(/\r/g, '').split('\n');
    const height = rows.length;
    const width = Math.max(...rows.map(r => r.length));
    const walls = [], goals = [];
    const boxes = [];
    let player = null;

    for (let y = 0; y < height; y++) {
      walls.push(new Array(width).fill(false));
      goals.push(new Array(width).fill(false));
      for (let x = 0; x < width; x++) {
        const ch = rows[y][x] || ' ';
        switch (ch) {
          case '#': walls[y][x] = true; break;
          case '.': goals[y][x] = true; break;
          case '$': boxes.push({ x, y }); break;
          case '*': goals[y][x] = true; boxes.push({ x, y }); break;
          case '@': player = { x, y }; break;
          case '+': goals[y][x] = true; player = { x, y }; break;
          default: break; // ' ', '-', '_' are floor
        }
      }
    }
    if (!player) throw new Error('Level has no player');

    // Flood-fill from the player to find the reachable interior; everything
    // else is "outside" and drawn as background.
    const floor = walls.map(row => row.map(() => false));
    const stack = [player];
    floor[player.y][player.x] = true;
    while (stack.length) {
      const { x, y } = stack.pop();
      for (const d of DIR_LIST) {
        const nx = x + d.dx, ny = y + d.dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (walls[ny][nx] || floor[ny][nx]) continue;
        floor[ny][nx] = true;
        stack.push({ x: nx, y: ny });
      }
    }

    return { width, height, walls, goals, floor, boxes, player };
  }

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------
  const SETS = (window.SOKOBAN_LEVEL_SETS || []).map(s => ({
    ...s,
    parsed: s.levels.map(parseLevel),
  }));

  const game = {
    setIndex: 0,
    levelIndex: 0,
    level: null,       // static parsed level
    boxes: null,       // 2D boolean grid
    player: null,      // {x, y}
    moves: 0,
    pushes: 0,
    history: [],       // [{dx, dy, pushed}]
    redoStack: [],
    solved: false,
  };

  let progress = loadJSON(STORAGE_PROGRESS, {});

  function loadJSON(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode etc. */ }
  }

  function currentSet() { return SETS[game.setIndex]; }
  function bestFor(setIndex, levelIndex) {
    const s = progress[SETS[setIndex].id];
    return s ? s[levelIndex] || null : null;
  }

  function groupName(set, levelIndex) {
    if (!set.groups) return set.name;
    let acc = 0;
    for (const g of set.groups) {
      acc += g.count;
      if (levelIndex < acc) return g.name;
    }
    return set.name;
  }

  function loadLevel(setIndex, levelIndex) {
    const set = SETS[setIndex];
    if (!set || !set.parsed[levelIndex]) return false;
    cancelWalk();
    anim = null;

    game.setIndex = setIndex;
    game.levelIndex = levelIndex;
    game.level = set.parsed[levelIndex];
    game.boxes = game.level.walls.map(r => r.map(() => false));
    for (const b of game.level.boxes) game.boxes[b.y][b.x] = true;
    game.player = { ...game.level.player };
    game.moves = 0;
    game.pushes = 0;
    game.history = [];
    game.redoStack = [];
    game.solved = false;
    facing = DIRS.down;

    saveJSON(STORAGE_CURRENT, { set: set.id, level: levelIndex });
    resize();
    updateHud();
    return true;
  }

  function isWall(x, y) {
    const L = game.level;
    return x < 0 || y < 0 || x >= L.width || y >= L.height || L.walls[y][x];
  }
  function isBox(x, y) {
    return !isWall(x, y) && game.boxes[y][x];
  }
  function isFree(x, y) {
    return !isWall(x, y) && !game.boxes[y][x];
  }

  function checkSolved() {
    const L = game.level;
    for (let y = 0; y < L.height; y++) {
      for (let x = 0; x < L.width; x++) {
        if (game.boxes[y][x] && !L.goals[y][x]) return false;
      }
    }
    return true;
  }

  /** Attempt one step. Returns true if the player moved. */
  function step(dir, { record = true, animate = true } = {}) {
    if (game.solved) return false;
    facing = dir;
    const px = game.player.x, py = game.player.y;
    const nx = px + dir.dx, ny = py + dir.dy;
    if (isWall(nx, ny)) return false;

    let pushed = false;
    let boxFrom = null, boxTo = null;
    if (game.boxes[ny][nx]) {
      const bx = nx + dir.dx, by = ny + dir.dy;
      if (!isFree(bx, by)) return false;
      game.boxes[ny][nx] = false;
      game.boxes[by][bx] = true;
      pushed = true;
      boxFrom = { x: nx, y: ny };
      boxTo = { x: bx, y: by };
    }

    game.player = { x: nx, y: ny };
    game.moves++;
    if (pushed) game.pushes++;
    if (record) {
      game.history.push({ dx: dir.dx, dy: dir.dy, pushed });
      game.redoStack.length = 0;
    }

    if (animate) startAnim({ x: px, y: py }, game.player, boxFrom, boxTo);
    else requestRender();

    if (checkSolved()) onSolved();
    updateHud();
    return true;
  }

  function undo() {
    cancelWalk();
    const m = game.history.pop();
    if (!m) return false;
    game.redoStack.push(m);
    game.solved = false;

    const px = game.player.x, py = game.player.y;
    const bx = px - m.dx, by = py - m.dy;   // where the player came from
    let boxFrom = null, boxTo = null;
    if (m.pushed) {
      const cx = px + m.dx, cy = py + m.dy; // where the box went
      game.boxes[cy][cx] = false;
      game.boxes[py][px] = true;
      boxFrom = { x: cx, y: cy };
      boxTo = { x: px, y: py };
      game.pushes--;
    }
    game.player = { x: bx, y: by };
    game.moves--;
    facing = { dx: m.dx, dy: m.dy };
    startAnim({ x: px, y: py }, game.player, boxFrom, boxTo);
    updateHud();
    return true;
  }

  function redo() {
    cancelWalk();
    const m = game.redoStack.pop();
    if (!m) return false;
    const dir = { dx: m.dx, dy: m.dy };
    const ok = step(dir, { record: false });
    if (ok) game.history.push(m);
    else game.redoStack.push(m);
    return ok;
  }

  function restart() {
    loadLevel(game.setIndex, game.levelIndex);
    requestRender();
  }

  function onSolved() {
    game.solved = true;
    const set = currentSet();
    const prev = bestFor(game.setIndex, game.levelIndex);
    const isRecord = !prev || game.moves < prev.moves ||
      (game.moves === prev.moves && game.pushes < prev.pushes);
    if (isRecord) {
      progress[set.id] = progress[set.id] || {};
      progress[set.id][game.levelIndex] = { moves: game.moves, pushes: game.pushes };
      saveJSON(STORAGE_PROGRESS, progress);
    }
    setTimeout(() => showWin(prev, isRecord), PUSH_MS + 160);
  }

  // ---------------------------------------------------------------------------
  // Auto-walk (click a floor tile)
  // ---------------------------------------------------------------------------
  let walkQueue = [];
  let walkTimer = null;

  function cancelWalk() {
    walkQueue = [];
    if (walkTimer) { clearTimeout(walkTimer); walkTimer = null; }
  }

  function findPath(target) {
    const L = game.level;
    const start = game.player;
    if (target.x === start.x && target.y === start.y) return [];
    if (!isFree(target.x, target.y) || !L.floor[target.y][target.x]) return null;

    const key = (x, y) => y * L.width + x;
    const prev = new Map();
    const queue = [start];
    prev.set(key(start.x, start.y), null);

    while (queue.length) {
      const cur = queue.shift();
      if (cur.x === target.x && cur.y === target.y) break;
      for (const d of DIR_LIST) {
        const nx = cur.x + d.dx, ny = cur.y + d.dy;
        if (!isFree(nx, ny)) continue;
        const k = key(nx, ny);
        if (prev.has(k)) continue;
        prev.set(k, { x: cur.x, y: cur.y, dir: d });
        queue.push({ x: nx, y: ny });
      }
    }

    if (!prev.has(key(target.x, target.y))) return null;
    const path = [];
    let cur = target;
    while (true) {
      const p = prev.get(key(cur.x, cur.y));
      if (!p) break;
      path.unshift(p.dir);
      cur = p;
    }
    return path;
  }

  function walkTo(target) {
    cancelWalk();
    const path = findPath(target);
    if (!path) {
      // Convenience: clicking a box next to the player pushes it.
      const dx = target.x - game.player.x, dy = target.y - game.player.y;
      if (Math.abs(dx) + Math.abs(dy) === 1 && isBox(target.x, target.y)) {
        step({ dx, dy });
      }
      return;
    }
    walkQueue = path;
    walkTick();
  }

  function walkTick() {
    walkTimer = null;
    const dir = walkQueue.shift();
    if (!dir) return;
    if (!step(dir)) { cancelWalk(); return; }
    if (walkQueue.length) walkTimer = setTimeout(walkTick, WALK_MS);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const boardWrap = document.getElementById('board-wrap');

  let tile = 40;
  let anim = null;     // { start, pFrom, pTo, bFrom, bTo }
  let facing = DIRS.down;
  let rafPending = false;

  function resize() {
    if (!game.level) return;
    const cs = getComputedStyle(boardWrap);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const availW = Math.max(0, boardWrap.clientWidth - padX);
    const availH = Math.max(0, boardWrap.clientHeight - padY);
    const L = game.level;
    tile = Math.floor(Math.min(availW / L.width, availH / L.height));
    tile = Math.max(MIN_TILE, Math.min(MAX_TILE, tile));

    const cssW = tile * L.width, cssH = tile * L.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    requestRender();
  }

  let stepParity = 0;   // alternates each step so the feet take turns

  function startAnim(pFrom, pTo, bFrom, bTo) {
    stepParity ^= 1;
    const push = !!(bFrom && bTo);
    anim = {
      start: performance.now(),
      dur: push ? PUSH_MS : ANIM_MS,
      pFrom, pTo: { ...pTo }, bFrom, bTo,
      push,
      parity: stepParity,
    };
    requestRender();
  }

  function requestRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(frame);
  }

  function frame(now) {
    rafPending = false;
    let t = 1;
    if (anim) {
      t = Math.min(1, (now - anim.start) / anim.dur);
      if (t >= 1) anim = null;
    }
    render(t);
    if (anim) requestRender();
  }

  function easeOut(t) { return 1 - (1 - t) * (1 - t); }

  function render(t = 1) {
    const L = game.level;
    if (!L) return;
    const w = tile * L.width, h = tile * L.height;
    ctx.clearRect(0, 0, w, h);

    const e = easeOut(t);
    const animBoxTo = anim ? anim.bTo : null;

    // Static layer + boxes
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
    for (let y = 0; y < L.height; y++) {
      for (let x = 0; x < L.width; x++) {
        if (!game.boxes[y][x]) continue;
        if (animBoxTo && animBoxTo.x === x && animBoxTo.y === y) continue; // drawn animated below
        drawBox(x * tile, y * tile, L.goals[y][x]);
      }
    }

    // Animated box
    if (anim && anim.bFrom && anim.bTo) {
      const bx = anim.bFrom.x + (anim.bTo.x - anim.bFrom.x) * e;
      const by = anim.bFrom.y + (anim.bTo.y - anim.bFrom.y) * e;
      drawBox(bx * tile, by * tile, L.goals[anim.bTo.y][anim.bTo.x]);
    }

    // Player. `phase` rises and falls over one step (0 -> 1 -> 0) and drives
    // the walk cycle and the push pose; it is 0 whenever the keeper is idle.
    let ppx = game.player.x, ppy = game.player.y;
    let pose = { phase: 0, parity: 0, push: false };
    if (anim) {
      ppx = anim.pFrom.x + (anim.pTo.x - anim.pFrom.x) * e;
      ppy = anim.pFrom.y + (anim.pTo.y - anim.pFrom.y) * e;
      pose = { phase: Math.sin(Math.PI * t), parity: anim.parity, push: anim.push };
    }
    drawPlayer(ppx * tile, ppy * tile, pose);
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
    ctx.arc(cx, cy, tile * 0.22, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.5, tile * 0.08);
    ctx.strokeStyle = C.goal;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, tile * 0.07, 0, Math.PI * 2);
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

    // Shadow
    ctx.fillStyle = 'rgba(15, 25, 35, 0.22)';
    roundRect(x + inset + 1.5, y + inset + 2.5, s, s, r);
    ctx.fill();

    // Body
    ctx.fillStyle = base;
    roundRect(x + inset, y + inset, s, s, r);
    ctx.fill();

    // Top bevel
    ctx.fillStyle = light;
    ctx.globalAlpha = 0.55;
    roundRect(x + inset, y + inset, s, s * 0.22, r);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Border
    ctx.lineWidth = Math.max(1.5, tile * 0.06);
    ctx.strokeStyle = dark;
    roundRect(x + inset, y + inset, s, s, r);
    ctx.stroke();

    // Cross bracing
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
   * The warehouse keeper, seen from directly above: hard hat, shoulders, arms
   * and boots. Drawn in a local frame facing "up" and rotated to the facing
   * direction. `pose.phase` (0..1..0 over a step) drives the walk cycle
   * (feet alternate, arms swing opposite) or, when `pose.push` is set, the
   * push pose (arms extended, body leaning, back foot planted).
   */
  function drawPlayer(x, y, pose) {
    const t = tile;
    const TAU = Math.PI * 2;
    const { phase, parity, push } = pose;
    const swing = push ? 0 : phase * (parity ? 1 : -1);
    const shove = push ? phase : 0;
    const angle = Math.atan2(facing.dx, -facing.dy);

    ctx.save();
    ctx.translate(x + t / 2, y + t / 2);
    ctx.rotate(angle);

    // Ground shadow
    ctx.beginPath();
    ctx.ellipse(0, t * 0.05, t * 0.30, t * 0.25, 0, 0, TAU);
    ctx.fillStyle = 'rgba(15, 25, 35, 0.28)';
    ctx.fill();

    // Lean into the crate while pushing; tiny bob while walking
    ctx.translate(0, -shove * t * 0.06 - Math.abs(swing) * t * 0.015);

    // Boots. Walking: alternate forward/back. Pushing: back foot digs in.
    const footY = t * 0.07;
    const stride = swing * t * 0.14;
    let leftY = footY - stride, rightY = footY + stride;
    if (push) { if (parity) leftY += shove * t * 0.13; else rightY += shove * t * 0.13; }
    drawBoot(-t * 0.13, leftY, t);
    drawBoot(t * 0.13, rightY, t);

    // Shoulders / torso (an ellipse from above)
    ctx.beginPath();
    ctx.ellipse(0, t * 0.02, t * 0.30, t * 0.21, 0, 0, TAU);
    ctx.fillStyle = C.shirt;
    ctx.fill();
    ctx.lineWidth = Math.max(1, t * 0.035);
    ctx.strokeStyle = C.shirtDark;
    ctx.stroke();
    // Collar highlight at the front of the shoulders
    ctx.beginPath();
    ctx.ellipse(0, t * 0.02, t * 0.26, t * 0.17, 0, Math.PI * 1.15, Math.PI * 1.85);
    ctx.lineWidth = Math.max(1, t * 0.04);
    ctx.strokeStyle = C.shirtLight;
    ctx.globalAlpha = 0.55;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Arms: from the shoulders forward to the hands. Hands swing opposite the
    // feet while walking and reach out (and inward) when pushing.
    const shoulderX = t * 0.25, shoulderY = 0;
    const handBaseY = -t * 0.17;
    const handX = t * (0.26 - shove * 0.09);
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
      // Glove
      ctx.beginPath();
      ctx.arc(hx, hy, t * 0.075, 0, TAU);
      ctx.fillStyle = C.glove;
      ctx.fill();
      ctx.lineWidth = Math.max(1, t * 0.025);
      ctx.strokeStyle = C.gloveDark;
      ctx.stroke();
    }

    // Hard hat (head from above), slightly forward of the torso centre
    const headY = -t * 0.03, headR = t * 0.19;
    ctx.beginPath();
    ctx.arc(0, headY, headR, 0, TAU);
    ctx.fillStyle = C.hat;
    ctx.fill();
    ctx.lineWidth = Math.max(1, t * 0.03);
    ctx.strokeStyle = C.hatRim;
    ctx.stroke();
    // Brim sticking out at the front
    ctx.fillStyle = C.hat;
    ctx.strokeStyle = C.hatRim;
    roundRect(-t * 0.15, headY - headR - t * 0.06, t * 0.30, t * 0.09, t * 0.03);
    ctx.fill();
    ctx.stroke();
    // Ridge running front-to-back over the crown
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

    ctx.restore();
  }

  function drawBoot(x, y, t) {
    ctx.beginPath();
    ctx.ellipse(x, y, t * 0.085, t * 0.12, 0, 0, Math.PI * 2);
    ctx.fillStyle = C.shoe;
    ctx.fill();
  }

  // ---------------------------------------------------------------------------
  // HUD & modals
  // ---------------------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const el = {
    level:   $('stat-level'),
    moves:   $('stat-moves'),
    pushes:  $('stat-pushes'),
    best:    $('stat-best'),
    undo:    $('btn-undo'),
    redo:    $('btn-redo'),
    prev:    $('btn-prev'),
    next:    $('btn-next'),
    modalLevels:  $('modal-levels'),
    modalWin:     $('modal-win'),
    modalHelp:    $('modal-help'),
    modalConfirm: $('modal-confirm'),
    levelGrid:    $('level-grid'),
    setSelect:    $('set-select'),
    setDesc:      $('set-description'),
    progressText: $('progress-text'),
    winSummary:   $('win-summary'),
    winBest:      $('win-best'),
    confirmTitle: $('confirm-title'),
    confirmText:  $('confirm-text'),
    confirmOk:    $('btn-confirm-ok'),
    confirmCancel:$('btn-confirm-cancel'),
  };

  function updateHud() {
    const set = currentSet();
    el.level.textContent = String(game.levelIndex + 1);
    el.level.title = `${set.name} - ${groupName(set, game.levelIndex)}`;
    el.moves.textContent = String(game.moves);
    el.pushes.textContent = String(game.pushes);
    const best = bestFor(game.setIndex, game.levelIndex);
    el.best.textContent = best ? `${best.moves}/${best.pushes}` : '–';
    el.best.title = best ? 'Best moves / pushes' : 'Not solved yet';
    el.undo.disabled = game.history.length === 0;
    el.redo.disabled = game.redoStack.length === 0;
    el.prev.disabled = game.levelIndex === 0;
    el.next.disabled = game.levelIndex >= set.parsed.length - 1;
    document.title = `Sokoban - Level ${game.levelIndex + 1}`;
  }

  let openModal = null;
  let onModalClose = null;   // called once when the open modal is dismissed by any route

  function showModal(backdrop, focusEl) {
    if (openModal) closeModal();
    openModal = backdrop;
    backdrop.hidden = false;
    const target = focusEl || backdrop.querySelector('.btn-accent, .btn');
    if (target) target.focus();
  }
  function closeModal() {
    if (!openModal) return;
    openModal.hidden = true;
    openModal = null;
    const cb = onModalClose;
    onModalClose = null;
    canvas.focus({ preventScroll: true });
    if (cb) cb();
  }

  function confirmDialog(title, text, okLabel = 'Confirm') {
    return new Promise(resolve => {
      el.confirmTitle.textContent = title;
      el.confirmText.textContent = text;
      el.confirmOk.textContent = okLabel;
      let result = false;
      el.confirmOk.onclick = () => { result = true; closeModal(); };
      el.confirmCancel.onclick = () => { result = false; closeModal(); };
      showModal(el.modalConfirm, el.confirmOk);
      onModalClose = () => {
        el.confirmOk.onclick = null;
        el.confirmCancel.onclick = null;
        resolve(result);
      };
    });
  }

  let toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  // Level picker ---------------------------------------------------------------
  let pickerSetIndex = 0;

  function buildSetSelect() {
    el.setSelect.innerHTML = '';
    SETS.forEach((s, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `${s.name} (${s.parsed.length})`;
      el.setSelect.appendChild(o);
    });
    el.setSelect.hidden = SETS.length <= 1;
  }

  function buildLevelGrid(setIndex) {
    pickerSetIndex = setIndex;
    el.setSelect.value = String(setIndex);
    const set = SETS[setIndex];
    el.setDesc.textContent = `${set.author ? 'By ' + set.author + '. ' : ''}${set.description || ''}`;
    el.levelGrid.innerHTML = '';
    let solved = 0;
    set.parsed.forEach((_, i) => {
      const best = bestFor(setIndex, i);
      const b = document.createElement('button');
      b.className = 'level-tile';
      if (best) { b.classList.add('solved'); solved++; }
      if (setIndex === game.setIndex && i === game.levelIndex) b.classList.add('current');
      b.title = groupName(set, i);
      b.innerHTML = `<span class="num">${i + 1}</span><span class="sub">${best ? best.moves + ' / ' + best.pushes : groupName(set, i)}</span>${best ? '<span class="check">✓</span>' : ''}`;
      b.addEventListener('click', () => {
        closeModal();
        loadLevel(setIndex, i);
      });
      el.levelGrid.appendChild(b);
    });
    el.progressText.textContent = `${solved} of ${set.parsed.length} solved`;
  }

  function showLevels() {
    buildLevelGrid(game.setIndex);
    const cur = el.levelGrid.querySelector('.current');
    showModal(el.modalLevels, cur || el.levelGrid.firstElementChild);
    if (cur) cur.scrollIntoView({ block: 'center' });
  }

  function showWin(prevBest, isRecord) {
    el.winSummary.textContent = `Level ${game.levelIndex + 1} in ${game.moves} moves and ${game.pushes} pushes.`;
    if (isRecord && prevBest) {
      el.winBest.textContent = `New personal best! Previous: ${prevBest.moves} moves / ${prevBest.pushes} pushes.`;
    } else if (isRecord) {
      el.winBest.textContent = 'First time solved - nice work.';
    } else {
      el.winBest.textContent = `Your best: ${prevBest.moves} moves / ${prevBest.pushes} pushes.`;
    }
    const hasNext = game.levelIndex < currentSet().parsed.length - 1;
    $('btn-win-next').hidden = !hasNext;
    showModal(el.modalWin, hasNext ? $('btn-win-next') : $('btn-win-replay'));
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  function nextLevel() {
    if (game.levelIndex < currentSet().parsed.length - 1) loadLevel(game.setIndex, game.levelIndex + 1);
    else toast('That was the last level of the set!');
  }
  function prevLevel() {
    if (game.levelIndex > 0) loadLevel(game.setIndex, game.levelIndex - 1);
  }

  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right',
  };

  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    if (openModal) {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
      else if (openModal === el.modalWin && (e.key === 'Enter' || e.key === ' ' || e.key === 'n' || e.key === 'N')) {
        e.preventDefault(); closeModal(); nextLevel();
      }
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) {
      // Ctrl+Z / Ctrl+Y as extra undo/redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); }
      return;
    }

    const dirName = KEYMAP[e.key];
    if (dirName) {
      e.preventDefault();
      cancelWalk();
      step(DIRS[dirName]);
      return;
    }

    switch (e.key) {
      case 'z': case 'Z': case 'u': case 'U': case 'Backspace': e.preventDefault(); undo(); break;
      case 'y': case 'Y': e.preventDefault(); redo(); break;
      case 'r': case 'R': e.preventDefault(); restart(); break;
      case 'n': case 'N': case ']': e.preventDefault(); nextLevel(); break;
      case 'p': case 'P': case '[': e.preventDefault(); prevLevel(); break;
      case 'l': case 'L': e.preventDefault(); showLevels(); break;
      case '?': case 'F1': e.preventDefault(); showModal(el.modalHelp); break;
      default: break;
    }
  });

  // Pointer: click to walk, swipe to move
  let pointerStart = null;
  canvas.addEventListener('pointerdown', e => {
    pointerStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already-released pointer */ }
    canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener('pointerup', e => {
    if (!pointerStart || pointerStart.id !== e.pointerId) return;
    const dx = e.clientX - pointerStart.x, dy = e.clientY - pointerStart.y;
    pointerStart = null;
    const dist = Math.hypot(dx, dy);
    if (dist < 14) {
      const rect = canvas.getBoundingClientRect();
      const cx = Math.floor((e.clientX - rect.left) / tile);
      const cy = Math.floor((e.clientY - rect.top) / tile);
      if (!isWall(cx, cy)) walkTo({ x: cx, y: cy });
      return;
    }
    cancelWalk();
    if (Math.abs(dx) > Math.abs(dy)) step(dx > 0 ? DIRS.right : DIRS.left);
    else step(dy > 0 ? DIRS.down : DIRS.up);
  });
  canvas.addEventListener('pointercancel', () => { pointerStart = null; });

  // Buttons
  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);
  $('btn-restart').addEventListener('click', () => { restart(); toast('Level restarted'); });
  $('btn-prev').addEventListener('click', prevLevel);
  $('btn-next').addEventListener('click', nextLevel);
  $('btn-levels').addEventListener('click', showLevels);
  $('btn-help').addEventListener('click', () => showModal(el.modalHelp));
  $('btn-win-next').addEventListener('click', () => { closeModal(); nextLevel(); });
  $('btn-win-replay').addEventListener('click', () => { closeModal(); restart(); });
  el.setSelect.addEventListener('change', () => buildLevelGrid(Number(el.setSelect.value)));

  $('btn-reset-progress').addEventListener('click', async () => {
    const set = SETS[pickerSetIndex];
    const ok = await confirmDialog(
      'Reset progress?',
      `This clears all solved marks and best scores for "${set.name}". This cannot be undone.`,
      'Reset'
    );
    if (!ok) { showModal(el.modalLevels); return; }
    delete progress[set.id];
    saveJSON(STORAGE_PROGRESS, progress);
    updateHud();
    buildLevelGrid(pickerSetIndex);
    showModal(el.modalLevels);
    toast('Progress reset');
  });

  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModal));
  document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('mousedown', e => { if (e.target === bd) closeModal(); });
  });

  // Blur buttons after click so Space/Enter don't re-trigger them while playing
  document.querySelectorAll('.toolbar .btn').forEach(b => b.addEventListener('click', () => b.blur()));

  new ResizeObserver(() => resize()).observe(boardWrap);
  window.addEventListener('resize', resize);

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function boot() {
    if (!SETS.length) {
      boardWrap.innerHTML = '<p style="color:#fff;padding:24px">No levels found. Run <code>node tools/fetch-levels.mjs</code> to download the level set.</p>';
      return;
    }
    buildSetSelect();
    const cur = loadJSON(STORAGE_CURRENT, null);
    let si = 0, li = 0;
    if (cur) {
      const idx = SETS.findIndex(s => s.id === cur.set);
      if (idx >= 0 && SETS[idx].parsed[cur.level]) { si = idx; li = cur.level; }
    }
    loadLevel(si, li);
    canvas.focus({ preventScroll: true });
  }

  boot();
})();
