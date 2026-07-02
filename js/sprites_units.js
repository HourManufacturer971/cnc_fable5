'use strict';
// sprites_units.js — procedurally drawn VEHICLE and AIRCRAFT sprites + sidebar cameos.
// Fills SPRITES.units[key][side] ({body:[16], turret?:[16], anim?:[...]}) and
// SPRITES.cameo[key] for: jeep bggy bike apc ltnk mtnk htnk ftnk stnk arty msam
// harv mcv orca heli. Every unit is generated for BOTH sides ('gdi' gold/tan,
// 'nod' grey+red) since captures/spawns can mix ownership.
// All art is original, drawn at 1x with integer fillRect pixels, dark PAL.outline
// silhouettes, light source top-left, then rotated to 16 facings via rotFrames.
// Materials use 3-4 shade ramps (hi/light/hull/mid/shadow) for the chunky
// mid-90s VGA look; tracked vehicles show alternating track links, wheeled
// vehicles rubber tires with hub dots, and each faction carries a tiny
// insignia (GDI gold star / Nod crimson chevron).

(function () {
  // Defensive boot: needs DOM (canvas) plus core.js/data.js globals.
  if (typeof document === 'undefined') return;
  if (typeof SPRITES === 'undefined' || typeof DATA === 'undefined' ||
      typeof PAL === 'undefined' || typeof mkCanvas !== 'function' ||
      typeof rotFrames !== 'function') return;

  const OUT = PAL.outline;

  // Local material shades (extra hex tones in the PAL family).
  const TIRE = '#23231c', TIRE_L = '#4c4c42', HUB = '#96968c';
  const TRK = '#1b1b14', TRK_L = '#5a5a4e', TRK_M = '#35352c';
  const GUN = '#484850', GUN_L = '#8e8e9c', GUN_D = '#26262c';
  const GLASS = '#28587e', GLASS_L = '#9adcf8', GLASS_D = '#173a56';
  const WHITE = '#f4f4ea';

  // ---- per-side palettes (tones from PAL + local ramps, one set look) --------
  const SIDE_PAL = {
    gdi: {
      side: 'gdi',
      hull: PAL.gdi, dark: PAL.gdiDark, light: PAL.gdiLight, shadow: PAL.gdiShadow,
      hi: '#f8ecc0', mid: '#ac8e3e',
      track: TRK, tread: TRK_M,
      accent: PAL.uiGold, accent2: PAL.fire1,
      glass: GLASS, glint: GLASS_L,
      metal: GUN, metalL: GUN_L,
    },
    nod: {
      side: 'nod',
      hull: PAL.nod, dark: PAL.nodDark, light: PAL.nodLight, shadow: PAL.nodShadow,
      hi: '#d8d8e2', mid: '#70707a',
      track: TRK, tread: TRK_M,
      accent: PAL.nodRed, accent2: PAL.nodRedLight,
      glass: GLASS, glint: GLASS_L,
      metal: GUN, metalL: GUN_L,
    },
  };

  // ---- tiny draw helpers -----------------------------------------------------
  function R(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }
  function px(g, x, y, c) { R(g, x, y, 1, 1, c); }

  // rectangular part with a 1px dark outline around the fill area
  function block(g, x, y, w, h, fill) {
    R(g, x - 1, y - 1, w + 2, h + 2, OUT);
    R(g, x, y, w, h, fill);
  }

  // 1px-chamfered ("rounded") part with outline; (x,y,w,h) is the fill area
  function roundBlock(g, x, y, w, h, fill) {
    R(g, x + 1, y - 1, w - 2, h + 2, OUT);
    R(g, x - 1, y + 1, w + 2, h - 2, OUT);
    R(g, x, y, w, h, OUT);
    R(g, x + 1, y, w - 2, h, fill);
    R(g, x, y + 1, w, h - 2, fill);
  }

  // standard 4-ramp panel shading over an already-filled hull block:
  // sun-lit top-left edge, hi corner sparkle, mid right column, dark bottom.
  function shade(g, P, x, y, w, h) {
    R(g, x, y, w, 1, P.light);
    R(g, x, y, 1, h, P.light);
    px(g, x, y, P.hi);
    R(g, x + w - 1, y + 1, 1, h - 1, P.mid);
    R(g, x + 1, y + h - 1, w - 1, 1, P.shadow);
  }

  // sparse checker dither of colour c inside a region (surface texture)
  function dith(g, x, y, w, h, c) {
    for (let j = 0; j < h; j++)
      for (let i = (j & 1); i < w; i += 2) R(g, x + i, y + j, 1, 1, c);
  }

  // vertical track assembly: outlined dark rubber with alternating link rows
  function treads(g, x, y, w, h) {
    R(g, x - 1, y - 1, w + 2, h + 2, OUT);
    R(g, x, y, w, h, TRK);
    for (let ty = y; ty < y + h; ty += 2) R(g, x, ty, w, 1, TRK_M);
    for (let ty = y; ty < y + h; ty += 4) R(g, x, ty, w, 1, TRK_L);
    px(g, x, y, TRK_L); px(g, x, y + h - 1, TRK_L); // sprocket glints
  }

  // rubber tire with top highlight + hub dot
  function wheel(g, x, y, w, h) {
    R(g, x - 1, y - 1, w + 2, h + 2, OUT);
    R(g, x, y, w, h, TIRE);
    R(g, x, y, w, 1, TIRE_L);
    px(g, x + (w >> 1), y + (h >> 1), HUB);
  }

  // faction insignia: GDI = tiny gold star w/ white core, Nod = crimson chevron
  function emblem(g, P, x, y) {
    if (P.side === 'gdi') {
      R(g, x - 1, y, 3, 1, PAL.uiGold);
      R(g, x, y - 1, 1, 3, PAL.uiGold);
      px(g, x, y, WHITE);
    } else {
      px(g, x - 1, y - 1, PAL.nodRed);
      px(g, x + 1, y - 1, PAL.nodRed);
      px(g, x, y, PAL.nodRedLight);
    }
  }

  // ---- canonical NORTH-facing bodies (24x24) ---------------------------------
  const DRAW = {

    // Hum-Vee: 4x4 scout — bumper + headlights, hood, windshield, roof MG, bed.
    jeep(g, P) {
      wheel(g, 4, 6, 3, 4); wheel(g, 17, 6, 3, 4);
      wheel(g, 4, 15, 3, 4); wheel(g, 17, 15, 3, 4);
      block(g, 8, 5, 8, 15, P.hull);
      shade(g, P, 8, 5, 8, 15);
      dith(g, 13, 6, 2, 12, P.mid);
      R(g, 9, 3, 6, 1, OUT); R(g, 9, 4, 6, 1, GUN);     // front bumper
      px(g, 9, 4, GUN_L);
      px(g, 9, 5, PAL.fire1); px(g, 14, 5, PAL.fire1);  // headlights
      R(g, 9, 8, 6, 1, P.dark);                         // hood seam
      R(g, 9, 9, 6, 2, P.glass); R(g, 9, 9, 2, 1, P.glint); // windshield
      R(g, 9, 16, 6, 3, P.dark);                        // rear bed
      R(g, 9, 16, 6, 1, P.shadow);
      emblem(g, P, 12, 17);
      block(g, 11, 12, 2, 2, GUN_D);                    // gun mount
      block(g, 11, 7, 2, 5, GUN); R(g, 11, 7, 1, 5, GUN_L); // roof MG
    },

    // Nod Buggy: fat tires, narrow angular hull, cage MG, big rear engine.
    bggy(g, P) {
      wheel(g, 4, 5, 3, 4); wheel(g, 17, 5, 3, 4);      // small front tires
      wheel(g, 3, 13, 4, 6); wheel(g, 17, 13, 4, 6);    // fat rear tires
      block(g, 9, 4, 6, 16, P.hull);
      shade(g, P, 9, 4, 6, 16);
      px(g, 9, 4, OUT); px(g, 14, 4, OUT);              // tapered nose
      px(g, 9, 5, OUT); px(g, 14, 5, OUT);
      R(g, 11, 4, 2, 1, P.light);
      R(g, 10, 7, 4, 2, P.glass); px(g, 10, 7, P.glint); // windscreen
      R(g, 9, 12, 6, 1, P.dark);                        // roll bar
      R(g, 10, 13, 4, 6, P.dark);                       // engine deck
      R(g, 10, 13, 4, 1, P.shadow);
      R(g, 10, 15, 4, 1, P.shadow); R(g, 10, 17, 4, 1, P.shadow); // vents
      emblem(g, P, 12, 16);                             // deck chevron
      px(g, 9, 19, GUN_L); px(g, 14, 19, GUN_L);        // exhaust tips
      block(g, 11, 10, 2, 2, GUN_D);                    // cage mount
      block(g, 11, 6, 2, 4, GUN); R(g, 11, 6, 1, 4, GUN_L); // MG
    },

    // Recon Bike: narrow two-wheeler, leaning rider, flanking missile pods.
    bike(g, P) {
      block(g, 11, 2, 2, 5, TIRE); R(g, 11, 2, 2, 1, TIRE_L); px(g, 11, 4, HUB);
      block(g, 11, 17, 2, 5, TIRE); R(g, 11, 17, 2, 1, TIRE_L); px(g, 12, 19, HUB);
      block(g, 6, 8, 3, 6, GUN);                        // left pod
      R(g, 6, 8, 3, 1, P.accent2); R(g, 6, 9, 1, 4, GUN_L); px(g, 7, 11, GUN_D);
      block(g, 15, 8, 3, 6, GUN);                       // right pod
      R(g, 15, 8, 3, 1, P.accent2); R(g, 15, 9, 1, 4, GUN_L); px(g, 16, 11, GUN_D);
      R(g, 9, 10, 1, 2, P.dark); R(g, 14, 10, 1, 2, P.dark); // pod struts
      block(g, 10, 7, 4, 10, P.hull);
      shade(g, P, 10, 7, 4, 10);
      R(g, 10, 7, 4, 2, P.glass); px(g, 10, 7, P.glint); // windscreen
      R(g, 10, 9, 4, 1, GUN_D);                         // handlebars
      R(g, 11, 10, 2, 2, P.dark); px(g, 11, 10, P.light); // rider helmet
      R(g, 10, 12, 4, 2, P.shadow);                     // rider back
      emblem(g, P, 12, 15);
    },

    // APC: boxy tracked carrier — sloped glacis, hatch ring, front MG.
    apc(g, P) {
      treads(g, 4, 4, 3, 16); treads(g, 17, 4, 3, 16);
      block(g, 8, 4, 8, 15, P.hull);
      shade(g, P, 8, 4, 8, 15);
      R(g, 9, 4, 6, 2, P.light); R(g, 9, 4, 3, 1, P.hi); // sloped glacis
      R(g, 8, 6, 8, 1, P.mid);                           // glacis break
      dith(g, 13, 7, 2, 10, P.mid);
      R(g, 9, 8, 2, 1, P.glass);                         // vision slit
      block(g, 12, 5, 2, 2, GUN_D); R(g, 12, 3, 1, 3, GUN); // bow MG
      block(g, 10, 10, 4, 4, P.dark);                    // hatch ring
      R(g, 11, 11, 2, 2, P.mid); px(g, 11, 11, P.light);
      R(g, 9, 16, 6, 1, P.shadow);                       // rear door seam
      R(g, 9, 17, 6, 2, P.dark);
      emblem(g, P, 12, 18);
    },

    // Light Tank hull: compact tracked chassis (turret separate).
    ltnk(g, P) {
      treads(g, 4, 6, 3, 13); treads(g, 17, 6, 3, 13);
      block(g, 8, 6, 8, 12, P.hull);
      shade(g, P, 8, 6, 8, 12);
      R(g, 9, 6, 6, 1, P.light); px(g, 9, 6, P.hi);
      R(g, 8, 8, 8, 1, P.mid);                           // glacis break
      dith(g, 13, 9, 2, 6, P.mid);
      R(g, 9, 15, 6, 3, P.dark);                         // engine deck
      R(g, 9, 15, 6, 1, P.shadow); R(g, 9, 17, 6, 1, P.shadow);
      px(g, 15, 16, GUN_L);                              // exhaust
      emblem(g, P, 12, 7);
    },

    // Medium Tank hull: wider chassis, chunky glacis + vented deck.
    mtnk(g, P) {
      treads(g, 3, 4, 4, 17); treads(g, 17, 4, 4, 17);
      block(g, 8, 4, 8, 16, P.hull);
      shade(g, P, 8, 4, 8, 16);
      R(g, 9, 4, 6, 2, P.light); R(g, 9, 4, 3, 1, P.hi); // glacis plate
      R(g, 8, 6, 8, 1, P.mid);
      dith(g, 13, 7, 2, 9, P.mid);
      R(g, 9, 16, 6, 3, P.dark);                         // engine deck
      R(g, 9, 16, 6, 1, P.shadow); R(g, 9, 18, 6, 1, P.shadow);
      px(g, 9, 17, GUN_L); px(g, 14, 17, GUN_L);         // exhausts
      emblem(g, P, 12, 5);
    },

    // Mammoth Tank hull: extra-wide dark treads, massive slab hull.
    htnk(g, P) {
      treads(g, 2, 4, 4, 17); treads(g, 18, 4, 4, 17);
      block(g, 7, 4, 10, 16, P.hull);
      shade(g, P, 7, 4, 10, 16);
      R(g, 8, 4, 8, 2, P.light); R(g, 8, 4, 4, 1, P.hi); // huge glacis
      R(g, 7, 6, 10, 1, P.mid);
      dith(g, 13, 7, 3, 10, P.mid);
      R(g, 8, 16, 8, 3, P.dark);                         // engine deck
      R(g, 8, 16, 8, 1, P.shadow); R(g, 8, 18, 8, 1, P.shadow);
      px(g, 8, 17, GUN_L); px(g, 15, 17, GUN_L);         // exhausts
      R(g, 7, 10, 1, 4, P.shadow); R(g, 16, 10, 1, 4, P.shadow); // skirt notches
      emblem(g, P, 12, 5);
    },

    // Flame Tank: rounded hull, twin nose flame nozzles, rear fuel drums.
    ftnk(g, P) {
      treads(g, 3, 5, 4, 15); treads(g, 17, 5, 4, 15);
      roundBlock(g, 7, 4, 10, 15, P.hull);
      R(g, 8, 4, 8, 1, P.light); R(g, 7, 5, 1, 13, P.light);
      px(g, 8, 4, P.hi); px(g, 7, 5, P.hi);
      R(g, 16, 5, 1, 13, P.mid); R(g, 8, 18, 8, 1, P.shadow);
      dith(g, 14, 6, 2, 8, P.mid);
      roundBlock(g, 10, 9, 4, 4, P.dark);                // fuel dome
      px(g, 10, 9, P.light); px(g, 11, 10, P.mid);
      R(g, 9, 15, 2, 3, P.shadow); R(g, 13, 15, 2, 3, P.shadow); // rear drums
      px(g, 9, 15, P.mid); px(g, 13, 15, P.mid);
      emblem(g, P, 12, 7);
      // twin flame nozzles poking well past the nose
      block(g, 8, 1, 2, 5, GUN); R(g, 8, 1, 1, 5, GUN_L);
      R(g, 8, 1, 2, 1, PAL.fire2); px(g, 8, 1, PAL.fire1);
      block(g, 14, 1, 2, 5, GUN); R(g, 14, 1, 1, 5, GUN_L);
      R(g, 14, 1, 2, 1, PAL.fire2); px(g, 14, 1, PAL.fire1);
    },

    // Stealth Tank: thin angular wedge, swept fins, twin top missile racks.
    stnk(g, P) {
      block(g, 11, 2, 2, 3, P.hull); px(g, 11, 2, P.light); // nose tip
      block(g, 10, 5, 4, 3, P.hull);
      px(g, 10, 5, OUT); px(g, 13, 5, OUT);
      R(g, 10, 5, 2, 1, P.light);
      block(g, 9, 8, 6, 10, P.hull);
      shade(g, P, 9, 8, 6, 10);
      R(g, 10, 6, 4, 1, P.glass); px(g, 10, 6, P.glint); // canopy slit
      emblem(g, P, 12, 9);
      // swept side fins (chamfered, angled back)
      block(g, 5, 10, 4, 6, P.dark);
      px(g, 5, 10, OUT); px(g, 6, 10, OUT); px(g, 5, 11, OUT); px(g, 5, 15, OUT);
      R(g, 7, 10, 1, 1, P.mid); R(g, 6, 12, 1, 3, P.mid);
      block(g, 15, 10, 4, 6, P.dark);
      px(g, 18, 10, OUT); px(g, 17, 10, OUT); px(g, 18, 11, OUT); px(g, 18, 15, OUT);
      px(g, 16, 10, P.mid); R(g, 17, 12, 1, 3, P.shadow);
      // twin missile racks
      block(g, 9, 12, 2, 5, GUN_D); R(g, 9, 12, 2, 1, P.accent2); px(g, 9, 14, GUN_L);
      block(g, 13, 12, 2, 5, GUN_D); R(g, 13, 12, 2, 1, P.accent2); px(g, 13, 14, GUN_L);
      R(g, 10, 18, 4, 1, P.shadow);                      // rear exhaust slit
    },

    // Artillery: rear tracked chassis, long 155mm barrel, recoil spade.
    arty(g, P) {
      treads(g, 4, 9, 3, 11); treads(g, 17, 9, 3, 11);
      block(g, 8, 9, 8, 10, P.hull);
      shade(g, P, 8, 9, 8, 10);
      R(g, 9, 12, 6, 5, P.dark);                         // open crew bay
      R(g, 9, 12, 6, 1, P.shadow);
      px(g, 10, 13, P.light); px(g, 12, 14, P.light);    // crew helmets
      px(g, 13, 15, P.mid);
      emblem(g, P, 12, 18);
      block(g, 10, 19, 4, 2, GUN_D);                     // recoil spade
      px(g, 10, 20, GUN_L); px(g, 13, 20, GUN_L);
      // gun shield
      block(g, 9, 6, 6, 3, P.dark);
      R(g, 9, 6, 6, 1, P.light); R(g, 9, 7, 1, 2, P.mid);
      // long barrel + muzzle brake + recoil sleeve
      block(g, 11, 1, 2, 6, GUN); R(g, 11, 1, 1, 6, GUN_L);
      block(g, 10, 1, 4, 1, GUN_D);                      // muzzle brake
      block(g, 10, 6, 4, 3, GUN_D); R(g, 10, 6, 1, 3, GUN); // sleeve
    },

    // Rocket Launcher (MLRS): tracked box with raised 6-tube rocket rack.
    msam(g, P) {
      treads(g, 4, 6, 3, 13); treads(g, 17, 6, 3, 13);
      block(g, 7, 6, 10, 12, P.hull);
      shade(g, P, 7, 6, 10, 12);
      R(g, 8, 6, 8, 1, P.light);                         // cab roof
      R(g, 9, 8, 2, 1, P.glass);                         // cab slit
      emblem(g, P, 14, 8);
      // raised launcher box (outlined, sits proud of the hull)
      block(g, 8, 10, 8, 7, P.dark);
      R(g, 8, 10, 8, 1, P.mid); R(g, 8, 11, 1, 5, P.mid);
      R(g, 15, 11, 1, 6, P.shadow); R(g, 9, 16, 7, 1, P.shadow);
      // two columns of three rocket tubes
      for (let ry = 11; ry <= 15; ry += 2) {
        R(g, 9, ry, 2, 1, P.accent2); px(g, 9, ry, PAL.fire1);
        R(g, 13, ry, 2, 1, P.accent2); px(g, 13, ry, PAL.fire1);
      }
    },

    // Harvester: huge ore truck — toothed scoop, cab, open tiberium bay.
    harv(g, P) {
      // scoop with alternating teeth
      block(g, 5, 1, 14, 5, P.dark);
      R(g, 6, 1, 12, 1, P.mid);
      for (let tx = 6; tx < 18; tx += 2) px(g, tx, 1, OUT);
      R(g, 6, 3, 12, 2, GUN_D);                          // intake maw
      R(g, 6, 5, 12, 1, P.shadow);
      // rounded body
      roundBlock(g, 5, 6, 14, 14, P.hull);
      R(g, 6, 6, 12, 1, P.light); R(g, 5, 7, 1, 11, P.light);
      px(g, 6, 6, P.hi); px(g, 5, 7, P.hi);
      R(g, 18, 7, 1, 11, P.mid); R(g, 6, 19, 12, 1, P.shadow);
      dith(g, 15, 8, 3, 3, P.mid);
      R(g, 7, 7, 6, 2, P.glass); R(g, 7, 7, 2, 1, P.glint); // cab glass
      emblem(g, P, 16, 10);
      R(g, 6, 10, 1, 2, GUN_D); R(g, 17, 10, 1, 2, GUN_D); // side vents
      // open cargo bay with dim tiberium sheen
      block(g, 7, 12, 10, 7, P.shadow);
      R(g, 8, 13, 8, 5, '#1c2c16');
      px(g, 9, 14, PAL.tibDark); px(g, 12, 15, PAL.tibDark);
      px(g, 14, 14, PAL.tibDark); px(g, 10, 16, PAL.tibDark);
      px(g, 13, 17, PAL.tibDark);
    },

    // MCV: 6-wheel hauler — cab, huge box body, crane arm + hook, hazard tail.
    mcv(g, P) {
      for (const wy of [4, 10, 16]) {
        wheel(g, 3, wy, 3, 4); wheel(g, 18, wy, 3, 4);
      }
      // cab
      block(g, 8, 2, 8, 5, P.hull);
      R(g, 8, 2, 8, 1, P.light); px(g, 8, 2, P.hi);
      R(g, 9, 3, 6, 2, P.glass); R(g, 9, 3, 2, 1, P.glint);
      R(g, 8, 6, 8, 1, P.dark);
      // box body
      block(g, 6, 8, 12, 12, P.hull);
      shade(g, P, 6, 8, 12, 12);
      dith(g, 14, 9, 3, 9, P.mid);
      emblem(g, P, 9, 10);
      // crane: turntable + lattice arm reaching right + hook
      block(g, 7, 11, 5, 5, P.dark);
      R(g, 7, 11, 5, 1, P.mid); px(g, 9, 13, GUN_L);     // pivot pin
      block(g, 11, 12, 7, 3, GUN);
      R(g, 11, 12, 7, 1, GUN_L);
      px(g, 13, 13, GUN_D); px(g, 15, 13, GUN_D);        // lattice holes
      R(g, 17, 15, 1, 2, GUN_D);                         // cable
      px(g, 17, 17, P.accent);                           // hook
      // rear hazard stripes
      for (let hx = 7; hx < 17; hx += 2) px(g, hx, 19, P.accent);
    },

    // Orca: VTOL gunship — glass canopy, stub wings, big wingtip fan nacelles.
    orca(g, P) {
      // stub wings
      block(g, 5, 10, 5, 4, P.hull); block(g, 14, 10, 5, 4, P.hull);
      R(g, 5, 10, 5, 1, P.light); R(g, 14, 10, 5, 1, P.light);
      R(g, 5, 13, 5, 1, P.shadow); R(g, 14, 13, 5, 1, P.shadow);
      emblem(g, P, 7, 12); emblem(g, P, 17, 12);
      // wingtip fan nacelles
      block(g, 3, 8, 3, 8, P.dark);
      R(g, 3, 8, 3, 1, P.light); R(g, 3, 9, 1, 6, P.mid); px(g, 4, 11, GUN_D);
      block(g, 18, 8, 3, 8, P.dark);
      R(g, 18, 8, 3, 1, P.light); R(g, 18, 9, 1, 6, P.mid); px(g, 19, 11, GUN_D);
      // fuselage
      block(g, 10, 2, 4, 17, P.hull);
      px(g, 10, 2, OUT); px(g, 13, 2, OUT);              // nose taper
      R(g, 11, 2, 2, 1, P.light); R(g, 10, 3, 1, 15, P.light);
      R(g, 13, 3, 1, 15, P.mid);
      R(g, 10, 4, 4, 4, P.glass);                        // canopy
      R(g, 10, 4, 2, 2, P.glint); px(g, 12, 5, GLASS_D);
      R(g, 11, 9, 2, 1, P.accent);                       // spine stripe
      R(g, 11, 11, 2, 3, GUN_D);                         // engine intake
      R(g, 11, 15, 2, 1, P.shadow);
      // tail plane
      block(g, 8, 19, 8, 2, P.dark);
      R(g, 8, 19, 8, 1, P.mid);
    },

    // Apache: attack helicopter — canopy, engine hump, rocket stubs, tail rotor.
    heli(g, P) {
      // tail boom + fin + tail rotor
      block(g, 11, 14, 2, 7, P.hull);
      R(g, 11, 14, 1, 7, P.light); R(g, 12, 14, 1, 7, P.mid);
      block(g, 13, 18, 3, 2, P.dark); R(g, 13, 18, 3, 1, P.mid); // tail fin
      R(g, 15, 16, 1, 5, OUT); px(g, 15, 17, GUN_L); px(g, 15, 19, GUN_L); // tail rotor
      // weapon stubs with rocket pods
      block(g, 5, 9, 4, 3, GUN);
      R(g, 5, 9, 1, 3, P.accent2); px(g, 6, 10, GUN_D); R(g, 5, 9, 4, 1, GUN_L);
      block(g, 15, 9, 4, 3, GUN);
      R(g, 18, 9, 1, 3, P.accent2); px(g, 17, 10, GUN_D); R(g, 15, 9, 4, 1, GUN_L);
      // fuselage
      block(g, 9, 3, 6, 12, P.hull);
      px(g, 9, 3, OUT); px(g, 14, 3, OUT);               // nose taper
      R(g, 10, 3, 4, 1, P.light); R(g, 9, 4, 1, 10, P.light);
      R(g, 14, 4, 1, 10, P.mid);
      px(g, 11, 3, GUN_D); px(g, 12, 3, GUN_D);          // chin gun
      R(g, 10, 4, 4, 3, P.glass);                        // stepped canopy
      R(g, 10, 4, 2, 1, P.glint); px(g, 13, 6, GLASS_D);
      R(g, 10, 8, 4, 4, P.dark);                         // engine hump
      R(g, 10, 8, 4, 1, P.mid);
      px(g, 9, 9, GUN_L); px(g, 14, 9, GUN_L);           // exhausts
      emblem(g, P, 12, 13);
      // rotor hub
      R(g, 11, 9, 2, 2, OUT); px(g, 11, 9, GUN_L);
    },
  };

  // ---- turrets (24x24, rotate about canvas center) ----------------------------

  // soft contact-shadow ring drawn around the turret base so it visually
  // "sits" on the hull at every rotation
  function ring(g, x, y, w, h) {
    g.fillStyle = 'rgba(16,16,8,0.4)';
    g.fillRect(x - 2, y - 2, w + 4, 1);
    g.fillRect(x - 2, y + h + 1, w + 4, 1);
    g.fillRect(x - 2, y - 1, 1, h + 2);
    g.fillRect(x + w + 1, y - 1, 1, h + 2);
  }

  // shaded gun barrel pointing north: lit left flank, dark muzzle
  function barrel(g, x, y, w, h) {
    block(g, x, y, w, h, GUN);
    R(g, x, y, 1, h, GUN_L);
    R(g, x, y, w, 1, GUN_D);
  }

  const TURRET = {

    // Light Tank: small chamfered turret, slim 75mm barrel.
    ltnk(g, P) {
      ring(g, 9, 9, 6, 6);
      barrel(g, 11, 3, 2, 7);
      roundBlock(g, 9, 9, 6, 6, P.hull);
      R(g, 10, 9, 4, 1, P.light); R(g, 9, 10, 1, 4, P.light);
      px(g, 10, 9, P.hi);
      R(g, 14, 10, 1, 4, P.mid); R(g, 10, 14, 4, 1, P.shadow);
      R(g, 11, 11, 2, 2, P.dark); px(g, 11, 11, P.mid);  // hatch
    },

    // Medium Tank: round turret + bustle, long 90mm barrel w/ muzzle sleeve.
    mtnk(g, P) {
      ring(g, 8, 8, 8, 8);
      barrel(g, 11, 1, 2, 8);
      block(g, 10, 3, 4, 2, GUN_D); R(g, 10, 3, 1, 2, GUN); // muzzle sleeve
      roundBlock(g, 8, 8, 8, 8, P.hull);
      R(g, 9, 8, 6, 1, P.light); R(g, 8, 9, 1, 6, P.light);
      px(g, 9, 8, P.hi);
      R(g, 15, 9, 1, 6, P.mid); R(g, 9, 15, 6, 1, P.shadow);
      R(g, 10, 14, 4, 2, P.dark);                        // rear bustle
      R(g, 11, 10, 2, 2, P.dark); px(g, 11, 10, P.mid);  // hatch
      px(g, 14, 9, P.mid);
    },

    // Mammoth: wide turret, TWO 120mm barrels + side tusk missile pods.
    htnk(g, P) {
      ring(g, 7, 8, 10, 8);
      barrel(g, 8, 2, 2, 7); block(g, 7, 3, 4, 1, GUN_D);
      barrel(g, 14, 2, 2, 7); block(g, 13, 3, 4, 1, GUN_D);
      roundBlock(g, 7, 8, 10, 8, P.hull);
      R(g, 8, 8, 8, 1, P.light); R(g, 7, 9, 1, 6, P.light);
      px(g, 8, 8, P.hi);
      R(g, 16, 9, 1, 6, P.mid); R(g, 8, 15, 8, 1, P.shadow);
      R(g, 11, 10, 2, 2, P.dark); px(g, 11, 10, P.mid);  // hatch
      // tusk missile pods with twin tube mouths
      block(g, 5, 11, 3, 5, GUN_D);
      R(g, 5, 11, 3, 1, P.accent2); px(g, 5, 13, GUN_L); px(g, 6, 14, GUN);
      block(g, 16, 11, 3, 5, GUN_D);
      R(g, 16, 11, 3, 1, P.accent2); px(g, 16, 13, GUN_L); px(g, 17, 14, GUN);
    },
  };

  // ---- anim overlay frames (24x24, transparent, drawn over the body) ---------
  function harvAnim0(g, P) {
    // intake spinner phase A: bright teeth on even columns + green maw glow
    for (let tx = 6; tx < 18; tx += 2) R(g, tx, 2, 1, 3, P.light);
    R(g, 7, 3, 10, 2, 'rgba(72,216,88,0.35)');           // PAL.tib2 glow
    px(g, 9, 3, PAL.tib3); px(g, 14, 4, PAL.tib2);
    R(g, 8, 13, 8, 5, 'rgba(46,168,56,0.30)');           // bay shimmer
    px(g, 10, 14, PAL.tib2); px(g, 13, 16, PAL.tib1);
  }
  function harvAnim1(g, P) {
    // phase B: offset teeth, brighter crystal sparkle in the bay
    for (let tx = 7; tx < 19; tx += 2) R(g, tx, 2, 1, 3, P.light);
    R(g, 7, 3, 10, 2, 'rgba(72,216,88,0.35)');
    px(g, 12, 3, PAL.tib3); px(g, 7, 4, PAL.tib2);
    R(g, 8, 13, 8, 5, 'rgba(72,216,88,0.30)');
    px(g, 9, 15, PAL.tib3); px(g, 12, 14, PAL.tib2); px(g, 14, 16, PAL.tib2);
  }
  function orcaAnim0(g, P) {
    g.globalAlpha = 0.55;
    R(g, 0, 11, 9, 2, P.light); R(g, 15, 11, 9, 2, P.light); // fan blur, horizontal
    g.globalAlpha = 1;
    px(g, 4, 11, WHITE); px(g, 19, 11, WHITE);
  }
  function orcaAnim1(g, P) {
    g.globalAlpha = 0.55;
    R(g, 3, 7, 2, 10, P.light); R(g, 19, 7, 2, 10, P.light); // fan blur, vertical
    g.globalAlpha = 1;
    px(g, 4, 11, WHITE); px(g, 19, 11, WHITE);
  }
  function heliAnim0(g, P) {
    g.globalAlpha = 0.5;
    R(g, 2, 9, 20, 2, P.light);                          // main rotor blur bar
    g.globalAlpha = 0.25;
    R(g, 11, 2, 2, 16, P.light);
    g.globalAlpha = 0.6;
    R(g, 14, 17, 3, 1, P.light);                         // tail rotor blur
    g.globalAlpha = 1;
  }
  function heliAnim1(g, P) {
    g.globalAlpha = 0.5;
    R(g, 11, 1, 2, 18, P.light);
    g.globalAlpha = 0.25;
    R(g, 3, 9, 18, 2, P.light);
    g.globalAlpha = 0.6;
    R(g, 15, 15, 1, 4, P.light);                         // tail rotor blur
    g.globalAlpha = 1;
  }

  const ANIM = {
    harv: [harvAnim0, harvAnim1],
    orca: [orcaAnim0, orcaAnim1],
    heli: [heliAnim0, heliAnim1],
  };

  // ---- build the sprite registry ----------------------------------------------
  function draw24(fn, P) {
    const c = mkCanvas(24, 24);
    fn(c.getContext('2d'), P);
    return c;
  }

  const KEYS = ['jeep', 'bggy', 'bike', 'apc', 'ltnk', 'mtnk', 'htnk', 'ftnk',
                'stnk', 'arty', 'msam', 'harv', 'mcv', 'orca', 'heli'];

  for (const key of KEYS) {
    const entry = {};
    for (const side of ['gdi', 'nod']) {
      const P = SIDE_PAL[side];
      const rec = { body: rotFrames(draw24(DRAW[key], P), 16) };
      if (TURRET[key]) rec.turret = rotFrames(draw24(TURRET[key], P), 16);
      if (ANIM[key]) {
        // Each anim frame is a canonical (north) overlay canvas that ALSO carries
        // its 16 rotated facings as index properties: anim[i] is drawable directly
        // and anim[i][facing] yields the properly rotated overlay canvas.
        rec.anim = ANIM[key].map(function (fn) {
          const c = draw24(fn, P);
          const frames = rotFrames(c, 16);
          for (let f = 0; f < 16; f++) c[f] = frames[f];
          return c;
        });
      }
      entry[side] = rec;
    }
    SPRITES.units[key] = entry;
  }

  // ---- cameos (64x48) — mini "portraits": unit at 2x on a diagonal slate ------
  function makeCameo(key) {
    const d = DATA.units[key];
    const side = d.side || 'gdi';          // side-null units use the GDI palette
    const spr = SPRITES.units[key][side];
    const F = 2;                            // ~NE facing

    // composite body + turret (+ rotor for aircraft) at facing F
    const comp = mkCanvas(24, 24);
    const cg = comp.getContext('2d');
    cg.drawImage(spr.body[F], 0, 0);
    if (spr.turret) cg.drawImage(spr.turret[F], 0, 0);
    if (spr.anim && (key === 'orca' || key === 'heli')) cg.drawImage(spr.anim[0][F], 0, 0);

    const c = mkCanvas(C.CAMEO_W, C.CAMEO_H);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    // dark diagonal-gradient slate (4 bands with dithered boundaries)
    const bands = ['#3c3c33', '#2c2c25', '#20201a', '#151511'];
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 64; x++) {
        const t = (x + y) / 110 * 4;
        let i = Math.floor(t);
        if (t - i > 0.5 && ((x ^ y) & 1)) i++;
        g.fillStyle = bands[Math.min(3, i)];
        g.fillRect(x, y, 1, 1);
      }
    }
    // faint top-left sheen streak
    g.fillStyle = 'rgba(255,255,255,0.07)';
    for (let i = 0; i < 13; i++) g.fillRect(2 + i, 14 - i, 2, 1);
    // soft ground shadow under the unit
    g.fillStyle = 'rgba(0,0,0,0.38)';
    g.fillRect(15, 31, 34, 3);
    g.fillRect(19, 34, 26, 2);
    // unit drawn big: 2x nearest-neighbour
    g.drawImage(comp, 0, 0, 24, 24, 8, -4, 48, 48);
    // thin gold inner frame
    g.fillStyle = 'rgba(224,184,64,0.45)';
    g.fillRect(1, 1, 62, 1); g.fillRect(1, 2, 1, 42); g.fillRect(62, 2, 1, 42);
    // name band (dark backing keeps the tiny text readable)
    R(g, 0, 36, 64, 8, 'rgba(0,0,0,0.5)');
    g.font = '7px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = PAL.uiText;
    g.fillText(d.name, 32, 40, 62);
    // faction-neutral gold bottom stripe
    R(g, 0, 44, 64, 4, PAL.uiGold);
    R(g, 0, 44, 64, 1, '#f0d070'); R(g, 0, 47, 64, 1, '#a07820');
    // thin 1px black frame
    R(g, 0, 0, 64, 1, '#000'); R(g, 0, 47, 64, 1, '#000');
    R(g, 0, 0, 1, 48, '#000'); R(g, 63, 0, 1, 48, '#000');
    return c;
  }

  for (const key of KEYS) SPRITES.cameo[key] = makeCameo(key);
})();

