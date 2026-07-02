// post.js — turn raw Blender renders into engine-ready sprite sheets.
// Crops/anchors each frame using the projection metadata from render_sprites.py,
// downsamples 4x with area averaging, quantizes colors (posterize), converts
// soft shadow alpha into a uniform stencil shadow, adds a 1px dark outline,
// and writes PNG sheets + assets/manifest.json.
//
// Run:  node tools/render3d/post.js [rawDir] [outDir]
//       (defaults: /tmp/render3d_raw -> <repo>/assets)

const { chromium } = require('/tmp/claude-0/-home-user-cnc-fable5/e825cc32-0b9a-5267-822c-3cc4ffe33dfc/scratchpad/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const RAW = process.argv[2] || '/tmp/render3d_raw';
const OUT = process.argv[3] || path.join(__dirname, '..', '..', 'assets');
fs.mkdirSync(OUT, { recursive: true });

const meta = JSON.parse(fs.readFileSync(path.join(RAW, 'meta.json'), 'utf8'));

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.setContent('<canvas id="c"></canvas>');

  // all raw images as data urls
  const rawData = {};
  for (const f of fs.readdirSync(RAW)) {
    if (f.endsWith('.png')) {
      rawData[f.replace('.png', '')] = 'data:image/png;base64,' +
        fs.readFileSync(path.join(RAW, f)).toString('base64');
    }
  }

  const result = await page.evaluate(async ({ meta, rawData }) => {
    const imgs = {};
    await Promise.all(Object.keys(rawData).map(k => new Promise(res => {
      const im = new Image();
      im.onload = () => { imgs[k] = im; res(); };
      im.src = rawData[k];
    })));

    function mk(w, h) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    }

    // downsample a source rect to (fw x fh) with smoothing (area-ish average),
    // then post-process: posterize colors, stencil the shadow, outline edges.
    function bake(img, sx, sy, sw, sh, fw, fh) {
      const c = mk(fw, fh);
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, sx, sy, sw, sh, 0, 0, fw, fh);
      const id = g.getImageData(0, 0, fw, fh);
      const d = id.data;
      const solid = new Uint8Array(fw * fh);
      for (let i = 0; i < fw * fh; i++) {
        const a = d[i * 4 + 3];
        if (a > 190) {
          solid[i] = 1;
          // saturation push around luma, then posterize to chunky levels
          const luma = 0.3 * d[i * 4] + 0.55 * d[i * 4 + 1] + 0.15 * d[i * 4 + 2];
          for (let ch = 0; ch < 3; ch++) {
            let v = luma + (d[i * 4 + ch] - luma) * 1.35;
            v = Math.round((v / 255) * 8) / 8 * 255;
            d[i * 4 + ch] = Math.max(0, Math.min(255, v));
          }
          d[i * 4 + 3] = 255;
        } else if (a > 26) {
          // soft renderer shadow -> uniform stencil shadow
          d[i * 4] = 6; d[i * 4 + 1] = 6; d[i * 4 + 2] = 10;
          d[i * 4 + 3] = 88;
        } else {
          d[i * 4 + 3] = 0;
        }
      }
      // 1px darkened outline on solid pixels that touch non-solid
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const i = y * fw + x;
          if (!solid[i]) continue;
          let edge = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= fw || ny >= fh || !solid[ny * fw + nx]) {
              edge = true;
              break;
            }
          }
          if (edge) {
            d[i * 4] *= 0.45; d[i * 4 + 1] *= 0.45; d[i * 4 + 2] *= 0.45;
          }
        }
      }
      g.putImageData(id, 0, 0);
      return c;
    }

    const sheets = {};   // name -> dataURL
    const manifest = { sprites: {} };

    // ---- vehicles: 16 frames in one row -------------------------------------
    function vehicleSheet(key, baseName) {
      const m = meta.frames[baseName + '_00'] ? null : meta.frames[baseName]; // meta stored once
      const info = meta.frames[baseName];
      const raw = info.raw, fw = Math.round(raw / meta.ss), fh = fw;
      const sheet = mk(fw * 16, fh);
      const g = sheet.getContext('2d');
      for (let i = 0; i < 16; i++) {
        const img = imgs[baseName + '_' + String(i).padStart(2, '0')];
        g.drawImage(bake(img, 0, 0, raw, raw, fw, fh), i * fw, 0);
      }
      sheets[baseName + '.png'] = sheet.toDataURL('image/png');
      return { frame: [fw, fh], sheet: baseName + '.png' };
    }

    manifest.sprites.mtnk = {
      kind: 'vehicle',
      body: vehicleSheet('mtnk', 'mtnk_body'),
      turret: vehicleSheet('mtnk', 'mtnk_turret'),
    };

    // ---- buildings: crop so the footprint lands exactly on w*24 x h*24 ------
    function buildingSheet(key) {
      const info = meta.frames[key];
      const img = imgs[key];
      const fpW = info.w * 24, fpH = info.h * 24;
      const finalW = fpW, finalH = info.yOff + fpH + info.bib;
      const scale = fpW / (info.se[0] - info.nw[0]);      // final px per raw px
      const sx = info.nw[0];
      const sy = info.nw[1] - info.yOff / scale;
      const sw = finalW / scale;
      const sh = finalH / scale;
      const c = bake(img, sx, sy, sw, sh, finalW, finalH);
      sheets[key + '.png'] = c.toDataURL('image/png');
      return { kind: 'building', sheet: key + '.png', w: info.w, h: info.h,
               yOff: info.yOff, bib: info.bib, size: [finalW, finalH] };
    }

    manifest.sprites.fact = buildingSheet('fact');
    manifest.sprites.obli = buildingSheet('obli');

    return { sheets, manifest };
  }, { meta, rawData });

  for (const name in result.sheets) {
    const b64 = result.sheets[name].split(',')[1];
    fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, 'base64'));
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(result.manifest, null, 1));
  console.log('POST COMPLETE ->', OUT, Object.keys(result.sheets).join(', '));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
