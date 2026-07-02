'use strict';
// sprites_units.js — procedurally drawn VEHICLE and AIRCRAFT sprites + sidebar cameos.
// Fills SPRITES.units[key][side] ({body:[16], turret?:[16], anim?:[...]}) and
// SPRITES.cameo[key] for: jeep bggy bike apc ltnk mtnk htnk ftnk stnk arty msam
// harv mcv orca heli. Every unit is generated for BOTH sides ('gdi' gold/tan,
// 'nod' grey+red) since captures/spawns can mix ownership.
// All art is original, drawn at 1x with integer fillRect pixels, dark PAL.outline
// silhouettes, light source top-left, then rotated to 16 facings via rotFrames.

(function () {
  // Defensive boot: needs DOM (canvas) plus core.js/data.js globals.
  if (typeof document === 'undefined') return;
  if (typeof SPRITES === 'undefined' || typeof DATA === 'undefined' ||
      typeof PAL === 'undefined' || typeof mkCanvas !== 'function' ||
      typeof rotFrames !== 'function') return;

  const OUT = PAL.outline;

  // ---- per-side palettes (all tones from PAL so the art reads as one set) ----
  const SIDE_PAL = {
    gdi: {
      hull: PAL.gdi, dark: PAL.gdiDark, light: PAL.gdiLight, shadow: PAL.gdiShadow,
      track: PAL.gdiShadow, tread: PAL.gdiDark,
      accent: PAL.uiGold, accent2: PAL.fire1,
      glass: PAL.water3, glint: PAL.ion,
      metal: PAL.uiMetalDark, metalL: PAL.uiMetalLight,
    },
    nod: {
      hull: PAL.nod, dark: PAL.nodDark, light: PAL.nodLight, shadow: PAL.nodShadow,
      track: PAL.nodShadow, tread: PAL.nodDark,
      accent: PAL.nodRed, accent2: PAL.nodRedLight,
      glass: PAL.water3, glint: PAL.ion,
      metal: PAL.uiMetalDark, metalL: PAL.uiMetalLight,
    },
  };

  // ---- tiny draw helpers -----------------------------------------------------
  function R(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }

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

  // vertical track assembly with tread lines
  function treads(g, P, x, y, w, h) {
    block(g, x, y, w, h, P.track);
    for (let ty = y + 1; ty < y + h - 1; ty += 3) R(g, x, ty, w, 1, P.tread);
  }

  // small road wheel
  function wheel(g, P, x, y, w, h) {
    block(g, x, y, w, h, P.track);
    R(g, x, y, w, 1, P.tread);
  }

  // ---- canonical NORTH-facing bodies (24x24) ---------------------------------
  const DRAW = {

    // Hum-Vee: small 4-wheel scout, boxy cabin, roof-mounted MG.
    jeep(g, P) {
      wheel(g, P, 5, 7, 3, 4); wheel(g, P, 16, 7, 3, 4);
      wheel(g, P, 5, 14, 3, 4); wheel(g, P, 16, 14, 3, 4);
      block(g, 8, 6, 8, 13, P.hull);
      R(g, 8, 6, 8, 1, P.light); R(g, 8, 7, 1, 11, P.light);
      R(g, 15, 7, 1, 11, P.shadow); R(g, 9, 18, 7, 1, P.shadow);
      R(g, 9, 7, 2, 1, P.accent);                       // hood accent
      R(g, 9, 10, 6, 2, P.glass); R(g, 9, 10, 2, 1, P.glint); // windshield
      R(g, 9, 16, 6, 2, P.dark);                        // rear bed
      R(g, 11, 12, 2, 2, P.metal);                      // gun mount
      R(g, 11, 7, 2, 5, P.metal); R(g, 11, 7, 2, 1, P.metalL); // roof MG
    },

    // Nod Buggy: wide stance, tapered open frame, cage gun.
    bggy(g, P) {
      wheel(g, P, 4, 6, 3, 5); wheel(g, P, 17, 6, 3, 5);
      wheel(g, P, 4, 14, 3, 5); wheel(g, P, 17, 14, 3, 5);
      block(g, 9, 5, 6, 14, P.hull);
      R(g, 9, 5, 1, 1, OUT); R(g, 14, 5, 1, 1, OUT);    // tapered nose
      R(g, 10, 5, 4, 1, P.light); R(g, 9, 6, 1, 12, P.light);
      R(g, 14, 6, 1, 12, P.shadow);
      R(g, 10, 6, 4, 1, P.accent);                      // nose stripe
      R(g, 10, 8, 4, 2, P.glass); R(g, 10, 8, 1, 1, P.glint);
      R(g, 10, 15, 4, 3, P.dark);                       // engine
      R(g, 11, 11, 2, 2, P.metal);                      // cage mount
      R(g, 11, 6, 2, 5, P.metal); R(g, 11, 6, 2, 1, P.metalL);
    },

    // Recon Bike: narrow two-wheeler with side missile pods.
    bike(g, P) {
      block(g, 11, 3, 2, 5, P.track);                   // front wheel
      block(g, 11, 16, 2, 5, P.track);                  // rear wheel
      block(g, 6, 9, 2, 5, P.dark); R(g, 6, 9, 2, 1, P.accent2);  // left pod
      block(g, 16, 9, 2, 5, P.dark); R(g, 16, 9, 2, 1, P.accent2); // right pod
      block(g, 10, 8, 4, 8, P.hull);
      R(g, 10, 8, 4, 1, P.light); R(g, 10, 9, 1, 6, P.light);
      R(g, 13, 9, 1, 6, P.shadow);
      R(g, 11, 8, 2, 2, P.glass);                       // windscreen
      R(g, 11, 10, 2, 1, P.shadow);                     // handlebars
      R(g, 11, 11, 2, 3, P.dark);                       // rider
    },

    // APC: boxy tracked personnel carrier, roof hatch, small front MG.
    apc(g, P) {
      treads(g, P, 5, 4, 2, 16); treads(g, P, 17, 4, 2, 16);
      block(g, 8, 5, 8, 14, P.hull);
      R(g, 8, 5, 8, 2, P.light);                        // sloped front glacis
      R(g, 8, 7, 1, 11, P.light);
      R(g, 15, 7, 1, 11, P.shadow); R(g, 9, 18, 7, 1, P.shadow);
      R(g, 13, 6, 2, 2, P.metal); R(g, 13, 4, 1, 3, P.metal); // front MG
      R(g, 10, 10, 4, 4, P.dark); R(g, 11, 11, 2, 2, P.hull); // hatch ring
      R(g, 9, 15, 6, 1, P.shadow);                      // rear door seam
      R(g, 9, 13, 2, 1, P.accent);
    },

    // Light Tank hull: small tracked chassis (turret separate).
    ltnk(g, P) {
      treads(g, P, 5, 6, 3, 13); treads(g, P, 16, 6, 3, 13);
      block(g, 8, 7, 8, 11, P.hull);
      R(g, 8, 7, 8, 1, P.light); R(g, 8, 8, 1, 9, P.light);
      R(g, 15, 8, 1, 9, P.shadow);
      R(g, 9, 15, 6, 2, P.dark); R(g, 9, 16, 6, 1, P.shadow); // engine deck
      R(g, 11, 7, 2, 1, P.accent);
    },

    // Medium Tank hull: bigger chassis (turret separate).
    mtnk(g, P) {
      treads(g, P, 4, 4, 3, 16); treads(g, P, 17, 4, 3, 16);
      block(g, 7, 5, 10, 14, P.hull);
      R(g, 7, 5, 10, 2, P.light);                       // glacis
      R(g, 7, 7, 1, 10, P.light);
      R(g, 16, 7, 1, 10, P.shadow);
      R(g, 8, 16, 8, 2, P.dark); R(g, 8, 17, 8, 1, P.shadow); // engine deck
      R(g, 11, 18, 2, 1, P.accent);
    },

    // Mammoth Tank hull: extra wide, double tracks each side (turret separate).
    htnk(g, P) {
      treads(g, P, 2, 4, 3, 17); treads(g, P, 19, 4, 3, 17); // outer rails
      treads(g, P, 5, 5, 2, 15); treads(g, P, 17, 5, 2, 15); // inner rails
      block(g, 7, 5, 10, 14, P.hull);
      R(g, 8, 5, 8, 2, P.light);                        // glacis
      R(g, 7, 5, 1, 13, P.light);
      R(g, 16, 6, 1, 12, P.shadow);
      R(g, 8, 16, 8, 2, P.dark); R(g, 8, 17, 8, 1, P.shadow);
      R(g, 11, 5, 2, 1, P.accent);
    },

    // Flame Tank: rounded hull, twin nose flame nozzles, no turret.
    ftnk(g, P) {
      treads(g, P, 4, 5, 3, 15); treads(g, P, 17, 5, 3, 15);
      roundBlock(g, 7, 4, 10, 15, P.hull);
      R(g, 8, 4, 8, 1, P.light); R(g, 7, 5, 1, 12, P.light);
      R(g, 16, 5, 1, 12, P.shadow);
      R(g, 10, 9, 4, 1, P.shadow); R(g, 10, 10, 4, 2, P.dark); // fuel dome
      R(g, 9, 16, 2, 2, P.shadow); R(g, 13, 16, 2, 2, P.shadow); // rear tanks
      R(g, 11, 6, 2, 2, P.accent);                      // emblem
      // twin flame nozzles poking past the nose
      R(g, 7, 1, 4, 5, OUT); R(g, 8, 2, 2, 3, P.metal); R(g, 8, 2, 2, 1, PAL.fire2);
      R(g, 13, 1, 4, 5, OUT); R(g, 14, 2, 2, 3, P.metal); R(g, 14, 2, 2, 1, PAL.fire2);
    },

    // Stealth Tank: thin angular wedge with twin top missile racks.
    stnk(g, P) {
      wheel(g, P, 6, 7, 2, 3); wheel(g, P, 16, 7, 2, 3);
      wheel(g, P, 6, 13, 2, 3); wheel(g, P, 16, 13, 2, 3);
      block(g, 11, 3, 2, 2, P.hull);                    // pointed nose tip
      block(g, 9, 5, 6, 13, P.hull);
      R(g, 9, 5, 1, 1, OUT); R(g, 14, 5, 1, 1, OUT);    // taper
      R(g, 10, 5, 4, 1, P.light); R(g, 9, 6, 1, 10, P.light);
      R(g, 14, 6, 1, 11, P.shadow);
      R(g, 11, 3, 1, 2, P.light);
      R(g, 11, 5, 2, 1, P.accent);
      R(g, 10, 7, 4, 1, P.glass);                       // canopy slit
      // twin missile racks
      R(g, 8, 11, 4, 6, OUT); R(g, 9, 12, 2, 4, P.dark); R(g, 9, 12, 2, 1, P.accent2);
      R(g, 12, 11, 4, 6, OUT); R(g, 13, 12, 2, 4, P.dark); R(g, 13, 12, 2, 1, P.accent2);
    },

    // Artillery: open tracked chassis, long fixed 155mm gun.
    arty(g, P) {
      treads(g, P, 5, 9, 3, 10); treads(g, P, 16, 9, 3, 10);
      block(g, 8, 10, 8, 8, P.hull);
      R(g, 8, 10, 8, 1, P.light); R(g, 8, 11, 1, 6, P.light);
      R(g, 15, 11, 1, 6, P.shadow);
      R(g, 9, 13, 6, 4, P.dark);                        // open crew bay
      R(g, 10, 14, 1, 1, P.light); R(g, 12, 15, 1, 1, P.light); // crew
      R(g, 11, 17, 2, 1, P.accent);
      // gun shield
      R(g, 8, 7, 8, 3, OUT); R(g, 9, 8, 6, 2, P.dark); R(g, 9, 8, 6, 1, P.hull);
      // long barrel + recoil sleeve
      R(g, 10, 1, 4, 8, OUT); R(g, 11, 2, 2, 7, P.metal); R(g, 11, 2, 2, 1, P.metalL);
      R(g, 9, 4, 6, 4, OUT); R(g, 10, 5, 4, 2, P.shadow);
    },

    // Rocket Launcher (MLRS): tracked box with a twin rocket rack on top.
    msam(g, P) {
      treads(g, P, 4, 6, 3, 13); treads(g, P, 17, 6, 3, 13);
      block(g, 7, 7, 10, 11, P.hull);
      R(g, 7, 7, 10, 1, P.light); R(g, 7, 8, 1, 9, P.light);
      R(g, 16, 8, 1, 9, P.shadow);
      R(g, 8, 7, 2, 1, P.accent);                       // cab accent
      // raised rocket rack, two columns of three rocket tips
      R(g, 7, 9, 10, 8, OUT); R(g, 8, 10, 8, 6, P.dark);
      R(g, 8, 10, 8, 1, P.shadow);
      for (let ry = 11; ry <= 15; ry += 2) {
        R(g, 9, ry, 2, 1, P.accent2); R(g, 13, ry, 2, 1, P.accent2);
      }
      R(g, 9, 11, 1, 1, P.light); R(g, 13, 11, 1, 1, P.light);
    },

    // Harvester: big rounded ore truck with toothed front scoop + cargo bay.
    harv(g, P) {
      // scoop
      R(g, 5, 1, 14, 6, OUT);
      R(g, 6, 2, 12, 4, P.dark);
      for (let tx = 6; tx < 18; tx += 2) R(g, tx, 2, 1, 1, OUT); // teeth
      R(g, 6, 4, 12, 1, P.shadow);                      // scoop lip
      // rounded body
      roundBlock(g, 5, 6, 14, 14, P.hull);
      R(g, 6, 6, 12, 1, P.light); R(g, 5, 7, 1, 11, P.light);
      R(g, 18, 7, 1, 11, P.shadow); R(g, 6, 19, 12, 1, P.shadow);
      R(g, 8, 8, 8, 2, P.glass); R(g, 8, 8, 2, 1, P.glint);   // cab glass
      R(g, 7, 10, 2, 1, P.accent);
      // open cargo bay
      R(g, 7, 12, 10, 7, OUT); R(g, 8, 13, 8, 5, P.shadow);
      R(g, 9, 14, 1, 1, P.dark); R(g, 12, 15, 1, 1, P.dark);
      R(g, 14, 14, 1, 1, P.dark); R(g, 10, 16, 2, 1, P.dark);
    },

    // MCV: big truck — cab up front, huge box body, crane assembly on top.
    mcv(g, P) {
      for (const wy of [4, 9, 15]) {
        wheel(g, P, 4, wy, 2, 4); wheel(g, P, 18, wy, 2, 4);
      }
      // cab
      block(g, 8, 3, 8, 5, P.hull);
      R(g, 8, 3, 8, 1, P.light);
      R(g, 9, 4, 6, 2, P.glass); R(g, 9, 4, 2, 1, P.glint);
      R(g, 8, 7, 8, 1, P.dark);
      // box body
      block(g, 6, 9, 12, 11, P.hull);
      R(g, 6, 9, 12, 1, P.light); R(g, 6, 10, 1, 9, P.light);
      R(g, 17, 10, 1, 9, P.shadow); R(g, 7, 19, 10, 1, P.shadow);
      // crane: base block + arm reaching right + hook
      R(g, 7, 10, 6, 6, OUT); R(g, 8, 11, 4, 4, P.dark);
      R(g, 11, 11, 7, 4, OUT); R(g, 12, 12, 5, 2, P.metalL);
      R(g, 16, 14, 1, 3, OUT); R(g, 16, 14, 1, 2, P.metal);
      R(g, 16, 16, 1, 1, P.accent);                     // hook
      // rear hazard stripes
      for (let hx = 7; hx < 17; hx += 2) R(g, hx, 19, 1, 1, P.accent);
    },

    // Orca: VTOL gunship — slim fuselage, canopy, stub wings, wingtip fan pods.
    orca(g, P) {
      // stub wings
      block(g, 4, 10, 6, 4, P.hull);
      block(g, 14, 10, 6, 4, P.hull);
      R(g, 4, 10, 6, 1, P.light); R(g, 14, 10, 6, 1, P.light);
      R(g, 5, 11, 2, 1, P.accent); R(g, 17, 11, 2, 1, P.accent);
      // wingtip fan pods
      block(g, 3, 9, 2, 6, P.dark); block(g, 19, 9, 2, 6, P.dark);
      R(g, 3, 9, 2, 1, P.light); R(g, 19, 9, 2, 1, P.light);
      // fuselage
      block(g, 10, 3, 4, 16, P.hull);
      R(g, 10, 3, 1, 1, OUT); R(g, 13, 3, 1, 1, OUT);   // nose taper
      R(g, 11, 3, 2, 1, P.light); R(g, 10, 4, 1, 14, P.light);
      R(g, 13, 4, 1, 14, P.shadow);
      R(g, 10, 5, 4, 4, P.glass); R(g, 10, 5, 2, 2, P.glint); // canopy
      R(g, 11, 11, 2, 3, P.dark);                       // engine intake
      // tail stabilizer
      block(g, 8, 19, 8, 2, P.dark);
      R(g, 8, 19, 8, 1, P.hull);
    },

    // Apache: attack helicopter — cockpit, engine hump, stubs, tail boom + rotor.
    heli(g, P) {
      // weapon stubs
      block(g, 6, 9, 3, 2, P.dark); block(g, 15, 9, 3, 2, P.dark);
      R(g, 6, 9, 1, 2, P.accent2); R(g, 17, 9, 1, 2, P.accent2);
      // fuselage
      block(g, 9, 4, 6, 11, P.hull);
      R(g, 9, 4, 1, 1, OUT); R(g, 14, 4, 1, 1, OUT);    // nose taper
      R(g, 10, 4, 4, 1, P.light); R(g, 9, 5, 1, 9, P.light);
      R(g, 14, 5, 1, 9, P.shadow);
      R(g, 10, 5, 4, 3, P.glass); R(g, 10, 5, 2, 1, P.glint); // cockpit
      R(g, 10, 9, 4, 3, P.dark);                        // engine hump
      // tail boom + tail rotor
      block(g, 11, 15, 2, 6, P.hull);
      R(g, 12, 15, 1, 6, P.shadow);
      block(g, 13, 19, 3, 2, P.dark);
      // rotor hub
      R(g, 11, 9, 2, 2, OUT);
    },
  };

  // ---- turrets (24x24, rotate about canvas center) ----------------------------
  const TURRET = {

    // Light Tank: small chamfered turret, slim 75mm barrel.
    ltnk(g, P) {
      R(g, 10, 2, 4, 7, OUT); R(g, 11, 3, 2, 6, P.metal); R(g, 11, 3, 2, 1, P.metalL);
      roundBlock(g, 9, 9, 6, 6, P.hull);
      R(g, 10, 9, 4, 1, P.light); R(g, 9, 10, 1, 4, P.light);
      R(g, 11, 11, 2, 2, P.dark);                       // hatch
    },

    // Medium Tank: round turret, longer 90mm barrel with muzzle sleeve.
    mtnk(g, P) {
      R(g, 10, 1, 4, 8, OUT); R(g, 11, 2, 2, 7, P.metal); R(g, 11, 2, 2, 1, P.metalL);
      R(g, 9, 3, 6, 4, OUT); R(g, 10, 4, 4, 2, P.dark); // muzzle sleeve
      roundBlock(g, 8, 8, 8, 8, P.hull);
      R(g, 9, 8, 6, 1, P.light); R(g, 8, 9, 1, 6, P.light);
      R(g, 10, 14, 4, 2, P.dark);                       // rear bustle
      R(g, 11, 10, 2, 2, P.dark);                       // hatch
    },

    // Mammoth: wide turret, TWO 120mm barrels + side missile pods.
    htnk(g, P) {
      R(g, 7, 2, 4, 7, OUT); R(g, 8, 3, 2, 6, P.metal); R(g, 8, 3, 2, 1, P.metalL);
      R(g, 13, 2, 4, 7, OUT); R(g, 14, 3, 2, 6, P.metal); R(g, 14, 3, 2, 1, P.metalL);
      roundBlock(g, 7, 8, 10, 8, P.hull);
      R(g, 8, 8, 8, 1, P.light); R(g, 7, 9, 1, 6, P.light);
      R(g, 11, 10, 2, 2, P.dark);                       // hatch
      // tusk missile pods
      block(g, 6, 12, 3, 4, P.dark);
      R(g, 6, 12, 3, 1, P.accent2); R(g, 7, 13, 1, 1, P.light);
      block(g, 15, 12, 3, 4, P.dark);
      R(g, 15, 12, 3, 1, P.accent2); R(g, 16, 13, 1, 1, P.light);
    },
  };

  // ---- anim overlay frames (24x24, transparent, drawn over the body) ---------
  function harvAnim0(g, P) {
    // intake spinner, phase A: bright teeth on even columns
    for (let tx = 6; tx < 18; tx += 2) R(g, tx, 3, 1, 2, P.light);
  }
  function harvAnim1(g, P) {
    // phase B: offset teeth, cargo bay tinted slightly tiberium-green
    for (let tx = 7; tx < 18; tx += 2) R(g, tx, 3, 1, 2, P.light);
    R(g, 8, 13, 8, 5, 'rgba(72,216,88,0.3)'); // PAL.tib2 at low alpha
  }
  function orcaAnim0(g, P) {
    g.globalAlpha = 0.55;
    R(g, 0, 11, 9, 2, P.light); R(g, 15, 11, 9, 2, P.light); // fan blur, horizontal
    g.globalAlpha = 1;
  }
  function orcaAnim1(g, P) {
    g.globalAlpha = 0.55;
    R(g, 3, 7, 2, 10, P.light); R(g, 19, 7, 2, 10, P.light); // fan blur, vertical
    g.globalAlpha = 1;
  }
  function heliAnim0(g, P) {
    g.globalAlpha = 0.5;
    R(g, 2, 9, 20, 2, P.light);                        // main rotor blur bar
    g.globalAlpha = 0.25;
    R(g, 11, 2, 2, 16, P.light);
    g.globalAlpha = 1;
  }
  function heliAnim1(g, P) {
    g.globalAlpha = 0.5;
    R(g, 11, 1, 2, 18, P.light);
    g.globalAlpha = 0.25;
    R(g, 3, 9, 18, 2, P.light);
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

  // ---- cameos (64x48) ----------------------------------------------------------
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
    R(g, 0, 0, 64, 48, PAL.cameoBg);
    // subtle deterministic speckle so the slate bg isn't dead flat
    g.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < 40; i++) g.fillRect((i * 13) % 64, (i * 29) % 44, 1, 1);
    // unit drawn big: 2x nearest-neighbour
    g.drawImage(comp, 0, 0, 24, 24, 8, -4, 48, 48);
    // name band (dark backing keeps the tiny text readable)
    R(g, 0, 36, 64, 8, 'rgba(0,0,0,0.5)');
    g.font = '7px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = PAL.uiText;
    g.fillText(d.name, 32, 40, 62);
    // faction-neutral gold bottom stripe
    R(g, 0, 44, 64, 4, PAL.uiGold);
    // thin 1px black frame
    R(g, 0, 0, 64, 1, '#000'); R(g, 0, 47, 64, 1, '#000');
    R(g, 0, 0, 1, 48, '#000'); R(g, 63, 0, 1, 48, '#000');
    return c;
  }

  for (const key of KEYS) SPRITES.cameo[key] = makeCameo(key);
})();
