'use strict';
// sprites_units.js — procedurally drawn VEHICLE and AIRCRAFT sprites + sidebar cameos.
// Fills SPRITES.units[key][side] ({body:[16], turret?:[16], anim?:[...]}) and
// SPRITES.cameo[key] for: jeep bggy bike apc ltnk mtnk htnk ftnk stnk arty msam
// harv mcv orca heli. Every unit is generated for BOTH sides ('gdi' gold/tan,
// 'nod' grey+red) since captures/spawns can mix ownership.
//
// PERSPECTIVE: tilted-top-down 3/4 camera. Each canonical 24x24 canvas is a TRUE
// TOP view facing NORTH with neutral/radial lighting only (bright forward panels
// + centre-line, symmetric darker rims, 1px outline) — no baked left/right sun
// shading that would spin with the hull. Depth (dark extruded sides + soft
// ground shadow) is composited in screen space per facing by core.js rot3D(),
// so the "camera looks down from the south" cue stays consistent for all 16
// facings. Turret frames get an extra 1px screen-space lift so they read as
// sitting on top of the hull.

(function () {
  // Defensive boot: needs DOM (canvas) plus core.js/data.js globals.
  if (typeof document === 'undefined') return;
  if (typeof SPRITES === 'undefined' || typeof DATA === 'undefined' ||
      typeof PAL === 'undefined' || typeof mkCanvas !== 'function' ||
      typeof rot3D !== 'function') return;

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

  // NEUTRAL top-face shading over an already-filled hull block: brighter
  // forward (bow) row, symmetric darker rims on BOTH flanks and the stern,
  // and a bright centre spine. Rotates with the hull without implying a sun.
  function shadeTop(g, P, x, y, w, h) {
    R(g, x, y + 1, 1, h - 2, P.mid);
    R(g, x + w - 1, y + 1, 1, h - 2, P.mid);
    R(g, x, y + h - 1, w, 1, P.mid);
    R(g, x, y, w, 1, P.light);
    const cx = x + ((w - 1) >> 1);
    R(g, cx, y + 1, w >= 9 ? 2 : 1, h - 2, P.light);   // centre spine
    px(g, cx, y, P.hi);                                 // bow sparkle
  }

  // vertical track assembly: parallel dark bands with light link ticks
  function treads(g, x, y, w, h) {
    R(g, x - 1, y - 1, w + 2, h + 2, OUT);
    R(g, x, y, w, h, TRK);
    for (let ty = y; ty < y + h; ty += 2) R(g, x, ty, w, 1, TRK_M);
    for (let ty = y + 1; ty < y + h; ty += 4) R(g, x, ty, w, 1, TRK_L); // link ticks
    R(g, x, y, w, 1, TRK_L); R(g, x, y + h - 1, w, 1, TRK_L);          // sprockets
  }

  // rubber tire seen from above: bright leading edge + hub dot (radial)
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

  // engine grille: alternating dark slats on a deck (reads as vents from above)
  function grille(g, x, y, w, rows, c) {
    for (let j = 0; j < rows; j++) R(g, x, y + j * 2, w, 1, c);
  }

  // pair of tow hooks on a hull edge row
  function hooks(g, x1, x2, y) { px(g, x1, y, GUN_D); px(g, x2, y, GUN_D); }

  // ---- canonical NORTH-facing TOP-VIEW bodies (24x24) -------------------------
  const DRAW = {

    // Hum-Vee: 4x4 scout — brush bar, lit hood, windshield band, roof MG, bed.
    jeep(g, P) {
      R(g, 6, 6, 3, 2, GUN_D); R(g, 15, 6, 3, 2, GUN_D);   // front axles
      R(g, 6, 16, 3, 2, GUN_D); R(g, 15, 16, 3, 2, GUN_D); // rear axles
      wheel(g, 5, 5, 2, 4); wheel(g, 17, 5, 2, 4);
      wheel(g, 5, 15, 2, 4); wheel(g, 17, 15, 2, 4);
      block(g, 8, 4, 8, 16, P.hull);
      shadeTop(g, P, 8, 4, 8, 16);
      R(g, 9, 2, 6, 1, OUT); R(g, 9, 3, 6, 1, GUN);      // brush bar
      px(g, 11, 3, GUN_L); px(g, 12, 3, GUN_L);
      px(g, 9, 4, PAL.fire1); px(g, 14, 4, PAL.fire1);   // headlights
      R(g, 9, 7, 6, 1, P.dark);                          // hood seam
      emblem(g, P, 12, 5);                               // hood star
      R(g, 9, 8, 6, 2, P.glass);                         // windshield band
      px(g, 11, 8, P.glint); px(g, 12, 8, P.glint);
      R(g, 9, 15, 6, 1, P.dark);                         // bed seam
      R(g, 9, 16, 6, 3, P.dark);                         // rear cargo bed
      R(g, 10, 17, 4, 1, P.shadow);                      // bed slats
      hooks(g, 9, 14, 19);                               // rear tow hooks
      block(g, 11, 11, 2, 2, GUN_D);                     // ring mount
      block(g, 11, 7, 2, 5, GUN);                        // roof MG barrel
      R(g, 11, 7, 2, 1, GUN_D); px(g, 11, 11, GUN_L);
    },

    // Nod Buggy: fat rear tires, narrow tapered hull, cage MG, vented engine.
    bggy(g, P) {
      R(g, 6, 5, 4, 2, GUN_D); R(g, 14, 5, 4, 2, GUN_D);   // front axles
      R(g, 6, 15, 4, 2, GUN_D); R(g, 14, 15, 4, 2, GUN_D); // rear axles
      wheel(g, 4, 4, 3, 4); wheel(g, 17, 4, 3, 4);       // small front tires
      wheel(g, 3, 13, 4, 6); wheel(g, 17, 13, 4, 6);     // fat rear tires
      block(g, 9, 3, 6, 17, P.hull);
      shadeTop(g, P, 9, 3, 6, 17);
      px(g, 9, 3, OUT); px(g, 14, 3, OUT);               // tapered nose
      px(g, 9, 4, OUT); px(g, 14, 4, OUT);
      R(g, 11, 3, 2, 1, P.light);
      emblem(g, P, 12, 5);                               // nose chevron
      R(g, 10, 7, 4, 2, P.glass);                        // windscreen
      px(g, 11, 7, P.glint); px(g, 12, 7, P.glint);
      R(g, 9, 12, 6, 1, P.dark);                         // roll bar
      R(g, 10, 13, 4, 6, P.dark);                        // engine deck
      grille(g, 10, 14, 4, 3, P.shadow);                 // vents
      px(g, 12, 15, P.accent2);                          // engine light
      px(g, 9, 19, GUN_L); px(g, 14, 19, GUN_L);         // exhaust tips
      block(g, 11, 10, 2, 2, GUN_D);                     // cage mount
      block(g, 11, 6, 2, 4, GUN); R(g, 11, 6, 2, 1, GUN_D); // MG
    },

    // Recon Bike: narrow two-wheeler, rider hump, flanking missile pods.
    bike(g, P) {
      block(g, 11, 2, 2, 5, TIRE); R(g, 11, 2, 2, 1, TIRE_L); px(g, 11, 4, HUB);
      block(g, 11, 17, 2, 5, TIRE); R(g, 11, 17, 2, 1, TIRE_L); px(g, 12, 19, HUB);
      block(g, 6, 8, 3, 6, GUN);                         // left pod
      R(g, 6, 8, 3, 1, P.accent2); px(g, 7, 10, GUN_L); px(g, 7, 12, GUN_D);
      block(g, 15, 8, 3, 6, GUN);                        // right pod
      R(g, 15, 8, 3, 1, P.accent2); px(g, 16, 10, GUN_L); px(g, 16, 12, GUN_D);
      R(g, 9, 10, 1, 2, P.dark); R(g, 14, 10, 1, 2, P.dark); // pod struts
      block(g, 10, 7, 4, 10, P.hull);
      R(g, 10, 7, 4, 1, P.light);
      R(g, 10, 8, 1, 8, P.mid); R(g, 13, 8, 1, 8, P.mid);
      R(g, 10, 7, 4, 2, P.glass); px(g, 11, 7, P.glint); // windscreen
      R(g, 10, 9, 4, 1, GUN_D);                          // handlebars
      R(g, 11, 10, 2, 2, P.dark); px(g, 11, 10, P.light); // rider helmet
      R(g, 10, 12, 4, 2, P.shadow);                      // rider back
      emblem(g, P, 12, 15);
      R(g, 10, 16, 4, 1, P.mid);                         // tail
    },

    // APC: boxy tracked carrier — bright glacis, split troop hatch, bow MG.
    apc(g, P) {
      treads(g, 4, 4, 3, 16); treads(g, 17, 4, 3, 16);
      block(g, 8, 4, 8, 15, P.hull);
      shadeTop(g, P, 8, 4, 8, 15);
      R(g, 9, 4, 6, 2, P.light);                         // bright glacis
      px(g, 11, 4, P.hi); px(g, 12, 4, P.hi);
      R(g, 8, 6, 8, 1, P.dark);                          // glacis break
      hooks(g, 9, 14, 5);                                // front tow hooks
      emblem(g, P, 12, 8);
      // split troop hatch (two doors + centre hinge line)
      block(g, 10, 10, 4, 5, P.dark);
      R(g, 10, 10, 4, 1, P.mid);
      R(g, 11, 10, 1, 5, P.mid); R(g, 12, 10, 1, 5, P.shadow);
      px(g, 10, 12, GUN_L); px(g, 13, 12, GUN_L);        // hinges
      R(g, 9, 16, 6, 3, P.dark);                         // engine deck
      grille(g, 9, 16, 6, 2, P.shadow);
      hooks(g, 9, 14, 18);
      block(g, 12, 5, 2, 2, GUN_D);                      // bow MG mount
      R(g, 12, 2, 1, 4, GUN); px(g, 12, 2, GUN_D);       // MG barrel
    },

    // Light Tank hull: compact tracked chassis (turret separate).
    ltnk(g, P) {
      treads(g, 4, 5, 3, 14); treads(g, 17, 5, 3, 14);
      block(g, 8, 5, 8, 13, P.hull);
      shadeTop(g, P, 8, 5, 8, 13);
      R(g, 9, 5, 6, 1, P.light); px(g, 11, 5, P.hi); px(g, 12, 5, P.hi);
      R(g, 8, 7, 8, 1, P.dark);                          // glacis break
      hooks(g, 9, 14, 6);                                // front tow hooks
      emblem(g, P, 12, 9);
      R(g, 10, 10, 4, 4, P.dark);                        // turret ring
      R(g, 9, 14, 6, 4, P.dark);                         // engine deck
      grille(g, 9, 15, 6, 2, P.shadow);
      px(g, 9, 14, GUN_L); px(g, 14, 14, GUN_L);         // exhausts
    },

    // Medium Tank hull: wider chassis, chunky glacis + vented deck.
    mtnk(g, P) {
      treads(g, 3, 4, 4, 17); treads(g, 17, 4, 4, 17);
      block(g, 8, 4, 8, 16, P.hull);
      shadeTop(g, P, 8, 4, 8, 16);
      R(g, 9, 4, 6, 2, P.light);                         // glacis plate
      px(g, 11, 4, P.hi); px(g, 12, 4, P.hi);
      R(g, 8, 6, 8, 1, P.dark);
      hooks(g, 9, 14, 5);
      emblem(g, P, 12, 8);
      R(g, 10, 10, 4, 5, P.dark);                        // turret ring
      R(g, 9, 16, 6, 3, P.dark);                         // engine deck
      grille(g, 9, 16, 6, 2, P.shadow);
      px(g, 9, 17, GUN_L); px(g, 14, 17, GUN_L);         // exhausts
    },

    // Mammoth Tank hull: WIDEST silhouette — huge treads, slab deck, skirts.
    htnk(g, P) {
      treads(g, 2, 4, 4, 17); treads(g, 18, 4, 4, 17);
      block(g, 7, 4, 10, 16, P.hull);
      shadeTop(g, P, 7, 4, 10, 16);
      R(g, 8, 4, 8, 2, P.light);                         // huge glacis
      R(g, 10, 4, 4, 1, P.hi);
      R(g, 7, 6, 10, 1, P.dark);
      hooks(g, 8, 15, 5);
      emblem(g, P, 12, 8);
      R(g, 9, 10, 6, 5, P.dark);                         // wide turret ring
      R(g, 8, 16, 8, 3, P.dark);                         // engine deck
      grille(g, 8, 16, 8, 2, P.shadow);
      px(g, 8, 17, GUN_L); px(g, 15, 17, GUN_L);         // exhausts
      R(g, 7, 10, 1, 4, P.shadow); R(g, 16, 10, 1, 4, P.shadow); // skirt notches
      hooks(g, 8, 15, 19);
    },

    // Flame Tank: rounded hull, twin nose flame nozzles, dome + rear fuel drums.
    ftnk(g, P) {
      treads(g, 3, 5, 4, 15); treads(g, 17, 5, 4, 15);
      roundBlock(g, 7, 4, 10, 15, P.hull);
      R(g, 8, 4, 8, 1, P.light); px(g, 11, 4, P.hi); px(g, 12, 4, P.hi);
      R(g, 7, 5, 1, 13, P.mid); R(g, 16, 5, 1, 13, P.mid);
      R(g, 8, 18, 8, 1, P.mid);
      R(g, 11, 6, 2, 11, P.light);                       // centre spine
      emblem(g, P, 12, 6);
      roundBlock(g, 10, 9, 4, 4, P.dark);                // fuel dome
      R(g, 11, 9, 2, 1, P.mid); px(g, 11, 10, P.light);  // dome cap
      // rear fuel drums with bright caps
      block(g, 8, 14, 3, 4, P.shadow); R(g, 8, 14, 3, 1, P.mid); px(g, 9, 15, P.light);
      block(g, 13, 14, 3, 4, P.shadow); R(g, 13, 14, 3, 1, P.mid); px(g, 14, 15, P.light);
      // twin flame nozzles poking well past the nose
      block(g, 8, 1, 2, 5, GUN); R(g, 8, 1, 2, 1, PAL.fire2); px(g, 8, 1, PAL.fire1);
      block(g, 14, 1, 2, 5, GUN); R(g, 14, 1, 2, 1, PAL.fire2); px(g, 14, 1, PAL.fire1);
      px(g, 8, 5, GUN_L); px(g, 15, 5, GUN_L);           // nozzle collars
    },

    // Stealth Tank: thin angular wedge, swept fins, twin top missile racks.
    stnk(g, P) {
      block(g, 11, 2, 2, 3, P.hull); R(g, 11, 2, 2, 1, P.light); // nose tip
      block(g, 10, 5, 4, 3, P.hull);
      px(g, 10, 5, OUT); px(g, 13, 5, OUT);
      R(g, 11, 5, 2, 1, P.light);
      block(g, 9, 8, 6, 10, P.hull);
      R(g, 9, 8, 6, 1, P.light);
      R(g, 9, 9, 1, 8, P.mid); R(g, 14, 9, 1, 8, P.mid);
      R(g, 10, 17, 4, 1, P.mid);
      R(g, 10, 6, 4, 1, P.glass); px(g, 11, 6, P.glint); px(g, 12, 6, P.glint);
      emblem(g, P, 12, 10);
      // swept side fins (chamfered, angled back, mirrored)
      block(g, 5, 10, 4, 6, P.dark);
      px(g, 5, 10, OUT); px(g, 6, 10, OUT); px(g, 5, 11, OUT); px(g, 5, 15, OUT);
      px(g, 7, 10, P.mid); R(g, 6, 12, 1, 3, P.mid);
      block(g, 15, 10, 4, 6, P.dark);
      px(g, 18, 10, OUT); px(g, 17, 10, OUT); px(g, 18, 11, OUT); px(g, 18, 15, OUT);
      px(g, 16, 10, P.mid); R(g, 17, 12, 1, 3, P.mid);
      // twin missile racks (raised: bright top row, dark tail)
      block(g, 9, 12, 2, 5, GUN_D); R(g, 9, 12, 2, 1, P.accent2); px(g, 9, 14, GUN_L);
      block(g, 13, 12, 2, 5, GUN_D); R(g, 13, 12, 2, 1, P.accent2); px(g, 14, 14, GUN_L);
      R(g, 10, 17, 4, 1, P.shadow);                      // rear exhaust slit
    },

    // Artillery: rear tracked chassis, LONG 155mm barrel, crew bay, spade.
    arty(g, P) {
      treads(g, 4, 9, 3, 11); treads(g, 17, 9, 3, 11);
      block(g, 8, 9, 8, 10, P.hull);
      shadeTop(g, P, 8, 9, 8, 10);
      R(g, 9, 12, 6, 5, P.dark);                         // open crew bay
      R(g, 9, 12, 6, 1, P.shadow);
      px(g, 10, 13, P.light); px(g, 13, 14, P.light);    // crew helmets
      px(g, 12, 15, P.mid);
      emblem(g, P, 12, 18);
      block(g, 10, 20, 4, 2, GUN_D);                     // recoil spade
      px(g, 10, 21, GUN_L); px(g, 13, 21, GUN_L);
      // gun shield
      block(g, 9, 6, 6, 3, P.dark);
      R(g, 9, 6, 6, 1, P.mid); px(g, 11, 6, P.light); px(g, 12, 6, P.light);
      // long barrel + muzzle brake + recoil sleeve
      block(g, 11, 1, 2, 6, GUN);
      block(g, 10, 1, 4, 1, GUN_D);                      // muzzle brake
      block(g, 10, 6, 4, 3, GUN_D); R(g, 11, 6, 2, 1, GUN_L); // sleeve collar
    },

    // Rocket Launcher (MLRS): tracked box; RAISED 6-tube rack (bright top,
    // 1px dark drop edge at its south side so it floats above the deck).
    msam(g, P) {
      treads(g, 4, 6, 3, 13); treads(g, 17, 6, 3, 13);
      block(g, 7, 6, 10, 12, P.hull);
      shadeTop(g, P, 7, 6, 10, 12);
      R(g, 8, 6, 8, 1, P.light);                         // cab roof
      R(g, 10, 7, 4, 1, P.glass); px(g, 11, 7, P.glint); // cab slit
      emblem(g, P, 12, 8);
      // raised launcher box: 1px dark drop shadow under its south edge first
      R(g, 8, 17, 9, 1, 'rgba(8,8,12,0.55)');
      block(g, 8, 10, 8, 7, P.dark);
      R(g, 8, 10, 8, 1, P.light);                        // bright top rim
      R(g, 9, 11, 6, 5, P.mid);                          // raised bright top
      R(g, 8, 16, 8, 1, GUN_D);                          // dark south edge
      // two columns of three rocket tubes
      for (let ry = 11; ry <= 15; ry += 2) {
        R(g, 9, ry, 2, 1, P.accent2); px(g, 9, ry, PAL.fire1);
        R(g, 13, ry, 2, 1, P.accent2); px(g, 13, ry, PAL.fire1);
      }
      px(g, 12, 12, GUN_L); px(g, 12, 14, GUN_L);        // rack frame bolts
    },

    // Harvester: huge ore truck — toothed scoop, cab, open tiberium bay.
    harv(g, P) {
      // scoop with alternating teeth
      block(g, 5, 1, 14, 5, P.dark);
      R(g, 6, 1, 12, 1, P.mid);
      for (let tx = 6; tx < 18; tx += 2) px(g, tx, 1, OUT);
      R(g, 6, 3, 12, 2, GUN_D);                          // intake maw
      R(g, 6, 5, 12, 1, P.shadow);
      // rounded body, neutral rims
      roundBlock(g, 5, 6, 14, 14, P.hull);
      R(g, 6, 6, 12, 1, P.light); px(g, 11, 6, P.hi); px(g, 12, 6, P.hi);
      R(g, 5, 7, 1, 11, P.mid); R(g, 18, 7, 1, 11, P.mid);
      R(g, 6, 19, 12, 1, P.mid);
      R(g, 8, 7, 8, 2, P.glass);                         // cab glass
      px(g, 11, 7, P.glint); px(g, 12, 7, P.glint);
      emblem(g, P, 12, 10);
      R(g, 6, 10, 1, 2, GUN_D); R(g, 17, 10, 1, 2, GUN_D); // side vents
      // open cargo bay with dim tiberium sheen
      block(g, 7, 12, 10, 7, P.shadow);
      R(g, 8, 13, 8, 5, '#1c2c16');
      px(g, 9, 14, PAL.tibDark); px(g, 12, 15, PAL.tibDark);
      px(g, 14, 14, PAL.tibDark); px(g, 10, 16, PAL.tibDark);
      px(g, 13, 17, PAL.tibDark);
    },

    // MCV: 6-wheel hauler — cab, huge box body, floating crane boom, hazards.
    mcv(g, P) {
      for (const wy of [4, 10, 16]) {
        R(g, 5, wy + 1, 3, 2, GUN_D); R(g, 16, wy + 1, 3, 2, GUN_D); // axles
        wheel(g, 3, wy, 3, 4); wheel(g, 18, wy, 3, 4);
      }
      // cab
      block(g, 8, 2, 8, 5, P.hull);
      R(g, 8, 2, 8, 1, P.light); px(g, 11, 2, P.hi); px(g, 12, 2, P.hi);
      R(g, 9, 3, 6, 2, P.glass); px(g, 11, 3, P.glint); px(g, 12, 3, P.glint);
      R(g, 8, 6, 8, 1, P.dark);
      // box body
      block(g, 6, 8, 12, 12, P.hull);
      shadeTop(g, P, 6, 8, 12, 12);
      emblem(g, P, 9, 10);
      // crane: turntable, then boom drawn BRIGHT over a 1px dark under-offset
      block(g, 7, 11, 4, 5, P.dark);
      R(g, 7, 11, 4, 1, P.mid); px(g, 8, 13, GUN_L);     // pivot pin
      R(g, 11, 13, 8, 3, 'rgba(8,8,12,0.6)');            // boom drop shadow (+1,+1)
      block(g, 10, 12, 8, 3, GUN_L);                     // lattice boom, bright
      R(g, 10, 12, 8, 1, WHITE);
      px(g, 12, 13, GUN_D); px(g, 14, 13, GUN_D); px(g, 16, 13, GUN_D); // lattice holes
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
      R(g, 5, 13, 5, 1, P.mid); R(g, 14, 13, 5, 1, P.mid);
      emblem(g, P, 7, 12); emblem(g, P, 17, 12);
      // wingtip fan nacelles (mirrored)
      block(g, 3, 8, 3, 8, P.dark);
      R(g, 3, 8, 3, 1, P.light); px(g, 4, 11, GUN_D); px(g, 4, 14, P.mid);
      block(g, 18, 8, 3, 8, P.dark);
      R(g, 18, 8, 3, 1, P.light); px(g, 19, 11, GUN_D); px(g, 19, 14, P.mid);
      // fuselage
      block(g, 10, 2, 4, 17, P.hull);
      px(g, 10, 2, OUT); px(g, 13, 2, OUT);              // nose taper
      R(g, 11, 2, 2, 1, P.light);
      R(g, 10, 3, 1, 15, P.mid); R(g, 13, 3, 1, 15, P.mid);
      R(g, 11, 3, 2, 1, P.light);
      R(g, 10, 4, 4, 4, P.glass);                        // canopy
      px(g, 11, 4, P.glint); px(g, 12, 4, P.glint); px(g, 11, 5, P.glint);
      px(g, 10, 7, GLASS_D); px(g, 13, 7, GLASS_D);
      R(g, 11, 9, 2, 1, P.accent);                       // spine stripe
      R(g, 11, 11, 2, 3, GUN_D);                         // engine intake
      R(g, 11, 15, 2, 1, P.mid);
      // tail plane
      block(g, 8, 19, 8, 2, P.dark);
      R(g, 8, 19, 8, 1, P.mid); px(g, 11, 19, P.light); px(g, 12, 19, P.light);
    },

    // Apache: attack helicopter — canopy, engine hump, rocket stubs, tail rotor.
    heli(g, P) {
      // tail boom + fin + tail rotor
      block(g, 11, 14, 2, 7, P.hull);
      R(g, 11, 14, 1, 7, P.light); R(g, 12, 14, 1, 7, P.mid);
      block(g, 13, 18, 3, 2, P.dark); R(g, 13, 18, 3, 1, P.mid); // tail fin
      R(g, 15, 16, 1, 5, OUT); px(g, 15, 17, GUN_L); px(g, 15, 19, GUN_L); // tail rotor
      // weapon stubs with rocket pods (mirrored)
      block(g, 5, 9, 4, 3, GUN);
      R(g, 5, 9, 4, 1, GUN_L); R(g, 5, 9, 1, 3, P.accent2); px(g, 6, 10, GUN_D);
      block(g, 15, 9, 4, 3, GUN);
      R(g, 15, 9, 4, 1, GUN_L); R(g, 18, 9, 1, 3, P.accent2); px(g, 17, 10, GUN_D);
      // fuselage
      block(g, 9, 3, 6, 12, P.hull);
      px(g, 9, 3, OUT); px(g, 14, 3, OUT);               // nose taper
      R(g, 10, 3, 4, 1, P.light);
      R(g, 9, 4, 1, 10, P.mid); R(g, 14, 4, 1, 10, P.mid);
      px(g, 11, 3, GUN_D); px(g, 12, 3, GUN_D);          // chin gun
      R(g, 10, 4, 4, 3, P.glass);                        // stepped canopy
      px(g, 11, 4, P.glint); px(g, 12, 4, P.glint); px(g, 10, 6, GLASS_D); px(g, 13, 6, GLASS_D);
      R(g, 10, 8, 4, 4, P.dark);                         // engine hump
      R(g, 10, 8, 4, 1, P.mid);
      px(g, 9, 9, GUN_L); px(g, 14, 9, GUN_L);           // exhausts
      emblem(g, P, 12, 13);
      // rotor hub
      R(g, 11, 9, 2, 2, OUT); px(g, 11, 9, GUN_L);
    },
  };

  // ---- turrets (24x24 top views, rotate about canvas centre) ------------------
  // Neutral shading only; rot3D adds a 1px dark under-plate per facing and the
  // whole frame is lifted 1px so the turret reads as sitting ON the hull.

  // gun barrel pointing north: plain steel, dark muzzle tip, bright collar
  function barrel(g, x, y, w, h) {
    block(g, x, y, w, h, GUN);
    R(g, x, y, w, 1, GUN_D);
    R(g, x, y + h - 2, w, 1, GUN_L);
  }

  const TURRET = {

    // Light Tank: small chamfered turret, slim 75mm barrel.
    ltnk(g, P) {
      barrel(g, 11, 3, 2, 7);
      roundBlock(g, 9, 9, 6, 6, P.hull);
      R(g, 10, 9, 4, 1, P.light); px(g, 11, 9, P.hi);
      R(g, 9, 10, 1, 4, P.mid); R(g, 14, 10, 1, 4, P.mid);
      R(g, 10, 14, 4, 1, P.mid);
      R(g, 11, 11, 2, 2, P.dark); px(g, 11, 11, P.mid);  // hatch
    },

    // Medium Tank: round turret + bustle, long 90mm barrel w/ muzzle sleeve.
    mtnk(g, P) {
      barrel(g, 11, 1, 2, 8);
      block(g, 10, 3, 4, 1, GUN_D);                      // muzzle sleeve
      roundBlock(g, 8, 8, 8, 8, P.hull);
      R(g, 9, 8, 6, 1, P.light); px(g, 11, 8, P.hi); px(g, 12, 8, P.hi);
      R(g, 8, 9, 1, 6, P.mid); R(g, 15, 9, 1, 6, P.mid);
      R(g, 9, 15, 6, 1, P.mid);
      R(g, 10, 14, 4, 2, P.dark);                        // rear bustle
      R(g, 11, 10, 2, 2, P.dark); px(g, 11, 10, P.mid);  // hatch
      px(g, 9, 11, GUN_D);                               // spotlight nub
    },

    // Mammoth: wide turret, TWO 120mm barrels + side tusk missile pods.
    htnk(g, P) {
      barrel(g, 8, 2, 2, 7); block(g, 7, 3, 4, 1, GUN_D);
      barrel(g, 14, 2, 2, 7); block(g, 13, 3, 4, 1, GUN_D);
      roundBlock(g, 7, 8, 10, 8, P.hull);
      R(g, 8, 8, 8, 1, P.light); px(g, 11, 8, P.hi); px(g, 12, 8, P.hi);
      R(g, 7, 9, 1, 6, P.mid); R(g, 16, 9, 1, 6, P.mid);
      R(g, 8, 15, 8, 1, P.mid);
      R(g, 11, 10, 2, 2, P.dark); px(g, 11, 10, P.mid);  // hatch
      R(g, 10, 14, 4, 1, P.dark);                        // bustle rack
      // tusk missile pods with bright caps + twin tube mouths (mirrored)
      block(g, 5, 11, 3, 5, GUN_D);
      R(g, 5, 11, 3, 1, P.accent2); px(g, 6, 13, GUN_L); px(g, 6, 14, GUN);
      block(g, 16, 11, 3, 5, GUN_D);
      R(g, 16, 11, 3, 1, P.accent2); px(g, 17, 13, GUN_L); px(g, 17, 14, GUN);
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

  const AIR = { orca: true, heli: true };
  // extrusion height: 2 for small/light vehicles, 3 for tanks/heavies
  const HULL_H = { jeep: 2, bggy: 2, bike: 2, stnk: 2, arty: 2,
                   apc: 3, ltnk: 3, mtnk: 3, htnk: 3, ftnk: 3,
                   msam: 3, harv: 3, mcv: 3 };
  const SQ = 0.86; // top-face squash of the 3/4 camera
  // the Mammoth Tank draws visibly bigger than every other tank, overflowing
  // its single-cell footprint like a tall building overflows upward
  const SCALE_BOOST = { htnk: 1.22 };
  function _tagScale(frames, s) { for (const f of frames) f._scaleBoost = s; }

  // constant screen-space 1px lift so turrets sit ON their hulls
  function lift1(frames) {
    return frames.map(function (f) {
      const c = mkCanvas(f.width, f.height);
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(f, 0, -1);
      return c;
    });
  }

  for (const key of KEYS) {
    const entry = {};
    for (const side of ['gdi', 'nod']) {
      const P = SIDE_PAL[side];
      const bodyOpts = AIR[key]
        ? { height: 1, squash: SQ, shadow: 0 }           // render draws air shadows
        : { height: HULL_H[key], squash: SQ, shadow: 0.30 };
      const rec = { body: rot3D(draw24(DRAW[key], P), 16, bodyOpts) };
      if (TURRET[key]) {
        rec.turret = lift1(rot3D(draw24(TURRET[key], P), 16,
                                 { height: 1, squash: SQ, shadow: 0 }));
      }
      if (ANIM[key]) {
        // Each anim frame is a canonical (north) overlay canvas that ALSO carries
        // its 16 rotated facings as index properties: anim[i] is drawable directly
        // and anim[i][facing] yields the overlay squashed/rotated to match the
        // rot3D body top-face (no extrusion/shadow of its own).
        rec.anim = ANIM[key].map(function (fn) {
          const c = draw24(fn, P);
          const frames = rot3D(c, 16, { height: 0, squash: SQ, shadow: 0 });
          for (let f = 0; f < 16; f++) c[f] = frames[f];
          return c;
        });
      }
      if (SCALE_BOOST[key]) {
        _tagScale(rec.body, SCALE_BOOST[key]);
        if (rec.turret) _tagScale(rec.turret, SCALE_BOOST[key]);
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
