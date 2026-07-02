'use strict';
// map.js — deterministic 64x64 skirmish map generation.
// Defines exactly one global: MAPGEN. See SPEC.md "Map generation".
//
// MAPGEN.generate(game, seed):
//   - fills game.terrain / game.tvar / game.tib
//   - sets game.startPos = { human:{cx,cy}, ai:{cx,cy} }
// All randomness comes from a local mulberry(seed) stream so the same seed
// always produces the same map regardless of prior game.rng() consumption.

const MAPGEN = (function () {

  // terrain ids (see SPEC): 0 grass, 1 dirt, 2 rock, 3 water, 4 tree, 5 blossom
  const T_GRASS = 0, T_DIRT = 1, T_ROCK = 2, T_WATER = 3, T_TREE = 4, T_BLOSSOM = 5;

  function isImpassId(t) { return t === T_ROCK || t === T_WATER || t === T_TREE || t === T_BLOSSOM; }

  function distC(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ---- feature painters ------------------------------------------------------

  // Blobby dirt patch via a random walk with a 3x3 brush.
  function dirtWalk(g, rng) {
    const W = C.MAP_W, H = C.MAP_H;
    let x = 2 + ((rng() * (W - 4)) | 0);
    let y = 2 + ((rng() * (H - 4)) | 0);
    const len = 30 + ((rng() * 50) | 0);
    for (let i = 0; i < len; i++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const px = x + dx, py = y + dy;
          if (!inMap(px, py)) continue;
          const idx = cellIdx(px, py);
          if (g.terrain[idx] === T_GRASS) g.terrain[idx] = T_DIRT;
        }
      }
      x = clamp(x + (((rng() * 3) | 0) - 1), 1, W - 2);
      y = clamp(y + (((rng() * 3) | 0) - 1), 1, H - 2);
    }
  }

  // Roundish blob of terrain id `tid` centered on (cx,cy) with radius ~r.
  function blob(g, rng, cx, cy, r, tid) {
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const px = cx + dx, py = cy + dy;
        if (px < 1 || py < 1 || px >= C.MAP_W - 1 || py >= C.MAP_H - 1) continue;
        const d = Math.sqrt(dx * dx + dy * dy) + rng() * 0.9;
        if (d <= r) g.terrain[cellIdx(px, py)] = tid;
      }
    }
  }

  // Cluster of 3..8 tree cells around (cx,cy), only over grass/dirt.
  function treeClump(g, rng, cx, cy) {
    let want = 3 + ((rng() * 6) | 0); // 3..8
    // Always try the center first, then random offsets within radius 2.
    let tries = want * 5;
    let px = cx, py = cy;
    while (want > 0 && tries-- > 0) {
      if (px >= 1 && py >= 1 && px < C.MAP_W - 1 && py < C.MAP_H - 1) {
        const idx = cellIdx(px, py);
        if (g.terrain[idx] === T_GRASS || g.terrain[idx] === T_DIRT) {
          g.terrain[idx] = T_TREE;
          want--;
        }
      }
      px = cx + (((rng() * 5) | 0) - 2);
      py = cy + (((rng() * 5) | 0) - 2);
    }
  }

  // Pick a blob/clump center at least `minD` cells from both starts.
  function pickCenter(rng, starts, minD) {
    let x = 0, y = 0;
    for (let a = 0; a < 40; a++) {
      x = 3 + ((rng() * (C.MAP_W - 6)) | 0);
      y = 3 + ((rng() * (C.MAP_H - 6)) | 0);
      if (distC(x, y, starts[0].cx, starts[0].cy) > minD &&
          distC(x, y, starts[1].cx, starts[1].cy) > minD) return { x, y };
    }
    return { x, y }; // give up on the constraint; the clear pass will fix spill
  }

  // ---- constraint passes -----------------------------------------------------

  // Reset any impassable terrain within `rad` (euclidean) of (cx,cy) to grass.
  // Never touches the 1-cell border ring.
  function clearZone(g, cx, cy, rad) {
    const R = Math.ceil(rad);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > rad * rad) continue;
        const px = cx + dx, py = cy + dy;
        if (px < 1 || py < 1 || px >= C.MAP_W - 1 || py >= C.MAP_H - 1) continue;
        const idx = cellIdx(px, py);
        if (isImpassId(g.terrain[idx])) g.terrain[idx] = T_GRASS;
      }
    }
  }

  // Carve a passable corridor along the segment between the two starts.
  // Square brush of Chebyshev radius `rad` => corridor width 2*rad+1 (>=3).
  function carveCorridor(g, a, b, rad) {
    const steps = Math.max(1, Math.ceil(distC(a.cx, a.cy, b.cx, b.cy)) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = Math.round(a.cx + (b.cx - a.cx) * t);
      const py = Math.round(a.cy + (b.cy - a.cy) * t);
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const x = px + dx, y = py + dy;
          if (x < 1 || y < 1 || x >= C.MAP_W - 1 || y >= C.MAP_H - 1) continue;
          const idx = cellIdx(x, y);
          if (isImpassId(g.terrain[idx])) g.terrain[idx] = T_GRASS;
        }
      }
    }
  }

  // BFS over grass/dirt cells (occupancy is empty at mapgen time).
  function connected(g, a, b) {
    const W = C.MAP_W, H = C.MAP_H;
    const seen = new Uint8Array(W * H);
    const q = new Int32Array(W * H);
    let head = 0, tail = 0;
    const s = cellIdx(a.cx, a.cy);
    const goal = cellIdx(b.cx, b.cy);
    if (isImpassId(g.terrain[s]) || isImpassId(g.terrain[goal])) return false;
    seen[s] = 1; q[tail++] = s;
    while (head < tail) {
      const cur = q[head++];
      if (cur === goal) return true;
      const cx = cur % W, cy = (cur / W) | 0;
      if (cx > 0) visit(cx - 1, cy);
      if (cx < W - 1) visit(cx + 1, cy);
      if (cy > 0) visit(cx, cy - 1);
      if (cy < H - 1) visit(cx, cy + 1);
    }
    return false;
    function visit(x, y) {
      const i = cellIdx(x, y);
      if (!seen[i] && !isImpassId(g.terrain[i])) { seen[i] = 1; q[tail++] = i; }
    }
  }

  // ---- tiberium --------------------------------------------------------------

  // Place a tiberium field of ~`count` cells centered at (fx,fy), denser at the
  // middle with radial falloff, plus a blossom tree at the heart.
  // Only writes onto grass/dirt cells outside the start ±2 exclusion squares.
  function placeField(g, rng, fx, fy, count, starts) {
    const R = Math.sqrt(count / Math.PI) + 2.5;
    const Ri = Math.ceil(R);
    const cand = [];
    for (let dy = -Ri; dy <= Ri; dy++) {
      for (let dx = -Ri; dx <= Ri; dx++) {
        const x = fx + dx, y = fy + dy;
        if (x < 1 || y < 1 || x >= C.MAP_W - 1 || y >= C.MAP_H - 1) continue;
        const t = g.terrain[cellIdx(x, y)];
        if (t !== T_GRASS && t !== T_DIRT) continue;
        if (nearAnyStart(x, y, starts, 2)) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > R) continue;
        cand.push({ x, y, d, key: d + rng() * 1.7 });
      }
    }
    if (cand.length === 0) return;
    cand.sort((p, q) => p.key - q.key);
    const n = Math.min(count, cand.length);
    for (let i = 0; i < n; i++) {
      const c = cand[i];
      const fall = Math.max(0, 1 - c.d / R);                 // 1 center -> 0 rim
      let bails = 3 + Math.round(fall * 9 + rng() * 2 - 1);  // 3..12 bails
      bails = clamp(bails, 3, 12);
      const idx = cellIdx(c.x, c.y);
      const v = bails * C.BAIL;                              // 75..300
      if (v > g.tib[idx]) g.tib[idx] = v;
    }
    // Blossom tree at the heart: nearest candidate to the intended center.
    let heart = cand[0];
    for (let i = 1; i < cand.length; i++) if (cand[i].d < heart.d) heart = cand[i];
    const hi = cellIdx(heart.x, heart.y);
    g.terrain[hi] = T_BLOSSOM;
    g.tib[hi] = 0;
  }

  function nearAnyStart(x, y, starts, cheb) {
    for (const s of starts) {
      if (Math.abs(x - s.cx) <= cheb && Math.abs(y - s.cy) <= cheb) return true;
    }
    return false;
  }

  // ---- main entry --------------------------------------------------------------

  function generate(g, seed) {
    const s = (seed === undefined || seed === null) ? g.seed : seed;
    const rng = mulberry(s >>> 0);
    const W = C.MAP_W, H = C.MAP_H;
    const n = W * H;

    g.terrain.fill(T_GRASS);
    g.tib.fill(0);

    // --- start positions: human SW-ish, AI NE-ish, jitter ±3 -----------------
    const jit = () => ((rng() * 7) | 0) - 3;
    const hs = { cx: 12 + jit(), cy: 50 + jit() };
    const as = { cx: 52 + jit(), cy: 12 + jit() };
    g.startPos = { human: hs, ai: as };
    const starts = [hs, as];

    // --- dirt patches: ~10 blobby random walks --------------------------------
    const walks = 9 + ((rng() * 3) | 0); // 9..11
    for (let i = 0; i < walks; i++) dirtWalk(g, rng);

    // --- rock outcrops: 4-6 roundish blobs ------------------------------------
    const rocks = 4 + ((rng() * 3) | 0); // 4..6
    for (let i = 0; i < rocks; i++) {
      const p = pickCenter(rng, starts, 14);
      blob(g, rng, p.x, p.y, 2 + rng() * 2.5, T_ROCK);
    }

    // --- water ponds: 2-3 small blobs ------------------------------------------
    const ponds = 2 + ((rng() * 2) | 0); // 2..3
    for (let i = 0; i < ponds; i++) {
      const p = pickCenter(rng, starts, 15);
      blob(g, rng, p.x, p.y, 1.5 + rng() * 1.5, T_WATER);
    }

    // --- tree clumps: 8-12 clusters of 3-8 -------------------------------------
    const clumps = 8 + ((rng() * 5) | 0); // 8..12
    for (let i = 0; i < clumps; i++) {
      const p = pickCenter(rng, starts, 14);
      treeClump(g, rng, p.x, p.y);
    }

    // --- constraints: buildable start zones + guaranteed corridor --------------
    clearZone(g, hs.cx, hs.cy, 12);
    clearZone(g, as.cx, as.cy, 12);
    carveCorridor(g, hs, as, 1); // 3 cells wide

    // --- map border ring = rock -------------------------------------------------
    for (let x = 0; x < W; x++) {
      g.terrain[cellIdx(x, 0)] = T_ROCK;
      g.terrain[cellIdx(x, H - 1)] = T_ROCK;
    }
    for (let y = 0; y < H; y++) {
      g.terrain[cellIdx(0, y)] = T_ROCK;
      g.terrain[cellIdx(W - 1, y)] = T_ROCK;
    }

    // --- tiberium fields ---------------------------------------------------------
    // One rich field 7-9 cells from each start, offset toward map center.
    for (const st of starts) {
      let dx = 32 - st.cx, dy = 32 - st.cy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len; dy /= len;
      const off = 7 + rng() * 2; // 7..9
      const fx = clamp(Math.round(st.cx + dx * off), 2, W - 3);
      const fy = clamp(Math.round(st.cy + dy * off), 2, H - 3);
      const count = 100 + ((rng() * 41) | 0); // 100..140
      placeField(g, rng, fx, fy, count, starts);
    }
    // 2-3 medium fields around mid-map, spread apart.
    const fieldCenters = [];
    const mids = 2 + ((rng() * 2) | 0); // 2..3
    for (let i = 0; i < mids; i++) {
      let mx = 32, my = 32, ok = false;
      for (let a = 0; a < 40 && !ok; a++) {
        mx = 32 + ((rng() * 25) | 0) - 12;
        my = 32 + ((rng() * 25) | 0) - 12;
        ok = distC(mx, my, hs.cx, hs.cy) >= 15 &&
             distC(mx, my, as.cx, as.cy) >= 15;
        for (const fc of fieldCenters) {
          if (distC(mx, my, fc.x, fc.y) < 10) { ok = false; break; }
        }
      }
      fieldCenters.push({ x: mx, y: my });
      const count = 50 + ((rng() * 31) | 0); // 50..80
      placeField(g, rng, mx, my, count, starts);
    }

    // --- scrub exact start cells ±2: passable terrain, no tiberium --------------
    for (const st of starts) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = st.cx + dx, y = st.cy + dy;
          if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
          const idx = cellIdx(x, y);
          if (g.terrain[idx] !== T_GRASS && g.terrain[idx] !== T_DIRT) g.terrain[idx] = T_GRASS;
          g.tib[idx] = 0;
        }
      }
    }

    // --- validate connectivity; widen the corridor if something snuck in --------
    if (!connected(g, hs, as)) {
      carveCorridor(g, hs, as, 2); // 5 wide
      if (!connected(g, hs, as)) carveCorridor(g, hs, as, 3); // 7 wide, cannot fail
    }

    // --- terrain variants for every cell -----------------------------------------
    for (let i = 0; i < n; i++) g.tvar[i] = (rng() * 4) | 0;
  }

  return { generate };
})();