// Visceroid — the tiberium creature that forms when infantry die on a field.
// One pulsing blob shape shared across all 16 facings (blobs don't face).
(function () {
  if (typeof SPRITES === 'undefined' || typeof mkCanvas === 'undefined' ||
      typeof document === 'undefined') return;

  function blobFrame(phase) {
    const c = mkCanvas(24, 24);
    const g = c.getContext('2d');
    const wob = phase ? 1 : 0;
    // ground slime shadow
    g.fillStyle = 'rgba(20,40,16,0.35)';
    g.beginPath(); g.ellipse(12, 17, 8 + wob, 4, 0, 0, Math.PI * 2); g.fill();
    // body lobes: sickly reds with green tiberium veins
    const body = '#8f3038', bodyL = '#b8505a', bodyD = '#5c1c24', out = '#160a08';
    const lobes = phase
      ? [[9, 12, 6], [15, 13, 5], [12, 9, 4], [8, 15, 3]]
      : [[10, 13, 6], [15, 11, 5], [11, 8, 4], [16, 15, 3]];
    for (const [x, y, r] of lobes) {
      g.fillStyle = out;
      g.beginPath(); g.arc(x, y, r + 1, 0, Math.PI * 2); g.fill();
    }
    for (const [x, y, r] of lobes) {
      g.fillStyle = body;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = bodyL;
      g.beginPath(); g.arc(x - 1, y - 1, Math.max(1, r - 2), 0, Math.PI * 2); g.fill();
      g.fillStyle = body;
      g.beginPath(); g.arc(x, y, Math.max(1, r - 2), 0, Math.PI * 2); g.fill();
    }
    // dark underside + green pustules
    g.fillStyle = bodyD;
    g.fillRect(7, 15, 10, 2);
    const pust = phase ? [[9, 11], [14, 14], [12, 8]] : [[11, 13], [16, 11], [9, 15]];
    for (const [x, y] of pust) {
      g.fillStyle = PAL.tib1; g.fillRect(x, y, 2, 2);
      g.fillStyle = PAL.tib3; g.fillRect(x, y, 1, 1);
    }
    // wet highlight
    g.fillStyle = 'rgba(255,220,220,0.5)';
    g.fillRect(9 + wob, 9, 2, 1);
    return c;
  }

  const f0 = blobFrame(0), f1 = blobFrame(1);
  const entry = { body: [], anim: [f0, f1] }; // anim overlay pulses while it moves
  for (let i = 0; i < 16; i++) entry.body.push(f0);
  // same sprite for every owner palette slot (creatures have no faction colors)
  SPRITES.units.vice = { gdi: entry, nod: entry, mut: entry };
})();
