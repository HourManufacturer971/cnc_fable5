'use strict';
// map.js — deterministic 64x64 skirmish map generation.
// Defines exactly one global: MAPGEN. See SPEC.md "Map generation".
//
// MAPGEN.generate(game, seed):
//   - fills game.terrain / game.tvar / game.tib
//   - sets game.startPos = { human:{cx,cy}, ai:{cx,cy} }
// All randomness comes from a local mulberry(seed) stream so the same seed
// always produces the same map regardless of prior game.rng() consumption.
//
// The layout aims for "a world, not a tile sheet": broad noise-driven dirt
// regions, a meandering river with fords, forests with clearings, boulder
// outcrops and a ragged rocky map rim. TERRAINPAINT renders all of it with
// soft blended edges, so cell-level shapes here can stay coarse.

const MAPGEN = (function () {

  // terrain ids (see SPEC): 0 grass, 1 dirt, 2 rock, 3 water, 4 tree,
  // 5 blossom, 6 bridge deck (passable, drawn over water)
  const T_GRASS = 0, T_DIRT = 1, T_ROCK = 2, T_WATER = 3, T_TREE = 4, T_BLOSSOM = 5, T_BRIDGE = 6;

  function isImpassId(t) { return t === T_ROCK || t === T_WATER || t === T_TREE || t === T_BLOSSOM; }

  function distC(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ---- cell-grid value noise ---------------------------------------------------

  function hash2(x, y, s) {
    let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ s;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function vnoise(x, y, period, s) {
    const gx = x / period, gy = y / period;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    let tx = gx - x0, ty = gy - y0;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = hash2(x0, y0, s), b = hash2(x0 + 1, y0, s);
    const c = hash2(x0, y0 + 1, s), d = hash2(x0 + 1, y0 + 1, s);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }

  function fbm(x, y, period, oct, s) {
    let v = 0, amp = 1, tot = 0, p = period;
    for (let i = 0; i < oct; i++) {
      v += vnoise(x, y, p, s + i * 131) * amp;
      tot += amp; amp *= 0.5; p /= 2;
    }
    return v / tot;
  }

  // ---- feature painters ------------------------------------------------------

  // Short blobby dirt trail via a random walk with a 3x3 brush.
  function dirtWalk(g, rng) {
    const W = C.MAP_W, H = C.MAP_H;
    let x = 2 + ((rng() * (W - 4)) | 0);
    let y = 2 + ((rng() * (H - 4)) | 0);
    const len = 18 + ((rng() * 26) | 0);
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
  // Only converts open ground (grass/dirt), so features never eat each other.
  function blob(g, rng, cx, cy, r, tid) {
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const px = cx + dx, py = cy + dy;
        if (px < 1 || py < 1 || px >= C.MAP_W - 1 || py >= C.MAP_H - 1) continue;
        const d = Math.sqrt(dx * dx + dy * dy) + rng() * 0.9;
        if (d > r) continue;
        const idx = cellIdx(px, py);
        if (g.terrain[idx] === T_GRASS || g.terrain[idx] === T_DIRT) g.terrain[idx] = tid;
      }
    }
  }

  // Forest: ragged tree blob with interior clearings.
  function forest(g, rng, cx, cy, r) {
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const px = cx + dx, py = cy + dy;
        if (px < 1 || py < 1 || px >= C.MAP_W - 1 || py >= C.MAP_H - 1) continue;
        const d = Math.sqrt(dx * dx + dy * dy) + rng() * 1.4;
        if (d > r) continue;
        const idx = cellIdx(px, py);
        if ((g.terrain[idx] === T_GRASS || g.terrain[idx] === T_DIRT) && rng() < 0.8) {
          g.terrain[idx] = T_TREE;
        }
      }
    }
  }

  // Cluster of 3..8 tree cells around (cx,cy), only over grass/dirt.
  function treeClump(g, rng, cx, cy) {
    let want = 3 + ((rng() * 6) | 0); // 3..8
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

  // Meandering west->east river across mid-map with two fords. One ford is
  // pinned where the river crosses the straight line between the two starts,
  // so the classic centre route always survives (and carveCorridor never has
  // to slice an ugly straight canal through the water).
  function river(g, rng, hs, as) {
    const W = C.MAP_W, H = C.MAP_H;
    const y0 = 22 + rng() * 8;   // west entry 22..30
    const y1 = 30 + rng() * 8;   // east exit 30..38
    const ph = rng() * Math.PI * 2;
    const amp = 2.5 + rng() * 2.5;

    const yc = new Float32Array(W);
    const segX0 = Math.min(hs.cx, as.cx), segX1 = Math.max(hs.cx, as.cx);
    let fordX1 = (W / 2) | 0, best = 1e9;
    for (let x = 0; x < W; x++) {
      yc[x] = y0 + (y1 - y0) * (x / (W - 1)) +
              Math.sin(x * 0.15 + ph) * amp + Math.sin(x * 0.33 + ph * 1.9) * 1.4;
      if (x >= segX0 && x <= segX1) {
        const t = (x - hs.cx) / ((as.cx - hs.cx) || 1);
        const sy = hs.cy + (as.cy - hs.cy) * t;
        const d = Math.abs(yc[x] - sy);
        if (d < best) { best = d; fordX1 = x; }
      }
    }
    let fordX2 = fordX1 + (rng() < 0.5 ? -1 : 1) * (10 + ((rng() * 8) | 0));
    fordX2 = clamp(fordX2, 6, W - 7);

    for (let x = 1; x < W - 1; x++) {
      if (Math.abs(x - fordX1) <= 2 || Math.abs(x - fordX2) <= 2) continue; // fords
      const hw = 1.2 + Math.sin(x * 0.23 + ph * 2.3) * 0.5 + rng() * 0.3;  // width wobble
      for (let dy = -3; dy <= 3; dy++) {
        const y = Math.round(yc[x]) + dy;
        if (y < 1 || y >= H - 1) continue;
        if (Math.abs(y - yc[x]) > hw) continue;
        if (distC(x, y, hs.cx, hs.cy) < 13 || distC(x, y, as.cx, as.cy) < 13) continue;
        const idx = cellIdx(x, y);
        if (g.terrain[idx] === T_GRASS || g.terrain[idx] === T_DIRT) g.terrain[idx] = T_WATER;
      }
    }
    return { yc, fordX1, fordX2 };
  }

  // Convert one river column into a bridge deck (passable id 6), well away
  // from both fords so it forms a third, man-made crossing.
  function placeBridge(g, rng, riv) {
    const W = C.MAP_W, H = C.MAP_H;
    const cand = [];
    for (let x = 8; x < W - 8; x++) {
      const dFord = Math.min(Math.abs(x - riv.fordX1), Math.abs(x - riv.fordX2));
      if (dFord < 7) continue;
      // column must actually hold water here
      let n = 0;
      for (let y = Math.max(1, Math.round(riv.yc[x]) - 4); y <= Math.min(H - 2, Math.round(riv.yc[x]) + 4); y++) {
        if (g.terrain[cellIdx(x, y)] === T_WATER) n++;
      }
      if (n >= 2 && n <= 5) cand.push({ x, dFord });
    }
    if (!cand.length) return null;
    cand.sort((a, b) => b.dFord - a.dFord);
    const pick = cand[(rng() * Math.min(6, cand.length)) | 0];
    const cells = [];
    for (let y = Math.max(1, Math.round(riv.yc[pick.x]) - 4); y <= Math.min(H - 2, Math.round(riv.yc[pick.x]) + 4); y++) {
      const idx = cellIdx(pick.x, y);
      if (g.terrain[idx] === T_WATER) { g.terrain[idx] = T_BRIDGE; cells.push({ cx: pick.x, cy: y }); }
    }
    return cells.length ? cells : null;
  }

  // Ragged rocky rim, 1..3 cells deep, depth varying smoothly along each edge.
  function borderFringe(g, rng) {
    const W = C.MAP_W, H = C.MAP_H;
    function series(n) {
      const lat = [];
      for (let i = 0; i <= Math.ceil(n / 8) + 1; i++) lat.push(rng());
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / 8, i0 = t | 0, f = t - i0;
        out[i] = lat[i0] + (lat[i0 + 1] - lat[i0]) * (f * f * (3 - 2 * f));
      }
      return out;
    }
    const top = series(W), bot = series(W), lef = series(H), rig = series(H);
    for (let x = 0; x < W; x++) {
      const dt = 1 + Math.round(top[x] * 2.2), db = 1 + Math.round(bot[x] * 2.2);
      for (let y = 0; y < dt; y++) g.terrain[cellIdx(x, y)] = T_ROCK;
      for (let y = 0; y < db; y++) g.terrain[cellIdx(x, H - 1 - y)] = T_ROCK;
    }
    for (let y = 0; y < H; y++) {
      const dl = 1 + Math.round(lef[y] * 2.2), dr = 1 + Math.round(rig[y] * 2.2);
      for (let x = 0; x < dl; x++) g.terrain[cellIdx(x, y)] = T_ROCK;
      for (let x = 0; x < dr; x++) g.terrain[cellIdx(C.MAP_W - 1 - x, y)] = T_ROCK;
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

  // Holdout fortress: a two-cell-thick rock ring around the player's start
  // with exactly three passes — one aimed at the enemy (so the guaranteed
  // corridor threads a gate instead of blasting a random hole), the other
  // two swung wide to the flanks. Pass arcs are ~4-5 cells wide: enough for
  // tanks and harvesters, narrow enough to fortify.
  function fortressRing(g, rng, c, foe) {
    const r0 = 9.5, r1 = 11.5;
    const a0 = Math.atan2(foe.cy - c.cy, foe.cx - c.cx);
    const gates = [
      a0,
      a0 + 1.9 + rng() * 0.7,
      a0 - 1.9 - rng() * 0.7,
    ];
    const HALF = 0.22;   // angular half-width => ~4.6-cell arc at r=10.5
    const R = Math.ceil(r1);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const r = Math.sqrt(dx * dx + dy * dy);
        if (r < r0 || r > r1) continue;
        const x = c.cx + dx, y = c.cy + dy;
        if (x < 1 || y < 1 || x >= C.MAP_W - 1 || y >= C.MAP_H - 1) continue;
        const a = Math.atan2(dy, dx);
        let inGate = false;
        for (const ga of gates) {
          // gate angles may sit outside [-PI, PI] — wrap the difference fully
          let d = Math.abs(a - ga) % (Math.PI * 2);
          if (d > Math.PI) d = Math.PI * 2 - d;
          if (d < HALF) { inGate = true; break; }
        }
        if (!inGate) g.terrain[cellIdx(x, y)] = T_ROCK;
      }
    }
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

  // Zero out any tiberium along the guaranteed corridor between the two
  // starts, so a tiberium-free route always connects the bases (infantry
  // can cross without taking chip damage, matching the always-passable
  // terrain guarantee carveCorridor already gives that same line).
  function clearTibCorridor(g, a, b, rad) {
    const steps = Math.max(1, Math.ceil(distC(a.cx, a.cy, b.cx, b.cy)) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = Math.round(a.cx + (b.cx - a.cx) * t);
      const py = Math.round(a.cy + (b.cy - a.cy) * t);
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const x = px + dx, y = py + dy;
          if (!inMap(x, y)) continue;
          g.tib[cellIdx(x, y)] = 0;
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

  // Passable-cell reachability from both starts (4-connected BFS, matching
  // no-corner-cutting movement). Forests/rivers can seal small grass pockets;
  // tiberium seeded inside one would wedge every harvester that targets it,
  // so placeField only accepts cells this mask can reach.
  function reachMask(g, starts) {
    const W = C.MAP_W, H = C.MAP_H;
    const seen = new Uint8Array(W * H);
    const q = new Int32Array(W * H);
    let head = 0, tail = 0;
    function visit(i) { if (!seen[i] && !isImpassId(g.terrain[i])) { seen[i] = 1; q[tail++] = i; } }
    for (const st of starts) visit(cellIdx(st.cx, st.cy));
    while (head < tail) {
      const cur = q[head++];
      const cx = cur % W, cy = (cur / W) | 0;
      if (cx > 0) visit(cur - 1);
      if (cx < W - 1) visit(cur + 1);
      if (cy > 0) visit(cur - W);
      if (cy < H - 1) visit(cur + W);
    }
    return seen;
  }

  // Place a tiberium field of ~`count` cells centered at (fx,fy), denser at the
  // middle with radial falloff, plus a blossom tree at the heart.
  // Only writes onto reachable grass/dirt cells outside the start ±2 squares.
  function placeField(g, rng, fx, fy, count, starts, reach) {
    const R = Math.sqrt(count / Math.PI) + 2.5;
    const Ri = Math.ceil(R);
    const cand = [];
    for (let dy = -Ri; dy <= Ri; dy++) {
      for (let dx = -Ri; dx <= Ri; dx++) {
        const x = fx + dx, y = fy + dy;
        if (x < 1 || y < 1 || x >= C.MAP_W - 1 || y >= C.MAP_H - 1) continue;
        const t = g.terrain[cellIdx(x, y)];
        if (t !== T_GRASS && t !== T_DIRT) continue;
        if (reach && !reach[cellIdx(x, y)]) continue;
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

  function generate(g, seed, opts) {
    opts = opts || {};
    const s = (seed === undefined || seed === null) ? g.seed : seed;
    const rng = mulberry(s >>> 0);
    const hseed = (s >>> 0) ^ 0x3c6ef372;
    const W = C.MAP_W, H = C.MAP_H;
    const n = W * H;

    g.terrain.fill(T_GRASS);
    g.tib.fill(0);

    // --- start positions: human SW-ish, AI NE-ish, jitter ±3 -----------------
    // (holdout scenario: the human holds the CENTER of the map instead)
    const jit = () => ((rng() * 7) | 0) - 3;
    const hs = opts.holdout
      ? { cx: 32 + ((rng() * 5) | 0) - 2, cy: 32 + ((rng() * 5) | 0) - 2 }
      : { cx: 12 + jit(), cy: 50 + jit() };
    const as = { cx: 52 + jit(), cy: 12 + jit() };
    g.startPos = { human: hs, ai: as };
    const starts = [hs, as];

    // --- dirt: broad noise regions + a few short worn trails ------------------
    for (let cy = 1; cy < H - 1; cy++) {
      for (let cx = 1; cx < W - 1; cx++) {
        if (fbm(cx, cy, 15, 3, hseed) > 0.565) g.terrain[cellIdx(cx, cy)] = T_DIRT;
      }
    }
    const walks = 2 + ((rng() * 2) | 0); // 2..3
    for (let i = 0; i < walks; i++) dirtWalk(g, rng);

    // --- river (most seeds) or extra ponds -------------------------------------
    g.decor = { bridge: null, waterfall: null, village: null };
    const hasRiver = rng() < 0.62;
    let riv = null;
    if (hasRiver) {
      riv = river(g, rng, hs, as);
      g.decor.bridge = placeBridge(g, rng, riv);
    }

    // --- water ponds ------------------------------------------------------------
    const ponds = (hasRiver ? 1 : 3) + ((rng() * 2) | 0);
    for (let i = 0; i < ponds; i++) {
      const p = pickCenter(rng, starts, 15);
      blob(g, rng, p.x, p.y, 1.8 + rng() * 1.8, T_WATER);
    }

    // --- rock outcrops: 4-6 roundish blobs --------------------------------------
    const rocks = 4 + ((rng() * 3) | 0); // 4..6
    for (let i = 0; i < rocks; i++) {
      const p = pickCenter(rng, starts, 14);
      blob(g, rng, p.x, p.y, 2 + rng() * 2.5, T_ROCK);
    }

    // --- woods: big forests with clearings, small clumps, lone trees ------------
    const forests = 3 + ((rng() * 2) | 0); // 3..4
    for (let i = 0; i < forests; i++) {
      const p = pickCenter(rng, starts, 15);
      forest(g, rng, p.x, p.y, 3 + rng() * 2);
    }
    const clumps = 5 + ((rng() * 4) | 0); // 5..8
    for (let i = 0; i < clumps; i++) {
      const p = pickCenter(rng, starts, 14);
      treeClump(g, rng, p.x, p.y);
    }
    const singles = 8 + ((rng() * 7) | 0); // 8..14
    for (let i = 0; i < singles; i++) {
      const p = pickCenter(rng, starts, 12);
      const idx = cellIdx(p.x, p.y);
      if (g.terrain[idx] === T_GRASS || g.terrain[idx] === T_DIRT) g.terrain[idx] = T_TREE;
    }

    // --- ragged rocky rim ---------------------------------------------------------
    borderFringe(g, rng);

    // --- constraints: buildable start zones + guaranteed corridor --------------
    clearZone(g, hs.cx, hs.cy, 12);
    clearZone(g, as.cx, as.cy, 12);
    carveCorridor(g, hs, as, 1); // 3 cells wide

    // holdout: ring the player's plateau in rock, leaving three gated passes
    // (one facing the enemy — the carved corridor threads through it)
    if (opts.holdout) fortressRing(g, rng, hs, as);

    // --- hard map border ring = rock ---------------------------------------------
    for (let x = 0; x < W; x++) {
      g.terrain[cellIdx(x, 0)] = T_ROCK;
      g.terrain[cellIdx(x, H - 1)] = T_ROCK;
    }
    for (let y = 0; y < H; y++) {
      g.terrain[cellIdx(0, y)] = T_ROCK;
      g.terrain[cellIdx(W - 1, y)] = T_ROCK;
    }

    // --- tiberium fields ---------------------------------------------------------
    // Fields only grow on cells reachable from the starts (later passes just
    // clear MORE terrain, so reachability can only widen after this point).
    const reach = reachMask(g, starts);
    if (opts.holdout) {
      // the player's pocket INSIDE the walls is modest — enough to boot the
      // economy, not enough to sit on for the whole siege
      {
        const a = Math.atan2(hs.cy - as.cy, hs.cx - as.cx); // away from the enemy
        const fx = clamp(Math.round(hs.cx + Math.cos(a) * 6), 2, W - 3);
        const fy = clamp(Math.round(hs.cy + Math.sin(a) * 6), 2, H - 3);
        placeField(g, rng, fx, fy, 55 + ((rng() * 16) | 0), starts, reach);
      }
      // the rich fields lie OUTSIDE the passes — worth a guarded convoy
      for (let i = 0; i < 3; i++) {
        const a = rng() * Math.PI * 2;
        const d = 17 + rng() * 6; // 17..23 cells out, past the ring
        const fx = clamp(Math.round(hs.cx + Math.cos(a) * d), 3, W - 4);
        const fy = clamp(Math.round(hs.cy + Math.sin(a) * d), 3, H - 4);
        placeField(g, rng, fx, fy, 110 + ((rng() * 41) | 0), starts, reach);
      }
      // the attacker keeps a normal home field
      {
        let dx = as.cx - hs.cx, dy = as.cy - hs.cy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const fx = clamp(Math.round(as.cx + dx / len * 8), 2, W - 3);
        const fy = clamp(Math.round(as.cy + dy / len * 8), 2, H - 3);
        placeField(g, rng, fx, fy, 120 + ((rng() * 41) | 0), starts, reach);
      }
    } else {
      // One rich field 7-9 cells from each start, offset AWAY from the enemy
      // so your harvesters work the safe side of your base.
      for (let si = 0; si < starts.length; si++) {
        const st = starts[si];
        const foe = starts[1 - si];
        let dx = st.cx - foe.cx, dy = st.cy - foe.cy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= len; dy /= len;
        const off = 7 + rng() * 2; // 7..9
        const fx = clamp(Math.round(st.cx + dx * off), 2, W - 3);
        const fy = clamp(Math.round(st.cy + dy * off), 2, H - 3);
        const count = 130 + ((rng() * 41) | 0); // 130..170 — the opening field carries the early game
        placeField(g, rng, fx, fy, count, starts, reach);
      }
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
      placeField(g, rng, mx, my, count, starts, reach);
    }

    // guaranteed tiberium-free route between the bases (mirrors the always-
    // passable corridor carved above)
    clearTibCorridor(g, hs, as, 2);

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

    // --- final sweep: a blossom heart placed after the reach mask can seal a
    // pocket behind it — recompute reachability and drop tiberium that no
    // harvester could ever reach
    const reach2 = reachMask(g, starts);
    for (let i = 0; i < n; i++) if (g.tib[i] > 0 && !reach2[i]) g.tib[i] = 0;

    // --- waterfall: the westmost surviving river column, where the water
    // spills out of the rocky rim (the fringe plugs the columns behind it)
    if (hasRiver) {
      outer:
      for (let x = 1; x < 10; x++) {
        for (let y = 1; y < H - 1; y++) {
          if (g.terrain[cellIdx(x, y)] === T_WATER &&
              (g.terrain[cellIdx(x - 1, y)] === T_ROCK || x === 1)) {
            g.decor.waterfall = { cx: x, cy: y };
            break outer;
          }
        }
      }
    }

    // --- civilian hamlet: an 8x7 patch of open, tiberium-free ground well
    // away from both bases (prefer close to the bridge — crossroads village)
    {
      let best = null, bestScore = -Infinity;
      const bx = g.decor.bridge ? g.decor.bridge[(g.decor.bridge.length / 2) | 0] : null;
      for (let a = 0; a < 90; a++) {
        const vx = 4 + ((rng() * (W - 16)) | 0), vy = 4 + ((rng() * (H - 15)) | 0);
        if (distC(vx + 4, vy + 3, hs.cx, hs.cy) < 18 || distC(vx + 4, vy + 3, as.cx, as.cy) < 18) continue;
        let ok = true;
        for (let dy = 0; dy < 7 && ok; dy++) {
          for (let dx = 0; dx < 8; dx++) {
            const idx = cellIdx(vx + dx, vy + dy);
            const t = g.terrain[idx];
            if ((t !== T_GRASS && t !== T_DIRT) || g.tib[idx] > 0 || !reach2[idx]) { ok = false; break; }
          }
        }
        if (!ok) continue;
        const score = bx ? -distC(vx + 4, vy + 3, bx.cx, bx.cy) : -Math.abs(vx - 32) - Math.abs(vy - 32);
        if (score > bestScore) { bestScore = score; best = { vx, vy }; }
      }
      if (best) {
        const { vx, vy } = best;
        g.decor.village = {
          houses: [
            { type: 'vil1', cx: vx, cy: vy },
            { type: 'vil2', cx: vx + 5, cy: vy + 1 },
            { type: 'vil3', cx: vx + 1, cy: vy + 4 },
            { type: 'vil2', cx: vx + 5, cy: vy + 4 },
          ],
          civs: [
            { type: 'c1', cx: vx + 3, cy: vy + 2 },
            { type: 'c2', cx: vx + 4, cy: vy + 3 },
            { type: 'c1', cx: vx + 2, cy: vy + 3 },
          ],
        };
      }
    }

    // --- terrain variants for every cell -----------------------------------------
    for (let i = 0; i < n; i++) g.tvar[i] = (rng() * 4) | 0;
  }

  return { generate };
})();
