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
  const STORAGE_VIEW     = 'sokoban2.view.v1';       // 'flat' | 'depth'
  const STORAGE_ASK_VIEW = 'sokoban2.askView.v1';    // false once "don't ask again" is ticked

  const ANIM_MS   = 110;  // one walking step
  const PUSH_MS   = 320;  // one pushing step: strain first, then the shove
  const PUSH_STRAIN = 0.4; // first 40% of a push: the keeper braces and the crate only shivers
  const WALK_MS   = 110;  // per step when auto-walking

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
    face:         '#EAC4A3',
    faceEdge:     '#B98B6C',
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
    pendingDir = null;
    startAnim({ x: px, y: py }, game.player, boxFrom, boxTo, { strain: false });
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
    pendingDir = null;
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
    if (anim && anim.strain) { walkTimer = setTimeout(walkTick, 40); return; }
    const dir = walkQueue.shift();
    if (!dir) return;
    if (!step(dir)) { cancelWalk(); return; }
    if (walkQueue.length) walkTimer = setTimeout(walkTick, WALK_MS);
  }

  // ---------------------------------------------------------------------------
  // Rendering. The drawing itself lives in js/view2d.js (classic top-down) and
  // js/view25d.js (2.5D tilted top-down); both expose layout / render / cellAt.
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const boardWrap = document.getElementById('board-wrap');

  const VIEWS = {
    flat:  window.SokobanViews.flat(ctx, C),
    depth: window.SokobanViews.depth(ctx, C),
  };
  const VIEW_LABELS = { flat: '2D', depth: '2.5D' };
  let view = VIEWS.flat;
  let anim = null;     // { start, dur, pFrom, pTo, bFrom, bTo, push, parity }
  let facing = DIRS.down;
  let rafPending = false;

  function setView(id) {
    if (!VIEWS[id]) return;
    view = VIEWS[id];
    saveJSON(STORAGE_VIEW, id);
    document.body.dataset.view = id;
    updateViewButton();
    resize();
  }

  function toggleView() {
    setView(view.id === 'flat' ? 'depth' : 'flat');
  }

  function resize() {
    if (!game.level) return;
    const cs = getComputedStyle(boardWrap);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const availW = Math.max(0, boardWrap.clientWidth - padX);
    const availH = Math.max(0, boardWrap.clientHeight - padY);
    const L = game.level;
    const { cssW, cssH } = view.layout(L.width, L.height, availW, availH);

    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    requestRender();
  }

  let stepParity = 0;   // alternates each step so the feet take turns

  function startAnim(pFrom, pTo, bFrom, bTo, { strain = true } = {}) {
    stepParity ^= 1;
    const push = !!(bFrom && bTo);
    anim = {
      start: performance.now(),
      dur: push && strain ? PUSH_MS : ANIM_MS,
      pFrom, pTo: { ...pTo }, bFrom, bTo,
      push,
      strain: push && strain,
      parity: stepParity,
    };
    requestRender();
  }

  // A move requested while a shove is still playing waits for it to finish, so a
  // held key gives a steady strain-push rhythm instead of skipping the animation.
  let pendingDir = null;

  function requestStep(dir) {
    if (anim && anim.strain) { pendingDir = dir; return; }
    step(dir);
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
    if (anim) { requestRender(); return; }
    if (pendingDir) { const d = pendingDir; pendingDir = null; step(d); }
  }

  function easeOut(t) { return 1 - (1 - t) * (1 - t); }

  /** Build the interpolated scene for this frame and hand it to the active view. */
  function render(t = 1) {
    const L = game.level;
    if (!L) return;
    const e = easeOut(t);

    // pose: phase = walk cycle (0 -> 1 -> 0), shove = how far the arms reach,
    // strain = effort (tremble, extra lean, sweat), jitter = signed tremble wave.
    let player = { x: game.player.x, y: game.player.y };
    let pose = { phase: 0, parity: 0, push: false, shove: 0, strain: 0, jitter: 0 };
    let movingBox = null;
    if (anim) {
      let move = e, nudge = 0;
      if (anim.strain) {
        const S = PUSH_STRAIN;
        move = t < S ? 0 : easeOut((t - S) / (1 - S));
        const shove = t < S * 0.5 ? t / (S * 0.5) : (t > 0.85 ? (1 - t) / 0.15 : 1);
        const strain = t < S ? Math.min(1, t / (S * 0.5)) : Math.max(0, 1 - (t - S) / 0.12);
        const jitter = Math.sin(t * 40);
        pose = { phase: 0, parity: anim.parity, push: true, shove, strain, jitter };
        nudge = strain * 0.05 * (0.5 + 0.5 * jitter);       // the crate shivers before it gives
      } else if (anim.push) {
        pose = { phase: 0, parity: anim.parity, push: true, shove: Math.sin(Math.PI * t), strain: 0, jitter: 0 };
      } else {
        pose = { phase: Math.sin(Math.PI * t), parity: anim.parity, push: false, shove: 0, strain: 0, jitter: 0 };
      }
      player = {
        x: anim.pFrom.x + (anim.pTo.x - anim.pFrom.x) * move,
        y: anim.pFrom.y + (anim.pTo.y - anim.pFrom.y) * move,
      };
      if (anim.push) {
        const ddx = anim.bTo.x - anim.bFrom.x, ddy = anim.bTo.y - anim.bFrom.y;
        movingBox = {
          x: anim.bFrom.x + ddx * (move + nudge),
          y: anim.bFrom.y + ddy * (move + nudge),
          to: anim.bTo,
        };
      }
    }
    view.render({ level: L, boxes: game.boxes, player, movingBox, facing, pose });
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

  function updateViewButton() {
    const b = $('btn-view');
    b.textContent = 'View: ' + VIEW_LABELS[view.id];
    b.title = `Switch to ${VIEW_LABELS[view.id === 'flat' ? 'depth' : 'flat']} view (V)`;
  }

  function showStartChooser() {
    showModal($('modal-start'), $('pick-' + view.id));
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
      requestStep(DIRS[dirName]);
      return;
    }

    switch (e.key) {
      case 'z': case 'Z': case 'u': case 'U': case 'Backspace': e.preventDefault(); undo(); break;
      case 'y': case 'Y': e.preventDefault(); redo(); break;
      case 'r': case 'R': e.preventDefault(); restart(); break;
      case 'n': case 'N': case ']': e.preventDefault(); nextLevel(); break;
      case 'p': case 'P': case '[': e.preventDefault(); prevLevel(); break;
      case 'l': case 'L': e.preventDefault(); showLevels(); break;
      case 'v': case 'V': e.preventDefault(); toggleView(); break;
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
      const cell = view.cellAt(e.clientX - rect.left, e.clientY - rect.top);
      if (!isWall(cell.x, cell.y)) walkTo(cell);
      return;
    }
    cancelWalk();
    if (Math.abs(dx) > Math.abs(dy)) requestStep(dx > 0 ? DIRS.right : DIRS.left);
    else requestStep(dy > 0 ? DIRS.down : DIRS.up);
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
  $('btn-view').addEventListener('click', toggleView);
  $('btn-ask-view').addEventListener('click', () => {
    saveJSON(STORAGE_ASK_VIEW, true);
    closeModal();
    showStartChooser();
  });
  document.querySelectorAll('[data-pick-view]').forEach(b => b.addEventListener('click', () => {
    const remember = $('start-remember').checked;
    saveJSON(STORAGE_ASK_VIEW, !remember);
    closeModal();
    setView(b.dataset.pickView);
  }));
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
    let savedView = loadJSON(STORAGE_VIEW, 'flat');
    if (savedView === 'iso') savedView = 'depth';   // the 2.5D view used to be isometric
    view = VIEWS[savedView] || VIEWS.flat;
    document.body.dataset.view = view.id;
    updateViewButton();
    loadLevel(si, li);
    if (loadJSON(STORAGE_ASK_VIEW, true) !== false) showStartChooser();
    else canvas.focus({ preventScroll: true });
  }

  boot();
})();
