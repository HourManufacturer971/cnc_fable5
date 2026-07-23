'use strict';
// map.js — deterministic skirmish map generation (64x64 classic, 88x88 large;
// discrete feature counts scale with map area so big maps stay busy).
// Defines exactly one global: MAPGEN. See SPEC.md "Map generation".
//
// MAPGEN.generate(game, seed, opts):
//   - fills game.terrain / game.tvar / game.tib
//   - sets game.startPos = { human:{cx,cy}, ai:{cx,cy} }
//   - opts.holdout: walled center plateau; opts.shore: sea + landing beach
//     along the southern edge (the staged-landing missions)
// All randomness comes from a local mulberry(seed) stream so the same seed
// always produces the same map regardless of prior game.rng() consumption.
//
// The layout aims for "a world, not a tile sheet": broad noise-driven dirt
// regions, a meandering river with fords, forests with clearings, boulder
// outcrops and a ragged rocky map rim. TERRAINPAINT renders all of it with
// soft blended edges, so cell-level shapes here can stay coarse.

const MAPGEN = (function () {

  // terrain ids (see SPEC): 0 grass, 1 dirt, 2 rock, 3 water, 4 tree,
  // 5 blossom, 6 bridge deck (passable, drawn over water), 7 fallen span
  // (sim-only), 8 sand, 9 marsh, 10 scrub — the last three are passable
  // ground variants the painter blends seamlessly into grass/dirt
  const T_GRASS = 0, T_DIRT = 1, T_ROCK = 2, T_WATER = 3, T_TREE = 4, T_BLOSSOM = 5, T_BRIDGE = 6,
    T_SAND = 8, T_MARSH = 9, T_SCRUB = 10;

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
  // Highlands with character: 2-5 rounded MESAS crown the interior high
  // ground — a crag ring around a walkable top, with one or two dirt ramps
  // cut through the ring as the only ways up. Sited away from the rim (the
  // map edge is already a barrier; stacking rock there wastes land), away
  // from the starts and clear of water. Tops are recorded in g.decor.mesas
  // so the painter can lift their tone (sunlit plateau).
  function mesas(g, rng, elev, starts) {
    const W = C.MAP_W, H = C.MAP_H;
    const count = Math.min(5, Math.round((2 + rng() * 2) * Math.min((W * H) / 7056, 1.6)));
    const list = [];
    for (let m = 0; m < count; m++) {
      const r = 5 + rng() * 2.5;
      let best = null;
      for (let a = 0; a < 70; a++) {
        const cx = Math.round(r + 8 + rng() * (W - 2 * (r + 8)));
        const cy = Math.round(r + 8 + rng() * (H - 2 * (r + 8)));
        let ok = true;
        for (const st of starts) {
          if (distC(cx, cy, st.cx, st.cy) < r + 13) { ok = false; break; }
        }
        if (ok) {
          for (const o of list) {
            if (distC(cx, cy, o.cx, o.cy) < r + o.r + 8) { ok = false; break; }
          }
        }
        if (!ok) continue;
        // dry footing: no water or bridge deck anywhere under the footprint
        let wet = false;
        const R0 = Math.ceil(r + 1);
        for (let dy = -R0; dy <= R0 && !wet; dy++) {
          for (let dx = -R0; dx <= R0; dx++) {
            const t = g.terrain[cellIdx(cx + dx, cy + dy)];
            if (t === T_WATER || t === T_BRIDGE) { wet = true; break; }
          }
        }
        if (wet) continue;
        const score = elev[cellIdx(cx, cy)] + rng() * 0.05;   // crown the high ground
        if (!best || score > best.score) best = { cx, cy, score };
      }
      if (!best) continue;
      const cx = best.cx, cy = best.cy;
      const p1 = rng() * Math.PI * 2, p2 = rng() * Math.PI * 2;
      // two ramps, roughly opposite — one exit can land in a dead pocket
      // (lakeside pouch, forest), two almost never do
      const rampA = rng() * Math.PI * 2;
      const ramp2 = rampA + Math.PI * (0.7 + rng() * 0.6);
      const top = [];
      const R = Math.ceil(r + 2);
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue;
          const d = Math.sqrt(dx * dx + dy * dy);
          const ang = Math.atan2(dy, dx);
          // gently lobed outline: rounded, never spiky
          const rr = r * (1 + 0.14 * Math.sin(2 * ang + p1) + 0.10 * Math.sin(3 * ang + p2));
          if (d > rr) continue;
          const i = cellIdx(x, y);
          const t = g.terrain[i];
          if (t === T_WATER || t === T_BRIDGE || t === T_BLOSSOM) continue;
          const w1 = Math.abs(Math.atan2(Math.sin(ang - rampA), Math.cos(ang - rampA)));
          const w2 = Math.abs(Math.atan2(Math.sin(ang - ramp2), Math.cos(ang - ramp2)));
          const onRamp = Math.min(w1, w2) < 0.42;
          if (d > rr - 1.9) {
            // crag ring / dirt ramp — a ramp carves even through old crags
            g.terrain[i] = onRamp ? T_DIRT : T_ROCK;
          } else {
            if (t === T_TREE || t === T_ROCK) g.terrain[i] = T_GRASS;   // tops are open ground
            top.push(i);
          }
        }
      }
      // the ramps must OPEN somewhere: carve a short dirt lane from the top
      // out past the outline, through any old crag or treeline in the way —
      // a way up that dead-ends is no way up at all
      for (const ra of [rampA, ramp2]) {
        for (let s = r - 2; s <= r * 1.26 + 2.5; s += 0.5) {
          const px = Math.round(cx + Math.cos(ra) * s);
          const py = Math.round(cy + Math.sin(ra) * s);
          for (let dy = 0; dy <= 1; dy++) {
            for (let dx = 0; dx <= 1; dx++) {
              const x = px + dx, y = py + dy;
              if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue;
              const i = cellIdx(x, y);
              const t = g.terrain[i];
              if (t === T_ROCK || t === T_TREE) g.terrain[i] = T_DIRT;
            }
          }
        }
        const mx = Math.round(cx + Math.cos(ra) * (r * 1.26 + 2));
        const my = Math.round(cy + Math.sin(ra) * (r * 1.26 + 2));
        clearTrees(g, mx, my, 2.6);
      }
      list.push({ cx, cy, r, top });
    }
    g.decor.mesas = list;
  }

  // Dirt where the land is high and far from water (sun-baked flats), plus
  // weathered talus skirts directly beneath rock faces.
  function dryGround(g, elev, wd, dryCut, hseed) {
    const W = C.MAP_W, H = C.MAP_H;
    for (let cy = 1; cy < H - 1; cy++) {
      for (let cx = 1; cx < W - 1; cx++) {
        const i = cellIdx(cx, cy);
        if (g.terrain[i] !== T_GRASS) continue;
        const f = fbm(cx, cy, 11, 2, hseed ^ 0x2c9f);
        if (elev[i] > dryCut && wd[i] > 5 && f > 0.47) {
          g.terrain[i] = T_DIRT;
          continue;
        }
        // scrub: the parched fringe around the dirt flats — same noise, a
        // slightly looser cut, so every dry region grades grass→scrub→dirt
        if (elev[i] > dryCut * 0.97 && wd[i] > 4 && f > 0.40) {
          g.terrain[i] = T_SCRUB;
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
      // lakes may run right up to the map rim — a bay against the world's
      // edge reads as honest geography, not a clipped circle
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
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
  // The river is UNBROKEN: no fords, no gaps — bridges are the only way
  // across. Cells it carves are stamped into riverMask so the shore passes
  // can tell river banks (no sand) from lake shores (sandy).
  function river(g, rng, hs, as, elev, riverMask) {
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
    for (let x = 0; x < W; x++) {
      yc[x] = y;
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
    for (let x = 1; x < W - 1; x++) {
      // rivers gather water as they run: ~1 cell wide in the west, ~3 east
      const hw = 1.2 + (x / W) * 1.6 + rng() * 0.3;
      for (let dy = -4; dy <= 4; dy++) {
        const yy = Math.round(yc[x]) + dy;
        if (yy < 1 || yy >= H - 1) continue;
        if (Math.abs(yy - yc[x]) > hw) continue;
        if (distC(x, yy, hs.cx, hs.cy) < 13 || distC(x, yy, as.cx, as.cy) < 13) continue;
        const idx = cellIdx(x, yy);
        if (g.terrain[idx] === T_GRASS || g.terrain[idx] === T_DIRT) {
          g.terrain[idx] = T_WATER;
          riverMask[idx] = 1;
        }
      }
    }
    return { yc };
  }

  // A spring-fed tributary: a narrow stream rising mid-map (never at the rim,
  // so there is always dry ground around its head) and winding down the
  // elevation grade until it joins the river. No ford — like the river it has
  // no breaks; you go around the spring or over a bridge.
  function tributary(g, rng, riv, hs, as, elev, riverMask) {
    const W = C.MAP_W, H = C.MAP_H;
    const fromTop = rng() < 0.5;
    let x = -1;
    for (let a = 0; a < 30; a++) {
      const cand = 8 + ((rng() * (W - 16)) | 0);
      if (Math.abs(cand - hs.cx) < 14 || Math.abs(cand - as.cx) < 14) continue;
      x = cand; break;
    }
    if (x < 0) return null;
    const path = [];
    let y = fromTop ? 8 + ((rng() * 6) | 0) : H - 9 - ((rng() * 6) | 0);   // the spring
    const dir = fromTop ? 1 : -1;
    for (let n = 0; n < H; n++) {
      const ry = Math.round(riv.yc[x]);
      if ((fromTop && y >= ry - 1) || (!fromTop && y <= ry + 1)) break; // joins the river band
      path.push({ x, y });
      let bx = x, be = Infinity;
      for (const cand of [x - 1, x, x + 1]) {
        if (cand < 6 || cand >= W - 6) continue;
        const e = elev[cellIdx(cand, y + dir)] + Math.abs(cand - x) * 0.008;
        if (e < be) { be = e; bx = cand; }
      }
      x = bx; y += dir;
    }
    if (path.length < 8) return null;
    let carved = 0;
    for (const p of path) {
      for (const dx of [0, 1]) {
        const xx = p.x + dx;
        if (xx < 2 || xx >= W - 2) continue;
        if (distC(xx, p.y, hs.cx, hs.cy) < 13 || distC(xx, p.y, as.cx, as.cy) < 13) continue;
        const i = cellIdx(xx, p.y);
        if (g.terrain[i] === T_GRASS || g.terrain[i] === T_DIRT) {
          g.terrain[i] = T_WATER;
          riverMask[i] = 1;
          carved++;
        }
      }
    }
    return carved >= 6 ? {} : null;
  }

  // Convert TWO adjacent river columns into a bridge deck (passable id 6).
  // With the river unbroken these ARE the crossings, so placement prefers
  // columns near the start↔start axis where the fighting happens. Two lanes
  // wide: a single-file deck wedged harvester traffic head-to-head.
  // `avoid` lists the x of already-built bridges (crossings spread out);
  // `loose` relaxes the span limits when a crossing MUST be found.
  function placeBridge(g, rng, riv, avoid, loose) {
    const W = C.MAP_W, H = C.MAP_H;
    const scan = loose ? 8 : 6, spanMax = loose ? 9 : 7;
    // The CONTIGUOUS water run under a column, nearest the river's own
    // centerline. Counting scattered water cells is how you get a bridge
    // spanning a whole meander of dry land: a candidate column must cross
    // ONE unbroken channel, nothing else.
    const colRun = x => {
      const yc = Math.round(riv.yc[x]);
      const y0 = Math.max(1, yc - scan), y1 = Math.min(H - 2, yc + scan);
      let best = null, run = null;
      for (let y = y0; y <= y1 + 1; y++) {
        const wet = y <= y1 && g.terrain[cellIdx(x, y)] === T_WATER;
        if (wet) { if (!run) run = { a: y, b: y }; else run.b = y; }
        else if (run) {
          const d = Math.min(Math.abs(run.a - yc), Math.abs(run.b - yc));
          if (!best || d < best.d) best = { a: run.a, b: run.b, d };
          run = null;
        }
      }
      return best;
    };
    const midX = (W / 2) | 0;
    const cand = [];
    for (let x = 8; x < W - 9; x++) {
      if (avoid && avoid.some(ax => Math.abs(x - ax) < 12)) continue;
      // both lanes must cross one clean channel of sane width, and the two
      // runs must actually overlap (same channel, not two arms of a bend)
      const r1 = colRun(x), r2 = colRun(x + 1);
      if (!r1 || !r2) continue;
      const l1 = r1.b - r1.a + 1, l2 = r2.b - r2.a + 1;
      if (l1 < 2 || l1 > spanMax || l2 < 2 || l2 > spanMax) continue;
      if (r1.b < r2.a || r2.b < r1.a) continue;   // disjoint runs
      const uTop = Math.min(r1.a, r2.a), uBot = Math.max(r1.b, r2.b);
      if (uBot - uTop + 1 > spanMax + 1) continue;
      cand.push({ x, uTop, uBot, dc: Math.abs(x - midX) });
    }
    if (!cand.length) return null;
    cand.sort((a, b) => a.dc - b.dc);
    const pick = cand[(rng() * Math.min(6, cand.length)) | 0];
    const yTop = pick.uTop, yBot = pick.uBot;
    // deck rectangle: two lanes running TWO cells past the water onto each
    // bank, so the span lands on solid ground instead of stopping at the
    // waterline — the painted abutments sit fully on the banks. `under`
    // remembers what each cell was, so the painter can keep the shoreline
    // running beneath the deck instead of retreating to the bridge ends.
    const y0 = Math.max(1, yTop - 2), y1 = Math.min(H - 2, yBot + 2);
    const cells = [], water = [], under = [];
    for (const bx of [pick.x, pick.x + 1]) {
      for (let y = y0; y <= y1; y++) {
        const idx = cellIdx(bx, y);
        if (g.terrain[idx] === T_WATER) water.push({ cx: bx, cy: y });
        under.push(g.terrain[idx]);
        g.terrain[idx] = T_BRIDGE;
        cells.push({ cx: bx, cy: y });
      }
    }
    // a crossing carries traffic: worn dirt approaches continue from the
    // deck ends, so the whole thing reads as one road over the river
    road(g, pick.x, Math.max(1, y0 - 3), pick.x, Math.max(1, y0 - 1));
    road(g, pick.x, Math.min(H - 2, y1 + 1), pick.x, Math.min(H - 2, y1 + 3));
    // control rooms on the banks, off to the side of each end: an engineer
    // sent inside rebuilds a fallen span (either bank's hut works)
    const huts = [];
    const tryHut = (cands) => {
      for (const [hx, hy] of cands) {
        if (hx < 1 || hx >= W - 1 || hy < 1 || hy >= H - 1) continue;
        const t = g.terrain[cellIdx(hx, hy)];
        if (t === T_GRASS || t === T_DIRT) { huts.push({ cx: hx, cy: hy }); return; }
      }
    };
    tryHut([[pick.x - 2, y0], [pick.x + 3, y0], [pick.x - 2, y0 + 1], [pick.x + 3, y0 + 1]]);
    tryHut([[pick.x - 2, y1], [pick.x + 3, y1], [pick.x - 2, y1 - 1], [pick.x + 3, y1 - 1]]);
    return { cells, rect: { cx: pick.x, cy: y0, w: 2, h: y1 - y0 + 1 }, water, under, huts };
  }

  // Ragged rocky rim, 1..3 cells deep, depth varying smoothly along each edge.
  // WATER at the rim stays water — a lake meeting the map edge reads as a bay
  // against the world's boundary, not a pool walled off by convenient crags.
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
    const rock = i => { if (g.terrain[i] !== T_WATER) g.terrain[i] = T_ROCK; };
    const top = series(W), bot = series(W), lef = series(H), rig = series(H);
    for (let x = 0; x < W; x++) {
      const dt = 1 + Math.round(top[x] * 2.2), db = 1 + Math.round(bot[x] * 2.2);
      for (let y = 0; y < dt; y++) rock(cellIdx(x, y));
      for (let y = 0; y < db; y++) rock(cellIdx(x, H - 1 - y));
    }
    for (let y = 0; y < H; y++) {
      const dl = 1 + Math.round(lef[y] * 2.2), dr = 1 + Math.round(rig[y] * 2.2);
      for (let x = 0; x < dl; x++) rock(cellIdx(x, y));
      for (let x = 0; x < dr; x++) rock(cellIdx(C.MAP_W - 1 - x, y));
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
    // the gate mouths are load-bearing gameplay: missions and cleanup passes
    // need to know where they are (walls, guns and clear footing go here)
    g.decor.gates = gates.map(ga => ({
      cx: clamp(Math.round(c.cx + Math.cos(ga) * 10.5), 1, C.MAP_W - 2),
      cy: clamp(Math.round(c.cy + Math.sin(ga) * 10.5), 1, C.MAP_H - 2),
    }));
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
  // `sparing` clears rock/trees but leaves WATER alone — with the river
  // unbroken, bridges must stay the only way across; the full carve is the
  // absolute last resort for a map that cannot otherwise connect.
  function carveCorridor(g, a, b, rad, sparing) {
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
          const tt = g.terrain[idx];
          if (sparing && tt === T_WATER) continue;
          if (isImpassId(tt)) g.terrain[idx] = T_GRASS;
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
    const sides = (g.sides || ['udc', 'srp']).slice();
    g.startPos[g.humanSide || 'udc'] = hs;
    let slot = 1;
    for (const s of sides) {
      if (s === (g.humanSide || 'udc')) continue;
      const pos = slot === 1 ? as : mkStart(slot);
      g.startPos[s] = pos;
      if (slot >= 2) starts.push(pos);
      slot++;
    }

    // --- the landform everything else reads ------------------------------------
    const elev = buildElevation(hseed);

    // --- river in the valley (most seeds) ---------------------------------------
    g.decor = { bridges: [], mesas: [], waterfall: null, village: null };
    const hasRiver = rng() < 0.62;
    const riverMask = new Uint8Array(n);   // river/tributary water (banks get no sand)
    let riv = null;
    if (hasRiver) {
      riv = river(g, rng, hs, as, elev, riverMask);
      // most river maps also get a spring-fed tributary, so the country
      // reads as a drainage, not a lone canal
      if (rng() < 0.65) tributary(g, rng, riv, hs, as, elev, riverMask);
      // the river is UNBROKEN, so bridges are the only crossings: always
      // try for two (loose retry if the water is awkward), sometimes three
      let b1 = placeBridge(g, rng, riv, []);
      if (!b1) b1 = placeBridge(g, rng, riv, [], true);
      if (b1) g.decor.bridges.push(b1);
      if (b1) {
        let b2 = placeBridge(g, rng, riv, [b1.rect.cx]);
        if (!b2) b2 = placeBridge(g, rng, riv, [b1.rect.cx], true);
        if (b2) g.decor.bridges.push(b2);
        if (b2 && rng() < 0.4) {
          const b3 = placeBridge(g, rng, riv, [b1.rect.cx, b2.rect.cx]);
          if (b3) g.decor.bridges.push(b3);
        }
      }
    }

    // --- ponds pool in genuine depressions ---------------------------------------
    {
      // depressions cluster on the river's own valley floor, so keep ponds
      // clear of the crossings — a pond fused onto a ford or bridge approach
      // would seal the very gap the river carver left open
      const crossings = [];
      for (const bi of g.decor.bridges) {
        const mid = bi.cells[(bi.cells.length / 2) | 0];
        crossings.push({ cx: mid.cx, cy: mid.cy });
        // control-room plots too: a pond flooding a hut drowns the repair crew
        for (const hc of bi.huts) crossings.push({ cx: hc.cx, cy: hc.cy });
      }
      const want = Math.round(((hasRiver ? 2 : 3) + ((rng() * 2) | 0)) * area);
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
        // the deepest depression always floods to a proper lake
        floodPond(g, rng, cands[i].cx, cands[i].cy, elev, starts,
          hasRiver ? null : riv, i === 0);
      }
      // water finished: knock the cell noise off every shoreline
      smoothShores(g);
    }

    // --- dirt on the dry flats and talus (mesas come after the woods) ------------
    const vals = Array.from(elev).sort((a, b) => a - b);
    const wd = waterDist(g);
    dryGround(g, elev, wd, vals[(vals.length * 0.72) | 0], hseed);

    // --- woods follow the moisture -----------------------------------------------
    woods(g, elev, wd, vals[(vals.length / 2) | 0], hseed);
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

    // --- mesas: rounded walkable highlands with ramp entrances -------------------
    // (after the woods so the stamping clears every tree off the tops)
    mesas(g, rng, elev, starts);

    // sand and marsh dress the water margins AFTER the woods claim theirs:
    // SANDY shores belong to the standing water — lakes, ponds and the sea —
    // while river banks stay earthen (grass/dirt/marsh); marsh pools in any
    // low wet ground. Both passable, both blended seamlessly by the painter.
    {
      const medE = vals[(vals.length / 2) | 0];
      const lakeNear = (cx, cy) => {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const x2 = cx + dx, y2 = cy + dy;
            if (x2 < 0 || y2 < 0 || x2 >= W || y2 >= H) continue;
            const j = cellIdx(x2, y2);
            if (g.terrain[j] === T_WATER && !riverMask[j]) return true;
          }
        }
        return false;
      };
      for (let cy = 1; cy < H - 1; cy++) {
        for (let cx = 1; cx < W - 1; cx++) {
          const i = cellIdx(cx, cy);
          const t = g.terrain[i];
          if (t !== T_GRASS && t !== T_DIRT) continue;
          if (wd[i] < 1 || wd[i] > 2) continue;
          if (distC(cx, cy, hs.cx, hs.cy) < 13 || distC(cx, cy, as.cx, as.cy) < 13) continue;
          if (elev[i] < medE && fbm(cx, cy, 9, 2, hseed ^ 0x33aa) > 0.52) {
            g.terrain[i] = T_MARSH;
          } else if (lakeNear(cx, cy)) {
            const f2 = fbm(cx, cy, 8, 2, hseed ^ 0x66b1);
            if ((wd[i] === 1 && f2 > 0.34) || (wd[i] === 2 && f2 > 0.60)) g.terrain[i] = T_SAND;
          }
        }
      }
    }

    // gallery woods must never seal the crossings: fell the trees at the
    // bridge ends (only trees — the banks stay banks)
    for (const bi of g.decor.bridges) {
      const bTop = bi.cells[0], bBot = bi.cells[bi.cells.length - 1];
      clearTrees(g, bTop.cx, bTop.cy - 1, 2.2);
      clearTrees(g, bBot.cx, bBot.cy + 1, 2.2);
    }

    // --- ragged rocky rim ---------------------------------------------------------
    borderFringe(g, rng);

    // --- constraints: buildable start zones + guaranteed corridors -------------
    // sparing carve: rock and trees give way, the river does NOT — crossings
    // stay bridge-only; the connectivity check below force-places a bridge
    // (or, in the absolute worst case, carves) if the map still won't connect
    for (const st of starts) clearZone(g, st.cx, st.cy, 12);
    for (let i = 0; i < starts.length; i++) {
      for (let j = i + 1; j < starts.length; j++) {
        carveCorridor(g, starts[i], starts[j], 1, true); // 3 cells wide
      }
    }

    // holdout: ring the player's plateau in rock, leaving three gated passes
    // (one facing the enemy — the carved corridor threads through it)
    if (opts.holdout) fortressRing(g, rng, hs, as);

    // --- hard map border ring: rock, except where water reaches the edge — the
    // lake then runs to the world's true boundary instead of hitting a rock lip
    {
      const rim = (bi, ni) => {
        g.terrain[bi] = (g.terrain[bi] === T_WATER || g.terrain[ni] === T_WATER) ? T_WATER : T_ROCK;
      };
      for (let x = 0; x < W; x++) {
        rim(cellIdx(x, 0), cellIdx(x, 1));
        rim(cellIdx(x, H - 1), cellIdx(x, H - 2));
      }
      for (let y = 0; y < H; y++) {
        rim(cellIdx(0, y), cellIdx(1, y));
        rim(cellIdx(W - 1, y), cellIdx(W - 2, y));
      }
    }

    // --- tiberium fields ---------------------------------------------------------
    // Fields only grow on cells reachable from the starts (later passes just
    // clear MORE terrain, so reachability can only widen after this point).
    const reach = reachMask(g, starts);
    const fieldCenters = [];   // every placed field's heart (spread checks)
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
      const homeC = [];
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
        // shore maps: "away from the enemy" points the SW start's field at
        // the future sea — hold every home field above the waterline
        const fx = clamp(Math.round(st.cx + dx * off), 2, W - 3);
        const fy = clamp(Math.round(st.cy + dy * off), 2, opts.shore ? H - 13 : H - 3);
        // 130..170 classic — the opening field carries the early game; on a
        // large map the next field is a longer trek, so home pockets run deeper
        const count = Math.round((130 + ((rng() * 41) | 0)) * (area > 1.5 ? 1.2 : 1));
        placeField(g, rng, fx, fy, count, starts, reach);
        homeC.push({ x: fx, y: fy });
      }
      // a SECOND pocket a short march out from each base: the natural first
      // expansion — far enough to need escorting, near enough to reach before
      // the war does
      for (let si = 0; si < starts.length; si++) {
        const st = starts[si];
        let bestE = null;
        for (let a = 0; a < 50; a++) {
          const ang = rng() * Math.PI * 2;
          const d = 12 + rng() * 5; // 12..17 cells out
          const fx = clamp(Math.round(st.cx + Math.cos(ang) * d), 3, W - 4);
          const fy = clamp(Math.round(st.cy + Math.sin(ang) * d), 3, opts.shore ? H - 13 : H - 4);
          // shore ops: boats put reinforcements ashore east of the southern
          // start — that landing lane stays crystal-free
          if (opts.shore && fx > hs.cx + 2 && fy > hs.cy - 6) continue;
          const ti = cellIdx(fx, fy);
          if ((g.terrain[ti] !== T_GRASS && g.terrain[ti] !== T_DIRT) || !reach[ti]) continue;
          if (distC(fx, fy, homeC[si].x, homeC[si].y) < 10) continue;
          let ok = true;
          for (const st2 of starts) {
            if (st2 !== st && distC(fx, fy, st2.cx, st2.cy) < 15) { ok = false; break; }
          }
          if (!ok) continue;
          let openN = 0;
          for (let dy2 = -4; dy2 <= 4; dy2++) {
            for (let dx2 = -4; dx2 <= 4; dx2++) {
              const x2 = fx + dx2, y2 = fy + dy2;
              if (x2 < 1 || y2 < 1 || x2 >= W - 1 || y2 >= H - 1) continue;
              const i2 = cellIdx(x2, y2);
              if ((g.terrain[i2] === T_GRASS || g.terrain[i2] === T_DIRT) && reach[i2]) openN++;
            }
          }
          if (!bestE || openN > bestE.openN) bestE = { x: fx, y: fy, openN };
        }
        if (bestE) {
          placeField(g, rng, bestE.x, bestE.y, 80 + ((rng() * 25) | 0), starts, reach);
          fieldCenters.push({ x: bestE.x, y: bestE.y });
        }
      }
    }
    // Medium fields beyond the home pockets, spread apart — chrysalite pools
    // in the valley floors, so of the valid spots we take the lowest-lying
    // one. The FIRST stays the classic contested prize near the map centre;
    // the rest scatter across the whole interior so the far country is worth
    // harvesting (and expanding toward) on any map size.
    const mids = Math.round((3 + ((rng() * 2) | 0)) * area); // 3..4 classic, 6..8 large
    for (let i = 0; i < mids; i++) {
      // blue pockets are a PRIZE, never a doorstep: worth double, they hand
      // whoever spawns beside one the game — so they keep real distance
      // from every base and must be sought out
      const isBlue = i === 0 || (area > 1.5 && i === 3);
      const minStartD = isBlue ? 24 : 15;
      let bestC = null;
      for (let a = 0; a < 40; a++) {
        const mx = i === 0 ? (W >> 1) + ((rng() * 25) | 0) - 12 : 6 + ((rng() * (W - 12)) | 0);
        const my = i === 0 ? (H >> 1) + ((rng() * 25) | 0) - 12
          : 6 + ((rng() * (H - 12 - (opts.shore ? 9 : 0))) | 0);
        // the field's heart must be open, reachable ground — a heart in a
        // pond or forest pocket gives placeField no cells and the "field"
        // shrivels to a speck
        const ti = cellIdx(mx, my);
        if ((g.terrain[ti] !== T_GRASS && g.terrain[ti] !== T_DIRT) || !reach[ti]) continue;
        if (opts.shore && mx > hs.cx + 2 && my > hs.cy - 6) continue;   // landing lane
        let ok = true;
        for (const st of starts) {
          if (distC(mx, my, st.cx, st.cy) < minStartD) { ok = false; break; }
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
      // fallback goes to the hs/as MIDPOINT, not the map center — on holdout
      // maps the center IS the player's fortress, and the old fallback parked
      // a blue field (blossom and all) in the middle of the base
      if (!bestC) bestC = { x: (hs.cx + as.cx) >> 1, y: (hs.cy + as.cy) >> 1, score: 0 };
      fieldCenters.push(bestC);
      // 50..80 classic; large maps grow each field a quarter richer — the
      // longer haul across a big map has to pay for itself
      const count = Math.round((50 + ((rng() * 31) | 0)) * (area > 1.5 ? 1.25 : 1));
      // the first (most contested) midfield is BLUE chrysalite — worth double
      // at the refinery; big maps hide a second blue pocket out in the wilds
      placeField(g, rng, bestC.x, bestC.y, count, starts, reach, isBlue);
    }

    // holdout: the plateau interior is a BASE, not a mine. One modest pocket
    // hugging the wall away from the enemy is all the crystal inside; every
    // other vein — and any blossom tree that would regrow one — is scrubbed,
    // and the three gate mouths are kept bare so walls and guns have footing.
    if (opts.holdout) {
      const pa = Math.atan2(hs.cy - as.cy, hs.cx - as.cx);
      const pc = {
        x: clamp(Math.round(hs.cx + Math.cos(pa) * 6), 2, W - 3),
        y: clamp(Math.round(hs.cy + Math.sin(pa) * 6), 2, H - 3),
      };
      for (let cy2 = Math.max(1, hs.cy - 13); cy2 <= Math.min(H - 2, hs.cy + 13); cy2++) {
        for (let cx2 = Math.max(1, hs.cx - 13); cx2 <= Math.min(W - 2, hs.cx + 13); cx2++) {
          if (distC(cx2, cy2, hs.cx, hs.cy) > 12.5) continue;
          const i2 = cellIdx(cx2, cy2);
          // NO blossom survives inside — a regrowing heart would slowly
          // recarpet the build space the scrub just reclaimed. The pocket
          // is finite by design ("it will not carry you fifteen minutes").
          if (g.terrain[i2] === T_BLOSSOM) g.terrain[i2] = T_GRASS;
          if (distC(cx2, cy2, pc.x, pc.y) <= 4.2) continue;   // the pocket's crystal survives
          g.tib[i2] = 0;
          if (g.tibType) g.tibType[i2] = 0;
        }
      }
      for (const gt of (g.decor.gates || [])) {
        for (let dy = -4; dy <= 4; dy++) {
          for (let dx = -4; dx <= 4; dx++) {
            if (dx * dx + dy * dy > 18) continue;
            const x2 = gt.cx + dx, y2 = gt.cy + dy;
            if (x2 < 1 || y2 < 1 || x2 >= W - 1 || y2 >= H - 1) continue;
            const i2 = cellIdx(x2, y2);
            g.tib[i2] = 0;
            if (g.tibType) g.tibType[i2] = 0;
            if (g.terrain[i2] === T_BLOSSOM || g.terrain[i2] === T_TREE) g.terrain[i2] = T_GRASS;
          }
        }
      }
    }

    // guaranteed tiberium-free route between the bases (mirrors the always-
    // passable corridors carved above)
    for (let i = 0; i < starts.length; i++) {
      for (let j = i + 1; j < starts.length; j++) {
        clearTibCorridor(g, starts[i], starts[j], 2);
      }
    }

    // --- bridge control rooms stay unobstructed ---------------------------------
    // Woods, crags, mesa rings and crystal fields all come after the bridges
    // are sited, so scrub the hut plots LAST: the repair engineer must always
    // have a clear doorway
    for (const bi of g.decor.bridges) {
      for (const hc of bi.huts) {
        const hi = cellIdx(hc.cx, hc.cy);
        if (g.terrain[hi] === T_WATER) g.terrain[hi] = T_GRASS;   // a pond drowned the plot
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = hc.cx + dx, y = hc.cy + dy;
            if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
            const i = cellIdx(x, y);
            const t = g.terrain[i];
            if (t === T_TREE || t === T_ROCK || t === T_BLOSSOM) g.terrain[i] = T_GRASS;
            g.tib[i] = 0;
            if (g.tibType) g.tibType[i] = 0;
          }
        }
        // still walled in (a lake lapped every side): drain a doorway
        let open = 0;
        const doors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dy] of doors) {
          const t = g.terrain[cellIdx(hc.cx + dx, hc.cy + dy)];
          if (t === T_GRASS || t === T_DIRT || t === T_BRIDGE || t >= T_SAND) open++;
        }
        if (open === 0) {
          for (const [dx, dy] of doors) {
            const i = cellIdx(hc.cx + dx, hc.cy + dy);
            if (g.terrain[i] === T_WATER) { g.terrain[i] = T_GRASS; break; }
          }
        }
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

    // --- shore missions: a SEA along the whole southern edge -------------------
    // The staged-landing ops come ashore here: a rolling coastline of open
    // water below a two-row sand beach, kept bare of crystal, rock and trees
    // so boats have somewhere honest to land. Carved late (after fields) so
    // nothing creeps back over the waterline; its own rng stream leaves every
    // other feature of the seed untouched. The connectivity/reach passes
    // below run AFTER the flood, so they respect the new coast.
    if (opts.shore) {
      const srng = mulberry((hseed ^ 0x5eaf00d) >>> 0);
      let depth = 4 + ((srng() * 3) | 0);           // 4..6 rows of water
      for (let x = 0; x < W; x++) {
        const roll = srng();
        depth = clamp(depth + (roll < 0.3 ? -1 : roll > 0.7 ? 1 : 0), 3, 7);
        const top = H - depth;                       // first water row
        for (let y = top; y < H; y++) {
          const idx = cellIdx(x, y);
          g.terrain[idx] = T_WATER;
          g.tib[idx] = 0; g.tibType[idx] = 0;
        }
        for (let y = Math.max(1, top - 2); y < top; y++) {
          const idx = cellIdx(x, y);
          if (g.terrain[idx] !== T_WATER) g.terrain[idx] = T_SAND;   // the beach
          g.tib[idx] = 0; g.tibType[idx] = 0;
        }
      }
      smoothShores(g);
    }

    // --- validate connectivity; escalate gently -------------------------------
    // 1) wider sparing carve (rock/trees only), 2) force one more bridge over
    // the river, 3) full carve — the only case that may ever cut water, kept
    // as the cannot-fail floor under everything above
    for (const st of starts) {
      if (st === hs) continue;
      if (!connected(g, hs, st)) {
        carveCorridor(g, hs, st, 2, true); // 5 wide, water untouched
        if (!connected(g, hs, st) && riv) {
          const bf = placeBridge(g, rng, riv, g.decor.bridges.map(b => b.rect.cx), true);
          if (bf) g.decor.bridges.push(bf);
        }
        if (!connected(g, hs, st)) carveCorridor(g, hs, st, 3); // cannot fail
      }
    }

    // --- stitch orphan land -------------------------------------------------------
    // Rock and woods can wall off whole pockets of good ground (likelier on
    // the bigger maps). Any sizable sealed region gets a dirt lane punched
    // through the rock/trees to the mainland. Water is never crossed — true
    // islands keep their moats and bridges stay the only river crossings.
    {
      let reachM = reachMask(g, [hs]);
      const seenR = new Uint8Array(n);
      for (let i0 = 0; i0 < n; i0++) {
        if (seenR[i0] || reachM[i0] || isImpassId(g.terrain[i0])) continue;
        const region = [];
        const q2 = [i0]; seenR[i0] = 1;
        while (q2.length) {
          const j = q2.pop(); region.push(j);
          const x = j % W, y = (j / W) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const xx = x + dx, yy = y + dy;
            if (xx < 1 || yy < 1 || xx >= W - 1 || yy >= H - 1) continue;
            const k = cellIdx(xx, yy);
            if (!seenR[k] && !reachM[k] && !isImpassId(g.terrain[k])) { seenR[k] = 1; q2.push(k); }
          }
        }
        if (region.length < 40) continue;
        // multi-source BFS from the region through anything but water until
        // the wave touches the mainland, then carve that path to dirt
        const par = new Int32Array(n).fill(-1);
        const inQ = new Uint8Array(n);
        let wave = [];
        for (const j of region) { inQ[j] = 1; wave.push(j); }
        let hit = -1;
        while (wave.length && hit < 0) {
          const next = [];
          for (const j of wave) {
            const x = j % W, y = (j / W) | 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const xx = x + dx, yy = y + dy;
              if (xx < 1 || yy < 1 || xx >= W - 1 || yy >= H - 1) continue;
              const k = cellIdx(xx, yy);
              if (inQ[k]) continue;
              const tt = g.terrain[k];
              if (tt === T_WATER || tt === T_BRIDGE) continue;
              inQ[k] = 1; par[k] = j; next.push(k);
              if (reachM[k]) { hit = k; break; }
            }
            if (hit >= 0) break;
          }
          wave = next;
        }
        if (hit < 0) continue;   // an island — leave its moat alone
        for (let j = hit; j >= 0; j = par[j]) {
          const x = j % W, y = (j / W) | 0;
          for (let dy2 = 0; dy2 <= 1; dy2++) {
            for (let dx2 = 0; dx2 <= 1; dx2++) {
              const x2 = x + dx2, y2 = y + dy2;
              if (x2 < 1 || y2 < 1 || x2 >= W - 1 || y2 >= H - 1) continue;
              const j2 = cellIdx(x2, y2);
              if (g.terrain[j2] === T_ROCK || g.terrain[j2] === T_TREE) g.terrain[j2] = T_DIRT;
            }
          }
        }
        reachM = reachMask(g, [hs]);   // the new lane may have joined more land
      }
    }

    // --- every mesa top must be climbable ---------------------------------------
    // If both ramps opened into sealed pouches (a lakeside pocket, a walled
    // wood), cut one more dirt lane from the top to the nearest ground the
    // player can actually reach. Lanes never cross water — bridges stay the
    // only crossings; a truly landlocked mesa keeps its mystery.
    {
      const reachM = reachMask(g, [hs]);
      for (const ms of g.decor.mesas) {
        if (ms.top.some(i => reachM[i])) continue;
        const cands = [];
        const R2 = Math.ceil(ms.r * 1.26 + 5);
        for (let dy = -R2; dy <= R2; dy++) {
          for (let dx = -R2; dx <= R2; dx++) {
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < ms.r * 1.26 + 1 || d > R2) continue;
            const x = ms.cx + dx, y = ms.cy + dy;
            if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue;
            if (reachM[cellIdx(x, y)]) cands.push({ x, y, d });
          }
        }
        cands.sort((a, b) => a.d - b.d);
        for (const c of cands) {
          const steps = Math.max(1, Math.ceil(distC(ms.cx, ms.cy, c.x, c.y)) * 2);
          let wet = false;
          for (let s2 = 0; s2 <= steps && !wet; s2++) {
            const t2 = s2 / steps;
            const px = Math.round(ms.cx + (c.x - ms.cx) * t2);
            const py = Math.round(ms.cy + (c.y - ms.cy) * t2);
            const tt = g.terrain[cellIdx(px, py)];
            if (tt === T_WATER || tt === T_BRIDGE) wet = true;
          }
          if (wet) continue;
          for (let s2 = 0; s2 <= steps; s2++) {
            const t2 = s2 / steps;
            const px = Math.round(ms.cx + (c.x - ms.cx) * t2);
            const py = Math.round(ms.cy + (c.y - ms.cy) * t2);
            for (let dy2 = 0; dy2 <= 1; dy2++) {
              for (let dx2 = 0; dx2 <= 1; dx2++) {
                const x2 = px + dx2, y2 = py + dy2;
                if (x2 < 2 || y2 < 2 || x2 >= W - 2 || y2 >= H - 2) continue;
                const j2 = cellIdx(x2, y2);
                const tt = g.terrain[j2];
                if (tt === T_ROCK || tt === T_TREE) g.terrain[j2] = T_DIRT;
              }
            }
          }
          break;
        }
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
      // on shore maps the scan stops above the sea band, or the "waterfall"
      // would pour out of the ocean
      const yMax = opts.shore ? H - 10 : H - 1;
      outer:
      for (let x = 1; x < 10; x++) {
        for (let y = 1; y < yMax; y++) {
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
      const b0 = g.decor.bridges[0];
      const bx = b0 ? b0.cells[(b0.cells.length / 2) | 0] : null;
      // two passes: the strict one wants virgin ground; on crystal-crowded
      // maps (fields multiplied) the fallback may claim a fielded patch —
      // the settlers clear it (tib zeroed under the hamlet)
      for (const allowTib of [false, true]) {
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
              if ((t !== T_GRASS && t !== T_DIRT) || (!allowTib && g.tib[idx] > 0) || !reach2[idx]) { ok = false; break; }
            }
          }
          if (!ok) continue;
          const score = bx ? -distC(vx + 4, vy + 3, bx.cx, bx.cy) : -Math.abs(vx - (W >> 1)) - Math.abs(vy - (H >> 1));
          if (score > bestScore) { bestScore = score; best = { vx, vy }; }
        }
        if (best) break;
      }
      if (best) {
        for (let dy = 0; dy < 7; dy++) {
          for (let dx = 0; dx < 8; dx++) g.tib[cellIdx(best.vx + dx, best.vy + dy)] = 0;
        }
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
        if (g.decor.bridges.length) {
          // the NEAREST bridge — the village grew at its crossroads
          let bd = Infinity;
          for (const bn of g.decor.bridges) {
            const mid = bn.cells[(bn.cells.length / 2) | 0];
            const d = distC(mid.cx, mid.cy, vcx, vcy);
            if (d < bd) { bd = d; crossing = { cx: mid.cx, cy: mid.cy }; }
          }
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
      // bridges are the crossings now — depots gravitate to them
      for (const bn of g.decor.bridges.slice(0, 2)) {
        const mid = bn.cells[(bn.cells.length / 2) | 0];
        anchors.push({ cx: mid.cx, cy: mid.cy });
      }
      while (anchors.length < 2) anchors.push({ cx: W >> 1, cy: H >> 1 });
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
