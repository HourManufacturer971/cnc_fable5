'use strict';
// fog.js — permanent-reveal black shroud (Tiberian Dawn style). Global: Fog.
// Accepts both (game, ...) and bare (...) call shapes per SPEC.

const Fog = (function () {

  function init(g) {
    g = g || game;
    g.shroud.fill(0);
    if (g.visible) g.visible.fill(0);
  }

  function revealCircle(a, b, c, d) {
    let g, cx, cy, r;
    if (typeof a === 'number') { g = game; cx = a; cy = b; r = c; }
    else { g = a || game; cx = b; cy = c; r = d; }
    if (!g) return;
    const rr = (r + 0.5) * (r + 0.5);
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(C.MAP_W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(C.MAP_H - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= rr) {
          const i = cellIdx(x, y);
          g.shroud[i] = 1;               // permanent reveal (classic shroud)
          if (g.visible) g.visible[i] = 1; // live line-of-sight this pass
        }
      }
    }
  }

  function update(g) {
    g = g || game;
    if (!g) return;
    if (g.tick % 5 !== 0 && g.tick > 0) return;
    if (g.visible) g.visible.fill(0);
    const side = g.humanSide;
    for (const u of g.units.values()) {
      if (u.owner !== side) continue;
      revealCircle(g, worldToCell(u.x), worldToCell(u.y), DATA.units[u.type].sight);
    }
    for (const b of g.buildings.values()) {
      if (b.owner !== side) continue;
      const d = DATA.buildings[b.type];
      revealCircle(g, b.cx + (d.w - 1) / 2, b.cy + (d.h - 1) / 2,
        d.sight + Math.max(d.w, d.h) / 2);
    }
  }

  function isExplored(a, b, c) {
    let g, cx, cy;
    if (typeof a === 'number') { g = game; cx = a; cy = b; }
    else { g = a || game; cx = b; cy = c; }
    if (!g || !inMap(cx, cy)) return false;
    return g.shroud[cellIdx(cx, cy)] === 1;
  }

  return { init, revealCircle, update, isExplored };
})();
