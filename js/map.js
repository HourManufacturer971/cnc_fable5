'use strict';
// map.js — deterministic skirmish map generation (64x64 classic, 88x88 large;
// discrete feature counts scale with map area so big maps stay busy).
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

  // ---- geography -------------------------------------------------------------
  // A low-frequency ELEVATION field is the spine of the whole layout: the
  // river follows its valley, rock crowns its ridges, dirt bakes on its dry
  // flats, forests hug its water and lowlands. Features agree with each
  // other because they all read the same landform.

  function buildElevation(hseed) {
    const W = C.MAP_W, H = C.MAP_H;
    const elev = new Float32Array(W * H);
    for (let cy = 0; cy < H; cy++) {
      for (let cx = 0; cx < W; cx++) {
        let e = fbm(cx, cy, 26, 4, hseed ^ 0x9e3779b9);
        const de = Math.min(cx, cy, W - 1 - cx, H - 1 - cy);
        if (de < 9) e += (9 - de) * 0.024;   // land climbs toward the rocky rim
        elev[cellIdx(cx, cy)] = e;
      }
    }
    return elev;
  }

  // 4-connected distance-to-water, capped at 7 (the "moisture" everything
  // vegetal reads). 255 = bone dry.
  function waterDist(g) {
    const W = C.MAP_W, H = C.MAP_H, n = W * H;
    const d = new Uint8Array(n).fill(255);
    const q = new Int32Array(n);
    let head = 0, tail = 0;
    for (let i = 0; i < n; i++) if (g.terrain[i] === T_WATER) { d[i] = 0; q[tail++] = i; }
    while (head < tail) {
      const cur = q[head++];
      const dist = d[cur];
      if (dist >= 7) continue;
      const cx = cur % W, cy = (cur / W) | 0;
      if (cx > 0 && d[cur - 1] > dist + 1) { d[cur - 1] = dist + 1; q[tail++] = cur - 1; }
      if (cx < W - 1 && d[cur + 1] > dist + 1) { d[cur + 1] = dist + 1; q[tail++] = cur + 1; }
      if (cy > 0 && d[cur - W] > dist + 1) { d[cur - W] = dist + 1; q[tail++] = cur - W; }
      if (cy < H - 1 && d[cur + W] > dist + 1) { d[cur + W] = dist + 1; q[tail++] = cur + W; }
    }
    return d;
  }

  // Rock crowns the high ground: everything above the ~93rd elevation
  // percentile, broken up by detail noise so ridges read as ranges with
  // saddles instead of solid slabs.
  function ridges(g, elev, hseed) {
    const W = C.MAP_W, H = C.MAP_H;
    const vals = Array.from(elev).sort((a, b) => a - b);
    const cut = vals[(vals.length * 0.93) | 0];
    for (let cy = 1; cy < H - 1; cy++) {
      for (let cx = 1; cx < W - 1; cx++) {
        const i = cellIdx(cx, cy);
        if (g.terrain[i] !== T_GRASS && g.terrain[i] !== T_DIRT) continue;
        if (elev[i] > cut && fbm(cx, cy, 6, 2, hseed ^ 0x51ab) > 0.34) g.terrain[i] = T_ROCK;
      }
    }
    return { cut, dry: vals[(vals.length * 0.72) | 0] };
  }

  // Dirt where the land is high and far from water (sun-baked flats), plus
  // weathered talus skirts directly beneath rock faces.
  function dryGround(g, elev, wd, dryCut, hseed) {
    const W = C.MAP_W, H = C.MAP_H;
    for (let cy = 1; cy < H - 1; cy++) {
      for (let cx = 1; cx < W - 1; cx++) {
        const i = cellIdx(cx, cy);
        if (g.terrain[i] !== T_GRASS) continue;
        if (elev[i] > dryCut && wd[i] > 5 && fbm(cx, cy, 11, 2, hseed ^ 0x2c9f) > 0.47) {
          g.terrain[i] = T_DIRT;
          continue;
        }
        // talus: ground at the foot of rock weathers to dirt
        let rock = false;
        for (let dy = -1; dy <= 1 && !rock; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (g.terrain[cellIdx(cx + dx, cy + dy)] === T_ROCK) { rock = true; break; }
          }
        }
        if (rock && hash2(cx, cy, hseed ^ 0x7e1d) < 0.6) g.terrain[i] = T_DIRT;
      }
    }
  }

  // Forests where trees actually grow: dense gallery woods along the water,
  // groves in the moist lowlands, scattered stands on the dry heights.
  function woods(g, elev, wd, medE, hseed) {
    const W = C.MAP_W, H = C.MAP_H;
    for (let cy = 1; cy < H - 1; cy++) {
      for (let cx = 1; cx < W - 1; cx++) {
        const i = cellIdx(cx, cy);
        if (g.terrain[i] !== T_GRASS && g.terrain[i] !== T_DIRT) continue;
        const f = fbm(cx, cy, 10, 3, hseed ^ 0x77aa);
        const near = wd[i] >= 1 && wd[i] <= 4;        // banks, not the waterline cell itself
        // broad meadow mask keeps the lowlands from becoming one mega-forest:
        // groves live only where the range-scale noise allows them
        const meadow = fbm(cx, cy, 23, 2, hseed ^ 0x3d2c) < 0.40;
        const cut = near ? 0.58 : (elev[i] < medE && !meadow ? 0.66 : 0.74);
        if (f > cut) g.terrain[i] = T_TREE;
      }
    }
  }

  // A worn dirt road: straight-ish 2-wide track that only marks open grass —
  // it visually stops at water (the ford/bridge carries it) and at obstacles.
  function road(g, ax, ay, bx, by) {
    const steps = Math.max(1, Math.ceil(distC(ax, ay, bx, by)) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = Math.round(ax + (bx - ax) * t);
      const py = Math.round(ay + (by - ay) * t);
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          const x = px + dx, y = py + dy;
          if (x < 1 || y < 1 || x >= C.MAP_W - 1 || y >= C.MAP_H - 1) continue;
          const idx = cellIdx(x, y);
          if (g.terrain[idx] === T_GRASS) g.terrain[idx] = T_DIRT;
        }
      }
    }
  }

  // ---- feature painters ------------------------------------------------------

  // Roundish blob of terrain id `tid` centered on (cx,cy) with radius ~r.
  // Only converts open ground (grass/dirt), so features never eat each other.
  // Water pools along CONTOURS: flood the basin around a genuine minimum up
  // to a water level, so shorelines follow the landform instead of stamping
  // a circle on it. big=true floods a deeper level — a proper lake.
  function floodPond(g, rng, cx, cy, elev, starts, _unused, big) {
    const W = C.MAP_W, H = C.MAP_H;
    const level = elev[cellIdx(cx, cy)] + (big ? 0.055 : 0.03) * (0.7 + rng() * 0.6);
    const cap = big ? 90 + ((rng() * 60) | 0) : 14 + ((rng() * 22) | 0);
    const q = [[cx, cy]];
    const seen = new Set([cellIdx(cx, cy)]);
    const cells = [];
    while (q.length && cells.length < cap) {
      // lowest-first flood: the basin fills bottom-up like real water
      let bi = 0;
      for (let k = 1; k < q.length; k++) {
        if (elev[cellIdx(q[k][0], q[k][1])] < elev[cellIdx(q[bi][0], q[bi][1])]) bi = k;
      }
      const [x, y] = q.splice(bi, 1)[0];
      const i = cellIdx(x, y);
      if (elev[i] > level) continue;
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue;
      if (g.terrain[i] !== T_GRASS && g.terrain[i] !== T_DIRT) continue;
      let nearStart = false;
      for (const st of starts) {
        if (distC(x, y, st.cx, st.cy) < 14) { nearStart = true; break; }
      }
      if (nearStart) continue;
      cells.push(i);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = cellIdx(x + dx, y + dy);
        if (!seen.has(ni)) { seen.add(ni); q.push([x + dx, y + dy]); }
      }
    }
    if (cells.length < 5) return;   // too small to read as water — skip
    for (const i of cells) g.terrain[i] = T_WATER;
    // drainage: a thin stream runs out of the basin downhill (real ponds
    // have outlets), petering out after a dozen cells or on reaching water
    if (rng() < 0.7) stream(g, cx, cy, elev, starts);
  }

  // 1-wide downhill stream from (cx,cy): follow the steepest descent
  function stream(g, cx, cy, elev, starts) {
    const W = C.MAP_W, H = C.MAP_H;
    let x = cx, y = cy;
    for (let n = 0; n < 14; n++) {
      let nx = x, ny = y, be = Infinity;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 2 || yy < 2 || xx >= W - 2 || yy >= H - 2) continue;
        const e = elev[cellIdx(xx, yy)];
        if (e < be) { be = e; nx = xx; ny = yy; }
      }
      if (nx === x && ny === y) return;
      x = nx; y = ny;
      const i = cellIdx(x, y);
      if (g.terrain[i] === T_WATER) return;      // joined a river or pond
      if (g.terrain[i] !== T_GRASS && g.terrain[i] !== T_DIRT) return;
      for (const st of starts) if (distC(x, y, st.cx, st.cy) < 14) return;
      g.terrain[i] = T_WATER;
    }
  }

  // shoreline cleanup: orphan water specks dry up, one-cell land pinholes
  // inside a body flood — coasts read as coasts, not cell noise
  function smoothShores(g) {
    const W = C.MAP_W, H = C.MAP_H;
    for (let pass = 0; pass < 2; pass++) {
      const drop = [], fill = [];
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = cellIdx(x, y);
          const t = g.terrain[i];
          if (t !== T_WATER && t !== T_GRASS && t !== T_DIRT) continue;
          let wet = 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            if (g.terrain[cellIdx(x + dx, y + dy)] === T_WATER) wet++;
          }
          if (t === T_WATER && wet <= 1) drop.push(i);
          else if (t !== T_WATER && wet >= 7) fill.push(i);
        }
      }
      for (const i of drop) g.terrain[i] = T_GRASS;
      for (const i of fill) g.terrain[i] = T_WATER;
      if (!drop.length && !fill.length) break;
    }
  }

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

  // West->east river that FOLLOWS THE VALLEY: each column steps to the
  // lowest-elevation cell ahead (with a straightness preference), so bends
  // are long and geologically motivated instead of sine-wave wiggle. It
  // widens downstream. Two fords; one is pinned where the river crosses the
  // start<->start line so the classic centre route always survives.
  function river(g, rng, hs, as, elev) {
    const W = C.MAP_W, H = C.MAP_H;
    const yMin = Math.round(H * 0.28), yMax = Math.round(H * 0.69); // middle band, off both base plateaus
    // base plateaus repel the channel: without this the path can hug a start
    // and the safety guard below then censors those columns, visibly
    // snapping the river in half
    const startPen = (x, y2) => {
      let p = 0;
      for (const st of [hs, as]) {
        const d = distC(x, y2, st.cx, st.cy);
        if (d < 22) p += (22 - d) * 0.04;   // start turning away 8+ columns early
        if (d < 14) p += 3;                 // hard wall: the safety guard censors these cells
      }
      return p;
    };
    // enter at the lowest point of the western edge of that band
    let y = yMin, bestE = Infinity;
    for (let yy = yMin; yy <= yMax; yy++) {
      const e = elev[cellIdx(2, yy)] + startPen(2, yy);
      if (e < bestE) { bestE = e; y = yy; }
    }
    const yc = new Float32Array(W);
    const segX0 = Math.min(hs.cx, as.cx), segX1 = Math.max(hs.cx, as.cx);
    let fordX1 = (W / 2) | 0, best = 1e9;
    for (let x = 0; x < W; x++) {
      yc[x] = y;
      if (x >= segX0 && x <= segX1) {
        const t = (x - hs.cx) / ((as.cx - hs.cx) || 1);
        const sy = hs.cy + (as.cy - hs.cy) * t;
        const d = Math.abs(y - sy);
        if (d < best) { best = d; fordX1 = x; }
      }
      if (x < W - 1) {
        let ny = y, be = Infinity;
        for (const cand of [y - 1, y, y + 1]) {
          if (cand < yMin || cand > yMax) continue;
          const e = elev[cellIdx(x + 1, cand)] + Math.abs(cand - y) * 0.012 + startPen(x + 1, cand);
          if (e < be) { be = e; ny = cand; }
        }
        y = ny;
      }
    }
    let fordX2 = fordX1 + (rng() < 0.5 ? -1 : 1) * (10 + ((rng() * 8) | 0));
    fordX2 = clamp(fordX2, 6, W - 7);

    for (let x = 1; x < W - 1; x++) {
      if (Math.abs(x - fordX1) <= 2 || Math.abs(x - fordX2) <= 2) continue; // fords
      // rivers gather water as they run: ~1 cell wide in the west, ~2.5 east
      const hw = 1.0 + (x / W) * 1.1 + rng() * 0.3;
      for (let dy = -3; dy <= 3; dy++) {
        const yy = Math.round(yc[x]) + dy;
        if (yy < 1 || yy >= H - 1) continue;
        if (Math.abs(yy - yc[x]) > hw) continue;
        if (distC(x, yy, hs.cx, hs.cy) < 13 || distC(x, yy, as.cx, as.cy) < 13) continue;
        const idx = cellIdx(x, yy);
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

  // Fell only the TREES within `rad` of (cx,cy) — water and rock survive.
  function clearTrees(g, cx, cy, rad) {
    const R = Math.ceil(rad);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > rad * rad) continue;
        const px = cx + dx, py = cy + dy;
        if (px < 1 || py < 1 || px >= C.MAP_W - 1 || py >= C.MAP_H - 1) continue;
        const idx = cellIdx(px, py);
        if (g.terrain[idx] === T_TREE) g.terrain[idx] = T_GRASS;
      }
    }
  }

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
  function placeField(g, rng, fx, fy, count, starts, reach, blue) {
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
      if (blue && g.tibType) g.tibType[idx] = 1;             // premium blue pocket
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

    // area factor: 1.0 on the classic 64x64, ~1.9 on Large 88x88. Everything
    // counted (ponds, groves, fields, hamlets, depots) multiplies by this so
    // the far country of a big map is as lively as a classic one.
    const area = (W * H) / 4096;

    // --- start positions: fractional anchors scale to any map size -----------
    // slot 0 = the human's SW corner, slot 1 = the classic NE opponent, slots
    // 2/3 = NW/SE for the extra multi-AI combatants. Holdout: human CENTER.
    const jit = () => ((rng() * 7) | 0) - 3;
    const FRAC = [[0.19, 0.78], [0.81, 0.19], [0.19, 0.19], [0.81, 0.78]];
    const mkStart = k => ({
      cx: clamp(Math.round(W * FRAC[k][0]) + jit(), 4, W - 5),
      cy: clamp(Math.round(H * FRAC[k][1]) + jit(), 4, H - 5),
    });
    const hs = opts.holdout
      ? { cx: (W >> 1) + ((rng() * 5) | 0) - 2, cy: (H >> 1) + ((rng() * 5) | 0) - 2 }
      : mkStart(0);
    const as = mkStart(1);
    g.startPos = { human: hs, ai: as };
    const starts = [hs, as];
    // side-keyed entries: the human's side at slot 0, the rest of g.sides
    // (canonical order) fill the remaining corners
    const sides = (g.sides || ['gdi', 'nod']).slice();
    g.startPos[g.humanSide || 'gdi'] = hs;
    let slot = 1;
    for (const s of sides) {
      if (s === (g.humanSide || 'gdi')) continue;
      const pos = slot === 1 ? as : mkStart(slot);
      g.startPos[s] = pos;
      if (slot >= 2) starts.push(pos);
      slot++;
    }

    // --- the landform everything else reads ------------------------------------
    const elev = buildElevation(hseed);

    // --- river in the valley (most seeds) ---------------------------------------
    g.decor = { bridge: null, waterfall: null, village: null };
    const hasRiver = rng() < 0.62;
    let riv = null;
    if (hasRiver) {
      riv = river(g, rng, hs, as, elev);
      g.decor.bridge = placeBridge(g, rng, riv);
    }

    // --- ponds pool in genuine depressions ---------------------------------------
    {
      // depressions cluster on the river's own valley floor, so keep ponds
      // clear of the crossings — a pond fused onto a ford or bridge approach
      // would seal the very gap the river carver left open
      const crossings = [];
      if (riv) {
        crossings.push({ cx: riv.fordX1, cy: Math.round(riv.yc[riv.fordX1]) });
        crossings.push({ cx: riv.fordX2, cy: Math.round(riv.yc[riv.fordX2]) });
        if (g.decor.bridge && g.decor.bridge.length) {
          const mid = g.decor.bridge[(g.decor.bridge.length / 2) | 0];
          crossings.push({ cx: mid.cx, cy: mid.cy });
        }
      }
      const want = Math.round(((hasRiver ? 1 : 3) + ((rng() * 2) | 0)) * area);
      const cands = [];
      for (let cy = 4; cy < H - 4; cy++) {
        for (let cx = 4; cx < W - 4; cx++) {
          const i = cellIdx(cx, cy);
          if (g.terrain[i] !== T_GRASS && g.terrain[i] !== T_DIRT) continue;
          if (distC(cx, cy, hs.cx, hs.cy) < 15 || distC(cx, cy, as.cx, as.cy) < 15) continue;
          let nearCrossing = false;
          for (const cr of crossings) {
            if (distC(cx, cy, cr.cx, cr.cy) < 7) { nearCrossing = true; break; }
          }
          if (nearCrossing) continue;
          const e = elev[i];
          let minima = true;
          for (let dy = -2; dy <= 2 && minima; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (!dx && !dy) continue;
              if (elev[cellIdx(cx + dx, cy + dy)] < e) { minima = false; break; }
            }
          }
          if (minima) cands.push({ cx, cy, e });
        }
      }
      cands.sort((a, b) => a.e - b.e);
      for (let i = 0; i < Math.min(want, cands.length); i++) {
        floodPond(g, rng, cands[i].cx, cands[i].cy, elev, starts,
          hasRiver ? null : riv, i === 0 && !hasRiver);
      }
      // water finished: knock the cell noise off every shoreline
      smoothShores(g);
    }

    // --- rock ridges on the high ground, dirt on the dry flats and talus ---------
    const cuts = ridges(g, elev, hseed);
    const wd = waterDist(g);
    dryGround(g, elev, wd, cuts.dry, hseed);

    // --- woods follow the moisture -----------------------------------------------
    {
      const vals = Array.from(elev).sort((a, b) => a - b);
      woods(g, elev, wd, vals[(vals.length / 2) | 0], hseed);
    }
    // a few free-standing clumps and lone trees for texture
    const clumps = Math.round((3 + ((rng() * 3) | 0)) * area); // 3..5 classic
    for (let i = 0; i < clumps; i++) {
      const p = pickCenter(rng, starts, 14);
      treeClump(g, rng, p.x, p.y);
    }
    const singles = Math.round((6 + ((rng() * 5) | 0)) * area); // 6..10 classic
    for (let i = 0; i < singles; i++) {
      const p = pickCenter(rng, starts, 12);
      const idx = cellIdx(p.x, p.y);
      if (g.terrain[idx] === T_GRASS || g.terrain[idx] === T_DIRT) g.terrain[idx] = T_TREE;
    }
    // free-standing boulder outcrops: hard cover breaking up the open field
    const crops = Math.round((1 + ((rng() * 2) | 0)) * area);
    for (let i = 0; i < crops; i++) {
      const p = pickCenter(rng, starts, 16);
      blob(g, rng, p.x, p.y, 1.7 + rng() * 1.4, T_ROCK);
    }

    // gallery woods must never seal the crossings: fell the trees at the
    // ford mouths and bridge ends (only trees — the banks stay banks)
    if (riv) {
      for (const fx of [riv.fordX1, riv.fordX2]) {
        clearTrees(g, fx, Math.round(riv.yc[fx]), 3.2);
      }
      if (g.decor.bridge && g.decor.bridge.length) {
        const bTop = g.decor.bridge[0], bBot = g.decor.bridge[g.decor.bridge.length - 1];
        clearTrees(g, bTop.cx, bTop.cy - 1, 2.2);
        clearTrees(g, bBot.cx, bBot.cy + 1, 2.2);
      }
    }

    // --- ragged rocky rim ---------------------------------------------------------
    borderFringe(g, rng);

    // --- constraints: buildable start zones + guaranteed corridors -------------
    for (const st of starts) clearZone(g, st.cx, st.cy, 12);
    for (let i = 0; i < starts.length; i++) {
      for (let j = i + 1; j < starts.length; j++) {
        carveCorridor(g, starts[i], starts[j], 1); // 3 cells wide
      }
    }

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
        let foe = null, foeD = Infinity;
        for (let sj = 0; sj < starts.length; sj++) {
          if (sj === si) continue;
          const d2 = distC(st.cx, st.cy, starts[sj].cx, starts[sj].cy);
          if (d2 < foeD) { foeD = d2; foe = starts[sj]; }
        }
        let dx = st.cx - foe.cx, dy = st.cy - foe.cy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= len; dy /= len;
        const off = 7 + rng() * 2; // 7..9
        const fx = clamp(Math.round(st.cx + dx * off), 2, W - 3);
        const fy = clamp(Math.round(st.cy + dy * off), 2, H - 3);
        // 130..170 classic — the opening field carries the early game; on a
        // large map the next field is a longer trek, so home pockets run deeper
        const count = Math.round((130 + ((rng() * 41) | 0)) * (area > 1.5 ? 1.2 : 1));
        placeField(g, rng, fx, fy, count, starts, reach);
      }
    }
    // Medium fields beyond the home pockets, spread apart — chrysalite pools
    // in the valley floors, so of the valid spots we take the lowest-lying
    // one. The FIRST stays the classic contested prize near the map centre;
    // the rest scatter across the whole interior so the far country is worth
    // harvesting (and expanding toward) on any map size.
    const fieldCenters = [];
    const mids = Math.round((2 + ((rng() * 2) | 0)) * area); // 2..3 classic, 4..6 large
    for (let i = 0; i < mids; i++) {
      let bestC = null;
      for (let a = 0; a < 40; a++) {
        const mx = i === 0 ? (W >> 1) + ((rng() * 25) | 0) - 12 : 6 + ((rng() * (W - 12)) | 0);
        const my = i === 0 ? (H >> 1) + ((rng() * 25) | 0) - 12 : 6 + ((rng() * (H - 12)) | 0);
        // the field's heart must be open, reachable ground — a heart in a
        // pond or forest pocket gives placeField no cells and the "field"
        // shrivels to a speck
        const ti = cellIdx(mx, my);
        if ((g.terrain[ti] !== T_GRASS && g.terrain[ti] !== T_DIRT) || !reach[ti]) continue;
        let ok = true;
        for (const st of starts) {
          if (distC(mx, my, st.cx, st.cy) < 15) { ok = false; break; }
        }
        for (const fc of fieldCenters) {
          if (distC(mx, my, fc.x, fc.y) < 12) { ok = false; break; }
        }
        if (!ok) continue;
        // room to grow: prize open flats around the heart so the field can
        // spread to full size; low ground breaks ties (chrysalite pools)
        let openN = 0;
        for (let dy = -5; dy <= 5; dy++) {
          for (let dx = -5; dx <= 5; dx++) {
            const x2 = mx + dx, y2 = my + dy;
            if (x2 < 1 || y2 < 1 || x2 >= W - 1 || y2 >= H - 1) continue;
            const i2 = cellIdx(x2, y2);
            const t2 = g.terrain[i2];
            if ((t2 === T_GRASS || t2 === T_DIRT) && reach[i2]) openN++;
          }
        }
        const score = openN - elev[ti] * 8;
        if (!bestC || score > bestC.score) bestC = { x: mx, y: my, score };
      }
      if (!bestC) bestC = { x: W >> 1, y: H >> 1, score: 0 };
      fieldCenters.push(bestC);
      // 50..80 classic; large maps grow each field a quarter richer — the
      // longer haul across a big map has to pay for itself
      const count = Math.round((50 + ((rng() * 31) | 0)) * (area > 1.5 ? 1.25 : 1));
      // the first (most contested) midfield is BLUE chrysalite — worth double
      // at the refinery; big maps hide a second blue pocket out in the wilds
      placeField(g, rng, bestC.x, bestC.y, count, starts, reach,
        i === 0 || (area > 1.5 && i === 3));
    }

    // guaranteed tiberium-free route between the bases (mirrors the always-
    // passable corridors carved above)
    for (let i = 0; i < starts.length; i++) {
      for (let j = i + 1; j < starts.length; j++) {
        clearTibCorridor(g, starts[i], starts[j], 2);
      }
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
    for (const st of starts) {
      if (st === hs) continue;
      if (!connected(g, hs, st)) {
        carveCorridor(g, hs, st, 2); // 5 wide
        if (!connected(g, hs, st)) carveCorridor(g, hs, st, 3); // 7 wide, cannot fail
      }
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
        let nearBase = false;
        for (const st of starts) {
          if (distC(vx + 4, vy + 3, st.cx, st.cy) < 18) { nearBase = true; break; }
        }
        if (nearBase) continue;
        let ok = true;
        for (let dy = 0; dy < 7 && ok; dy++) {
          for (let dx = 0; dx < 8; dx++) {
            const idx = cellIdx(vx + dx, vy + dy);
            const t = g.terrain[idx];
            if ((t !== T_GRASS && t !== T_DIRT) || g.tib[idx] > 0 || !reach2[idx]) { ok = false; break; }
          }
        }
        if (!ok) continue;
        const score = bx ? -distC(vx + 4, vy + 3, bx.cx, bx.cy) : -Math.abs(vx - (W >> 1)) - Math.abs(vy - (H >> 1));
        if (score > bestScore) { bestScore = score; best = { vx, vy }; }
      }
      if (best) {
        const { vx, vy } = best;
        g.decor.village = {
          houses: [
            { type: 'vil1', cx: vx, cy: vy },
            { type: 'chur', cx: vx + 3, cy: vy },     // chapel — rumor says the collection box is full
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
        // villages exist for a reason: a worn road to the river crossing,
        // and a lane out toward the nearest base
        const vcx = vx + 4, vcy = vy + 3;
        let crossing = null;
        if (g.decor.bridge && g.decor.bridge.length) {
          const mid = g.decor.bridge[(g.decor.bridge.length / 2) | 0];
          crossing = { cx: mid.cx, cy: mid.cy };
        } else if (riv) {
          const fx = Math.abs(riv.fordX1 - vcx) <= Math.abs(riv.fordX2 - vcx) ? riv.fordX1 : riv.fordX2;
          crossing = { cx: fx, cy: Math.round(riv.yc[fx]) };
        }
        if (crossing) road(g, vcx, vcy, crossing.cx, crossing.cy);
        const nb = distC(vcx, vcy, hs.cx, hs.cy) <= distC(vcx, vcy, as.cx, as.cy) ? hs : as;
        road(g, vcx, vcy, (vcx + nb.cx) >> 1, (vcy + nb.cy) >> 1);
      }
    }

    // --- second hamlet: big maps get an outlying farmstead far from the
    // first village, so the frontier has garrisons and church crates too
    if (area > 1.5 && g.decor.village) {
      const v0 = g.decor.village.houses[0];
      let best = null, bestScore = -Infinity;
      for (let a = 0; a < 90; a++) {
        const vx = 4 + ((rng() * (W - 14)) | 0), vy = 4 + ((rng() * (H - 13)) | 0);
        let bad = false;
        for (const st of starts) {
          if (distC(vx + 3, vy + 2, st.cx, st.cy) < 18) { bad = true; break; }
        }
        if (bad || distC(vx + 3, vy + 2, v0.cx + 4, v0.cy + 3) < 24) continue;
        let ok = true;
        for (let dy = 0; dy < 6 && ok; dy++) {
          for (let dx = 0; dx < 7; dx++) {
            const idx = cellIdx(vx + dx, vy + dy);
            const t = g.terrain[idx];
            if ((t !== T_GRASS && t !== T_DIRT) || g.tib[idx] > 0 || !reach2[idx]) { ok = false; break; }
          }
        }
        if (!ok) continue;
        const score = distC(vx + 3, vy + 2, v0.cx + 4, v0.cy + 3);   // spread out
        if (score > bestScore) { bestScore = score; best = { vx, vy } };
      }
      if (best) {
        const { vx, vy } = best;
        g.decor.village.houses.push(
          { type: 'vil2', cx: vx, cy: vy },
          { type: 'vil3', cx: vx + 4, cy: vy },
          { type: 'vil1', cx: vx + 2, cy: vy + 3 });
        g.decor.village.civs.push(
          { type: 'c2', cx: vx + 2, cy: vy + 2 },
          { type: 'c1', cx: vx + 4, cy: vy + 3 });
        // a farm lane wanders toward the heart of the map
        road(g, vx + 3, vy + 2, (vx + 3 + (W >> 1)) >> 1, (vy + 2 + (H >> 1)) >> 1);
      }
    }

    // --- neutral supply depots: two prizes worth fighting over -------------------
    // Contested ground by construction: each wants to sit near the midfield
    // (or a river crossing), far from both bases, on clear reachable land.
    if (!opts.holdout) {
      g.decor.depots = [];
      const anchors = [];
      if (riv) {
        anchors.push({ cx: riv.fordX1, cy: Math.round(riv.yc[riv.fordX1]) });
        if (g.decor.bridge && g.decor.bridge.length) {
          const mid = g.decor.bridge[(g.decor.bridge.length / 2) | 0];
          anchors.push({ cx: mid.cx, cy: mid.cy });
        } else {
          anchors.push({ cx: riv.fordX2, cy: Math.round(riv.yc[riv.fordX2]) });
        }
      } else {
        anchors.push({ cx: W >> 1, cy: H >> 1 }, { cx: W >> 1, cy: H >> 1 });
      }
      // big maps: two more depots anchored off-centre, so the frontier
      // quadrants hold prizes of their own
      if (area > 1.5) {
        anchors.push({ cx: Math.round(W * 0.3), cy: Math.round(H * 0.68) });
        anchors.push({ cx: Math.round(W * 0.7), cy: Math.round(H * 0.32) });
      }
      for (const anchor of anchors.slice(0, area > 1.5 ? 4 : 2)) {
        let best = null, bestScore = Infinity;
        for (let a = 0; a < 120; a++) {
          const dx = 4 + ((rng() * (W - 10)) | 0), dy = 4 + ((rng() * (H - 10)) | 0);
          let depotNearBase = false;
          for (const st of starts) {
            if (distC(dx + 1, dy + 1, st.cx, st.cy) < 18) { depotNearBase = true; break; }
          }
          if (depotNearBase) continue;
          if (g.decor.village) {
            const v = g.decor.village.houses[0];
            if (distC(dx, dy, v.cx + 4, v.cy + 3) < 8) continue;
          }
          let clear = true;
          for (let yy = dy - 1; yy <= dy + 2 && clear; yy++) {
            for (let xx = dx - 1; xx <= dx + 2; xx++) {
              const i = cellIdx(xx, yy);
              const t = g.terrain[i];
              if ((t !== T_GRASS && t !== T_DIRT) || g.tib[i] > 0 || !reach2[i]) { clear = false; break; }
            }
          }
          if (!clear) continue;
          let score = distC(dx, dy, anchor.cx, anchor.cy);
          for (const other of g.decor.depots) score += Math.max(0, 14 - distC(dx, dy, other.cx, other.cy)) * 3;
          if (score < bestScore) { bestScore = score; best = { cx: dx, cy: dy }; }
        }
        if (best) g.decor.depots.push(best);
      }
    }

    // --- terrain variants for every cell -----------------------------------------
    for (let i = 0; i < n; i++) g.tvar[i] = (rng() * 4) | 0;
  }

  return { generate };
})();
