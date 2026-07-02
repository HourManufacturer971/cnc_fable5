'use strict';
// assets.js — optional pre-rendered sprite loader.
// If assets/manifest.json exists (produced by the Blender pipeline in
// tools/render3d/), the sheets it lists REPLACE the procedural art for those
// keys. Missing manifest/sheets = silent fallback to the procedural sprites.
// Disable explicitly with ?noassets=1 (handy for A/B comparison).

(function () {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return;
  // Hi-res pre-rendered sheets load by default; ?noassets=1 falls back to the
  // procedural art for comparison.
  try {
    if (new URLSearchParams(location.search).get('noassets')) return;
  } catch (e) { /* no location in odd embeddings */ }

  function loadImg(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });
  }

  function slice(img, i, fw, fh) {
    const c = mkCanvas(fw, fh);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(img, i * fw, 0, fw, fh, 0, 0, fw, fh);
    c._hires = true; // pre-rendered at 48px/cell: render draws it 1:1
    return c;
  }

  function copyCanvas(src) {
    const c = mkCanvas(src.width, src.height);
    c.getContext('2d').drawImage(src, 0, 0);
    c._hires = src._hires;
    return c;
  }

  // damaged variant: soot smears + crack pixels clipped to the sprite silhouette
  function damage(src, seed) {
    const c = copyCanvas(src);
    const g = c.getContext('2d');
    const rnd = mulberry(seed);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(20,16,10,0.28)';
    g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < c.width * c.height / 30; i++) {
      const x = (rnd() * c.width) | 0, y = (rnd() * c.height) | 0;
      g.fillStyle = rnd() < 0.6 ? 'rgba(0,0,0,0.5)' : 'rgba(255,120,40,0.35)';
      g.fillRect(x, y, 1 + (rnd() * 2 | 0), 1);
    }
    return c;
  }

  // obelisk charge glow: brightening tip overlay
  function chargeFrame(src, level) {
    const c = copyCanvas(src);
    const g = c.getContext('2d');
    const tip = ['rgba(255,90,60,0.35)', 'rgba(255,140,100,0.55)', 'rgba(255,230,210,0.8)'][level - 1];
    g.fillStyle = tip;
    g.fillRect(c.width / 2 - 6, 0, 12, 20 + level * 8);
    g.fillStyle = 'rgba(255,60,40,' + (0.10 * level) + ')';
    g.fillRect(c.width / 2 - 11, 0, 22, 52);
    return c;
  }

  // simple cameo from the rendered art (keeps the sidebar layout conventions)
  function cameoFrom(src, name) {
    const c = mkCanvas(128, 96);
    const g = c.getContext('2d');
    g.fillStyle = PAL.cameoBg;
    g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#1e1e19';
    for (let y = 0; y < 76; y += 4) g.fillRect(0, y, 128, 2);
    const scale = Math.min(112 / src.width, 68 / src.height) * 1.35;
    const w = src.width * scale, h = src.height * scale;
    g.imageSmoothingEnabled = false;
    g.drawImage(src, (128 - w) / 2, Math.max(2, 72 - h), w, h);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(0, 72, 128, 16);
    g.font = '13px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = PAL.uiText;
    g.fillText(name, 64, 80, 124);
    g.fillStyle = PAL.uiGold;
    g.fillRect(0, 88, 128, 8);
    g.fillStyle = '#000';
    g.fillRect(0, 0, 128, 2); g.fillRect(0, 94, 128, 2);
    g.fillRect(0, 0, 2, 96); g.fillRect(126, 0, 2, 96);
    return c;
  }

  async function boot() {
    let manifest;
    try {
      const r = await fetch('assets/manifest.json');
      if (!r.ok) return;
      manifest = await r.json();
    } catch (e) { return; }
    if (!manifest || !manifest.sprites) return;

    for (const key of Object.keys(manifest.sprites)) {
      const s = manifest.sprites[key];
      try {
        if (s.kind === 'vehicle') {
          const [bodyImg, turretImg] = await Promise.all([
            loadImg('assets/' + s.body.sheet),
            s.turret ? loadImg('assets/' + s.turret.sheet) : null,
          ]);
          const entry = { body: [] };
          for (let i = 0; i < 16; i++) entry.body.push(slice(bodyImg, i, s.body.frame[0], s.body.frame[1]));
          if (turretImg) {
            entry.turret = [];
            for (let i = 0; i < 16; i++) entry.turret.push(slice(turretImg, i, s.turret.frame[0], s.turret.frame[1]));
          }
          SPRITES.units[key] = { gdi: entry, nod: entry, mut: entry };
          SPRITES.cameo[key] = cameoFrom(entry.body[10], DATA.units[key].name);
        } else if (s.kind === 'building') {
          const img = await loadImg('assets/' + s.sheet);
          const frame = copyCanvas(img);
          frame._hires = true;
          const entry = {
            normal: [frame],
            damaged: [damage(frame, 1234 + key.length)],
            yOff: s.yOff,
          };
          if (key === 'obli') entry.charge = [1, 2, 3].map(l => chargeFrame(frame, l));
          SPRITES.buildings[key] = { gdi: entry, nod: entry, mut: entry };
          SPRITES.cameo[key] = cameoFrom(frame, DATA.buildings[key].name);
        }
      } catch (e) { /* sheet missing/broken: keep procedural art for this key */ }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
