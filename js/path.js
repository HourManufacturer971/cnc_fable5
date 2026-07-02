'use strict';
// path.js — A* pathfinding on the 64x64 grid. Defines one global: findPath.
// 8-directional, no corner cutting. Cells occupied by other UNITS are passable
// at a penalty (sim resolves live collisions); buildings and bad terrain block.

const findPath = (function () {
  const N = C.MAP_W * C.MAP_H;
  const gCost = new Float64Array(N);
  const fCost = new Float64Array(N);
  const from = new Int32Array(N);
  const state = new Int32Array(N);   // generation-tagged: gen*2 = open, gen*2+1 = closed
  let gen = 0;

  // binary min-heap of cell indices keyed by fCost
  const heap = new Int32Array(N);
  let heapLen = 0;

  function heapPush(i) {
    let c = heapLen++;
    heap[c] = i;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (fCost[heap[p]] <= fCost[heap[c]]) break;
      const t = heap[p]; heap[p] = heap[c]; heap[c] = t;
      c = p;
    }
  }
  function heapPop() {
    const top = heap[0];
    heap[0] = heap[--heapLen];
    let c = 0;
    for (;;) {
      const l = c * 2 + 1, r = l + 1;
      let m = c;
      if (l < heapLen && fCost[heap[l]] < fCost[heap[m]]) m = l;
      if (r < heapLen && fCost[heap[r]] < fCost[heap[m]]) m = r;
      if (m === c) break;
      const t = heap[m]; heap[m] = heap[c]; heap[c] = t;
      c = m;
    }
    return top;
  }

  const BLOCK = 0, FREE = 1, SOFT = 2;
  function cellState(cx, cy, unit) {
    if (!inMap(cx, cy)) return BLOCK;
    const i = cellIdx(cx, cy);
    if (!terrainPassable(game.terrain[i])) return BLOCK;
    const o = game.occ[i];
    if (!o || (unit && o === unit.id)) return FREE;
    const e = getEnt(o);
    if (e && e.kind === 'unit') return SOFT;
    return BLOCK;
  }

  function octile(ax, ay, bx, by) {
    const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    return dx > dy ? 10 * dx + 4 * dy : 10 * dy + 4 * dx;
  }

  // findPath(unit, destCx, destCy, opts?) -> [{cx,cy},...] excluding start; [] if none
  return function findPath(unit, destCx, destCy, opts) {
    opts = opts || {};
    const maxNodes = opts.maxNodes || 4000;
    const range = opts.range || 0;
    const scx = worldToCell(unit.x), scy = worldToCell(unit.y);
    let dcx = clamp(destCx | 0, 0, C.MAP_W - 1), dcy = clamp(destCy | 0, 0, C.MAP_H - 1);

    // unusable destination with no range: retarget to nearest passable cell
    if (!range && cellState(dcx, dcy, unit) === BLOCK) {
      let best = -1, bestD = Infinity;
      for (let r = 1; r <= 6 && best < 0; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = dcx + dx, cy = dcy + dy;
          if (cellState(cx, cy, unit) === BLOCK) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = cellIdx(cx, cy); }
        }
      }
      if (best >= 0) { dcx = best % C.MAP_W; dcy = (best / C.MAP_W) | 0; }
    }

    if (scx === dcx && scy === dcy) return [];
    const rangeSq = range > 0 ? range * range : -1;
    function atGoal(cx, cy) {
      if (rangeSq < 0) return cx === dcx && cy === dcy;
      const dx = cx - dcx, dy = cy - dcy;
      return dx * dx + dy * dy <= rangeSq;
    }

    gen++;
    const openTag = gen * 2, closedTag = gen * 2 + 1;
    heapLen = 0;
    const si = cellIdx(scx, scy);
    gCost[si] = 0;
    fCost[si] = octile(scx, scy, dcx, dcy);
    from[si] = -1;
    state[si] = openTag;
    heapPush(si);

    let bestI = si, bestH = octile(scx, scy, dcx, dcy);
    let expanded = 0, goal = -1;

    while (heapLen > 0 && expanded < maxNodes) {
      const cur = heapPop();
      if (state[cur] === closedTag) continue;
      state[cur] = closedTag;
      expanded++;
      const cx = cur % C.MAP_W, cy = (cur / C.MAP_W) | 0;
      if (atGoal(cx, cy)) { goal = cur; break; }
      const h = octile(cx, cy, dcx, dcy);
      if (h < bestH) { bestH = h; bestI = cur; }

      for (let d = 0; d < 8; d++) {
        const dx = [0, 1, 1, 1, 0, -1, -1, -1][d];
        const dy = [-1, -1, 0, 1, 1, 1, 0, -1][d];
        const nx = cx + dx, ny = cy + dy;
        const st = cellState(nx, ny, unit);
        if (st === BLOCK) continue;
        // no corner cutting: both orthogonal neighbors of a diagonal must be non-blocked
        if (dx && dy) {
          if (cellState(cx + dx, cy, unit) === BLOCK) continue;
          if (cellState(cx, cy + dy, unit) === BLOCK) continue;
        }
        const ni = cellIdx(nx, ny);
        if (state[ni] === closedTag) continue;
        const step = (dx && dy ? 14 : 10) + (st === SOFT ? 80 : 0);
        const ng = gCost[cur] + step;
        if (state[ni] !== openTag || ng < gCost[ni]) {
          gCost[ni] = ng;
          fCost[ni] = ng + octile(nx, ny, dcx, dcy);
          from[ni] = cur;
          state[ni] = openTag;
          heapPush(ni); // lazy decrease-key: duplicates skipped via closed check
        }
      }
    }

    const end = goal >= 0 ? goal : bestI;
    if (end === si) return [];
    const path = [];
    for (let i = end; i !== si && i >= 0; i = from[i]) {
      path.push({ cx: i % C.MAP_W, cy: (i / C.MAP_W) | 0 });
    }
    path.reverse();
    return path;
  };
})();
