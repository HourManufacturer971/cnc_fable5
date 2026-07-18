'use strict';
// missions.js — the campaign: two separate faction arcs, briefings, progress.
// Global: MISSIONS (+ MissionProgress). Consumed by main.js (setup, win
// check, theater map), ai.js (difficulty knobs via game.mission) and
// render.js (objective HUD line).
//
// CLASSIC STRUCTURE, ORIGINAL FICTION. Each faction fights its OWN ten-
// mission campaign (MISSIONS.udc / MISSIONS.srp, picked via MISSIONS.arc):
// the UDC counter-offensive and the Serpent ascension are different wars
// told from different sides, built from the classic mission archetypes —
// beachhead, economy, holdout, commando raid, economy hunt, convoy escort,
// sabotage, capture-intact, stronghold assault, fortress finale. All text,
// names and story are original Harvest War fiction.
//
// Each mission:
//   n          1-based order within its arc (also the unlock index)
//   title      shown on the theater map, ops ledger and briefing header
//   sector     flavor stamp under the briefing title
//   terr       [x, y] 0..1 — territory position on the theater map
//   seed       fixed map seed, so a mission is a repeatable battlefield
//   credits    human starting credits        (default 5000)
//   aiCredits  AI starting credits           (default 5000)
//   aiCalm     multiplier on the AI's attack-wave cadence — above 1 is a
//              gentler opponent, below 1 keeps the waves coming
//   aiWaveCap  ceiling on units per AI strike wave (default 9)
//   holdout    true = fortress scenario: the player starts at the center of
//              the map inside a rock ring with three gated passes (map.js)
//   shore      true = a sea with a landing beach spans the southern map edge
//              (map.js); reinforce events with at:'south' come in over the sand
//   noHumanSpawn  true = no MCV/escort — the mission's setup() spawns your force
//   setup(g,o) bespoke staging; o = { side, aiSide, hs, as }
//   objective  { type: 'annihilate' }
//              { type: 'harvest', amount }        — HOLD that many credits at once
//              { type: 'survive', minutes }       — outlast the onslaught
//              { type: 'killEconomy' }            — destroy every enemy
//                refinery and harvester (arms once the enemy has built one)
//              { type: 'escort', unit, dest, radius } — deliver the unit
//              { type: 'capture', btype }         — engineer the prize INTACT
//              { type: 'demolish', btype }        — destroy every standing
//                building of that type (arms when one exists)
//   brief      [paragraphs] — this arc's in-universe sitrep
//   objText    one-line objective summary for briefing + HUD

const MISSIONS = {

// =============================================================================
// THE UDC CAMPAIGN — the Coalition counter-offensive
// =============================================================================
udc: [
  {
    n: 1, title: 'FIRST FOOTHOLD',
    sector: 'THE VERDANT REACH — SOUTHERN FRONTIER', terr: [0.10, 0.82], seed: 8121,
    credits: 3000, aiCredits: 2500, aiCalm: 2.2, aiWaveCap: 3, aiNoSell: true,
    noHumanSpawn: true, shore: true,
    // the classic opening kit: power, refining, barracks, boots. No radar, no
    // armor, no air — the tech tree grows one operation at a time. (Both
    // factions' infantry keys are listed: `allow` binds every player in the
    // mission, so the enemy garrison lives by the same rules.)
    allow: ['nuke', 'proc', 'silo', 'pyle', 'hand', 'e1', 'e2', 'e3', 'e4', 'e6', 'harv'],
    objective: { type: 'annihilate' },
    objText: 'Hold the beach until the MCV lands, then destroy the Serpent Order outpost.',
    brief: [
      'Commander. The Coalition is coming back to this frontier, and it starts on this beach. A Serpent Order cell runs the valley from a fortified outpost — light garrison, a standing gun, no armor worth the name. What it does not have is any idea we are coming.',
      'You land first: one rifle team to hold the shore while the boats cycle. The MCV comes in behind you — deploy it, raise power and a refinery, and train infantry. Heavy equipment cannot come ashore this far south, so rifles and rockets will have to do. This is your proving ground, Commander — burn that outpost off the map.',
    ],
    setup(g, o) {
      // the landing team goes in ahead of the MCV — put them ON the sand,
      // just up from the surf (the shore map keeps this ground bare)
      MISSIONS.squad(g, o.side, ['e1', 'e1', 'e1', 'e3'],
        { cx: o.hs.cx, cy: Math.min(o.hs.cy + 5, C.MAP_H - 9) });
      // the outpost is a camp, not a war machine: no conyard, no refinery.
      // A barracks dribbles riflemen from a fixed purse until it runs dry —
      // the classic first-mission enemy
      for (const id of [...g.ai.buildingIds]) { const b = g.buildings.get(id); if (b) removeBuilding(b); }
      for (const id of [...g.ai.unitIds]) { const u = g.units.get(id); if (u) removeUnit(u); }
      MISSIONS.placeB(g, o.aiSide, 'nuke', o.as.cx - 1, o.as.cy - 1);
      MISSIONS.placeB(g, o.aiSide, o.aiSide === 'udc' ? 'pyle' : 'hand', o.as.cx + 2, o.as.cy);
      MISSIONS.placeB(g, o.aiSide, o.aiSide === 'udc' ? 'gtwr' : 'gun', o.as.cx - 2, o.as.cy + 3);
      MISSIONS.squad(g, o.aiSide, o.aiSide === 'udc' ? ['e1', 'e1', 'e3'] : ['e1', 'e1', 'e4'],
        { cx: o.as.cx + 1, cy: o.as.cy + 4 });
    },
    events: [
      { at: 12, eva: 'Landing team ashore. Hold the beach — the MCV is close behind you.' },
      { at: 45,
        eva: 'Second boat is in. Riflemen moving up the beach.',
        reinforce: { types: ['e1', 'e1', 'e3'], at: 'south' } },
      { at: 75,
        eva: 'The MCV has made landfall. Deploy it and dig in.',
        reinforce: { types: ['mcv', 'e1', 'e1'], at: 'south' } },
      { at: 240,
        eva: 'Enemy scouts have found the beachhead. Expect a raid.',
        attack: { types: { udc: ['jeep', 'e1'], srp: ['bggy', 'e1'] }, target: 'base' } },
      { every: 300, from: 600, until: 1500,
        eva: 'The outpost is pushing patrols toward your line.',
        attack: { types: { udc: ['e1', 'e1', 'e3'], srp: ['e1', 'e1', 'e4'] }, target: 'base' } },
      { when: g => {
          let n = 0;
          for (const id of g.ai.buildingIds) { const b = g.buildings.get(id); if (b && !DATA.buildings[b.type].wall) n++; }
          return g._m1Seen === undefined ? ((g._m1Seen = n), false) : n < g._m1Seen;
        },
        eva: 'Their outpost is burning. Finish the job.' },
    ],
  },
  {
    n: 2, title: 'THE GREEN ENGINE',
    sector: 'THE GREENBELT — CONTESTED FIELDS', terr: [0.22, 0.70], seed: 4257,
    credits: 3000, aiCredits: 5000, aiCalm: 1.4,
    objective: { type: 'harvest', amount: 6000 },
    objText: 'Hold a treasury of 6000 credits at once. Storage silos will be essential.',
    brief: [
      'The war effort runs on chrysalite, Commander, and headquarters is running on fumes. This sector holds some of the richest fields we have charted — and a Serpent Order garrison that knows it.',
      'Your task is not conquest. Establish refining operations and amass a WAR CHEST of six thousand credits — held in your treasury at one time, so raise storage silos and spend with care. Defend the harvest chain; wipe the enemy out if you must, but the balance is the mission.',
    ],
    events: [
      { at: 50,
        eva: 'Survey drones report a BLUE chrysalite lode in the midfield. Double value at the refinery.',
        fn: g => {
          for (let i = 0; i < g.tib.length; i++) {
            if (g.tibType[i] === 1 && g.tib[i] > 0) {
              const cx = i % C.MAP_W, cy = (i / C.MAP_W) | 0;
              Fog.revealCircle(g, cx, cy, 5);
              _ping(g, cellCenterX(cx), cellCenterY(cy), 'crate');
              break;
            }
          }
        } },
      { at: 260,
        eva: 'Raiders inbound — they are hunting your harvesters!',
        attack: { types: { udc: ['jeep', 'jeep', 'e1'], srp: ['bike', 'bggy', 'e1'] }, target: 'harv' } },
      { every: 210, from: 470, until: 1400,
        eva: 'Another raiding party is closing on the harvest line.',
        attack: { types: { udc: ['jeep', 'jeep', 'e3'], srp: ['bike', 'bike', 'e3'] }, target: 'harv' } },
      { at: 430,
        eva: 'Command has diverted a spare harvester to your operation.',
        reinforce: { types: ['harv'] } },
      { when: g => g.human.credits >= 4800,
        eva: 'The war chest is nearly full. Guard the vault.' },
    ],
  },
  {
    n: 3, title: 'STATIC LINE',
    sector: 'KARST PLATEAU — THE OLD HILL FORT', terr: [0.31, 0.56], seed: 9773, holdout: true,
    credits: 8000, aiCredits: 11000, aiCalm: 0.5,
    objective: { type: 'survive', minutes: 15 },
    objText: 'Hold the plateau for 15 minutes. Fortify the three passes.',
    brief: [
      'Bad news, Commander. The Serpent Order has massed for a counter-offensive, and the only ground worth holding is this walled plateau in the dead center of the sector — high rock all around, three passes in.',
      'There is a chrysalite pocket inside the walls, but it will not carry you fifteen minutes — the rich fields lie OUTSIDE the passes, and every convoy you send is a convoy you must cover. Wall the gaps, keep the power humming, and hold until the relief column arrives.',
    ],
    events: [
      { at: 10, eva: 'Relief column ETA fifteen minutes. Seal the passes and dig in.' },
      { at: 175,
        eva: 'Armor column approaching from the NORTH!',
        attack: { from: 'north', types: { udc: ['mtnk', 'mtnk', 'jeep'], srp: ['ltnk', 'ltnk', 'bike'] } } },
      { at: 350,
        eva: 'Flame units moving in from the SOUTH-WEST!',
        attack: { from: 'southwest', types: { udc: ['mtnk', 'e2', 'e2', 'jeep'], srp: ['ftnk', 'e4', 'e4', 'bike'] } } },
      { at: 460, crates: 2, eva: 'Supply drop inbound — salvage crates at the perimeter.' },
      { at: 545,
        eva: 'Artillery sighted EAST — do not let them shell the walls!',
        attack: { from: 'east', types: { udc: ['msam', 'msam', 'mtnk'], srp: ['arty', 'arty', 'ltnk'] } } },
      { at: 700,
        eva: 'The relief vanguard has broken through to your position!',
        reinforce: { types: ['mtnk', 'mtnk', 'e3', 'e3'] } },
      { at: 790,
        eva: 'FINAL ASSAULT — everything they have left is coming. Hold the line!',
        attack: [
          { from: 'north', types: { udc: ['mtnk', 'mtnk', 'e3', 'e1', 'e1'], srp: ['ltnk', 'ltnk', 'e4', 'e1', 'e1'] } },
          { from: 'south', types: { udc: ['mtnk', 'jeep', 'e3', 'e3'], srp: ['ftnk', 'bike', 'e3', 'e3'] } },
        ] },
    ],
  },
  {
    n: 4, title: 'BROKEN SPEAR',
    sector: 'THE SPINE — SERPENT SIGNAL RIDGE', terr: [0.24, 0.40], seed: 2718,
    credits: 0, aiCredits: 0, aiCalm: 9, aiWaveCap: 0, aiNoSell: true,
    noHumanSpawn: true,
    objective: { type: 'demolish', btype: 'hq' },
    objText: 'Destroy the Serpent command hub with your raid team. No base. No reinforcements.',
    brief: [
      'Forget everything you know about building a base, Commander — tonight you are a knife. The Serpent Order coordinates every raid on this front through one command hub on the ridge, and the Coalition cannot advance while it stands.',
      'You get a commando, a fire team, and one transport. Patrols walk the approaches and towers watch the ridge road. Slip the pickets or silence them fast, put the hub in the dirt, and get your people out. The team is the mission — spend it wisely.',
    ],
    setup(g, o) {
      // the raid team is everything you have
      MISSIONS.squad(g, o.side, ['rmbo', 'e3', 'e3', 'apc'], o.hs);
      // the command hub, ringed by its garrison
      const hub = MISSIONS.placeB(g, o.aiSide, 'hq', o.as.cx + 3, o.as.cy + 2);
      const twr = o.aiSide === 'udc' ? 'gtwr' : 'gun';
      if (hub) {
        MISSIONS.placeB(g, o.aiSide, twr, hub.cx - 2, hub.cy + 2);
        MISSIONS.placeB(g, o.aiSide, twr, hub.cx + hub.w + 1, hub.cy);
      }
      // patrol pickets on the approaches
      const picket = o.aiSide === 'udc' ? ['e1', 'e3'] : ['e1', 'e4'];
      for (const t of [0.4, 0.65]) {
        const cx = Math.round(o.hs.cx + (o.as.cx - o.hs.cx) * t);
        const cy = Math.round(o.hs.cy + (o.as.cy - o.hs.cy) * t);
        MISSIONS.squad(g, o.aiSide, picket, { cx, cy });
      }
    },
    events: [
      { at: 8, eva: 'Raid team on the ground. Keep them alive — there are no reinforcements.' },
      { at: 30,
        eva: 'The command hub is on the ridge. Marking it now.',
        fn: g => {
          for (const b of g.buildings.values()) {
            if (b.type !== 'hq' || b.owner === g.humanSide) continue;
            Fog.revealCircle(g, b.cx + 1, b.cy + 1, 5);
            _ping(g, cellCenterX(b.cx + 1), cellCenterY(b.cy + 1), 'attack');
            break;
          }
        } },
      { at: 150,
        eva: 'A patrol is sweeping your last known position. Keep moving.',
        attack: { types: { udc: ['jeep', 'e1'], srp: ['bggy', 'e1'] }, target: 'base' } },
      { when: g => {
          for (const b of g.buildings.values()) {
            if (b.type === 'hq' && b.owner !== g.humanSide) return b.hp < b.maxHp * 0.5;
          }
          return false;
        },
        eva: 'The hub is burning! Bring it down and fall back!' },
    ],
  },
  {
    n: 5, title: 'SCORCHED HARVEST',
    sector: 'ASHFIELD BASIN — THE ENEMY BREADBASKET', terr: [0.42, 0.62], seed: 3141,
    credits: 6000, aiCredits: 7000,
    objective: { type: 'killEconomy' },
    objText: 'Destroy every Serpent Order refinery and harvester in the sector.',
    brief: [
      'We cannot beat their army head-on in this sector, Commander — but an army is only as strong as its purse. The Serpent Order feeds this entire front from the refineries here.',
      'Cut the artery. Every refinery, every harvester — hunt them down and burn them. You do not need to level their base; starve it and the front collapses on its own.',
    ],
    events: [
      { at: 45, eva: 'Their ore trucks run the midfield at all hours. Hunt them where they harvest.' },
      { at: 300, creatures: 3, eva: 'Fleshlings are migrating through the crystal fields. They attack anything that moves.' },
      { at: 660, creatures: 4, eva: 'More fleshlings in the fields. Keep your infantry clear.' },
      { when: g => {
          let n = 0;
          for (const id of g.ai.buildingIds) { const b = g.buildings.get(id); if (b && b.type === 'proc') n++; }
          for (const id of g.ai.unitIds) { const u = g.units.get(id); if (u && DATA.units[u.type].harvester) n++; }
          const drop = g._m4Eco !== undefined && n < g._m4Eco;
          g._m4Eco = n;
          return drop;
        },
        repeat: true,
        eva: 'They felt that. Retaliation force inbound!',
        attack: { types: { udc: ['mtnk', 'jeep', 'e3'], srp: ['ltnk', 'bike', 'e3'] }, target: 'base' } },
    ],
  },
  {
    n: 6, title: 'THE LONG ROAD',
    sector: 'PILGRIM ROAD — CONVOY COUNTRY', terr: [0.52, 0.46], seed: 5150,
    credits: 0, aiCredits: 0, aiCalm: 9, aiWaveCap: 0, aiNoSell: true,
    objective: { type: 'escort', unit: 'apc', dest: 'ai', radius: 2.5 },
    noHumanSpawn: true,
    objText: 'Deliver the transport to the extraction beacon. If it dies, the mission dies with it.',
    brief: [
      'No base this time, Commander. Salvage teams pulled a sealed Serpent prototype core out of the ridge wreckage, and every warlord in the valley wants it back. It rides in an armored transport, and you ride with it.',
      'Your escort is what you see — no MCV, no reinforcements, no second chances. Checkpoints and gun nests line the valley road. Scout ahead, pick your route, and put that transport on the extraction beacon in one piece.',
    ],
    setup(g, o) {
      for (const id of g.ai.buildingIds.slice()) {
        const b = g.buildings.get(id);
        if (b) removeBuilding(b);
      }
      const conv = o.side === 'udc'
        ? ['apc', 'mtnk', 'mtnk', 'e3', 'e3', 'jeep']
        : ['apc', 'ltnk', 'ltnk', 'e3', 'e3', 'bggy'];
      MISSIONS.squad(g, o.side, conv, o.hs);
      const twr = o.aiSide === 'udc' ? 'gtwr' : 'gun';
      const picket = o.aiSide === 'udc' ? ['e1', 'e3', 'jeep'] : ['e1', 'e3', 'bggy'];
      for (const t of [0.35, 0.55, 0.78]) {
        const cx = Math.round(o.hs.cx + (o.as.cx - o.hs.cx) * t);
        const cy = Math.round(o.hs.cy + (o.as.cy - o.hs.cy) * t);
        MISSIONS.placeB(g, o.aiSide, twr, cx, cy);
        MISSIONS.squad(g, o.aiSide, picket, { cx, cy });
      }
      MISSIONS.placeB(g, o.aiSide, twr, o.as.cx - 2, o.as.cy);
      MISSIONS.squad(g, o.aiSide, o.aiSide === 'udc' ? ['mtnk', 'e3'] : ['ltnk', 'e3'], o.as);
    },
    events: [
      { at: 8, eva: 'Convoy is rolling. The transport MUST survive — screen it at all times.' },
      { at: 35, eva: 'Recon marks gun nests along the valley road. Scout before you commit the column.' },
      { when: g => {
          for (const id of g.human.unitIds) {
            const u = g.units.get(id);
            if (u && u.type === 'apc') return u.hp < u.maxHp * 0.5;
          }
          return false;
        },
        eva: 'The transport is taking heavy fire! Pull it back and screen it!' },
      { when: g => {
          const d = g.startPos.ai;
          for (const id of g.human.unitIds) {
            const u = g.units.get(id);
            if (u && u.type === 'apc') return dist(u.x, u.y, cellCenterX(d.cx), cellCenterY(d.cy)) < 15 * C.CELL;
          }
          return false;
        },
        eva: 'Extraction beacon in sight. Punch through!' },
    ],
  },
  {
    n: 7, title: 'SILENCE THE TEMPLE',
    sector: 'EMBER VALE — THE TEMPLE GROUNDS', terr: [0.47, 0.30], seed: 4004,
    credits: 6000, aiCredits: 10000, aiCalm: 0.8,
    objective: { type: 'demolish', btype: 'tmpl' },
    objText: 'Destroy the Serpent Temple before its fire falls. Everything else is optional.',
    brief: [
      'The Serpent Order has finished a Temple in this valley, Commander, and it is not for praying. Their warheads charge inside it RIGHT NOW — the first launch will land on the relief columns massing behind you.',
      'You have a base, a war chest, and no time to be thorough. Their garrison will fight you for every field; ignore what you can and put every gun that matters on the Temple. When it falls, the sky over this front belongs to us again.',
    ],
    setup(g, o) {
      const b = MISSIONS.placeB(g, o.aiSide, 'tmpl', o.as.cx + 3, o.as.cy + 2);
      const adv = o.aiSide === 'udc' ? 'atwr' : 'obli';
      if (b) {
        MISSIONS.placeB(g, o.aiSide, adv, b.cx - 2, b.cy + 2);
        MISSIONS.placeB(g, o.aiSide, adv, b.cx + b.w + 1, b.cy + 2);
        MISSIONS.placeB(g, o.aiSide, 'nuk2', b.cx + 1, b.cy - 3);
      }
    },
    events: [
      { at: 25,
        eva: 'The Temple is live and charging. Marking the target.',
        fn: g => {
          for (const b of g.buildings.values()) {
            if (b.type !== 'tmpl' || b.owner === g.humanSide) continue;
            Fog.revealCircle(g, b.cx + 1, b.cy + 1, 6);
            _ping(g, cellCenterX(b.cx + 1), cellCenterY(b.cy + 1), 'strike');
            break;
          }
        } },
      { at: 420,
        eva: 'Reinforcements at the landing zone. Keep the pressure on the Temple.',
        reinforce: { types: ['mtnk', 'msam', 'e3', 'e3'] } },
      { when: g => {
          for (const b of g.buildings.values()) {
            if (b.type === 'tmpl' && b.owner !== g.humanSide) return b.hp < b.maxHp * 0.5;
          }
          return false;
        },
        eva: 'The Temple is cracking! Do not let their engineers reach it — finish it NOW!' },
    ],
  },
  {
    n: 8, title: 'INSIDE JOB',
    sector: 'BLACKWATER CROSSING — DEEP BEHIND THE LINES', terr: [0.63, 0.55], seed: 7414,
    credits: 7000, aiCredits: 9000, aiCalm: 0.9,
    objective: { type: 'capture', btype: 'tmpl' },
    objText: 'Capture the Serpent Temple INTACT with an engineer. If it falls, the mission fails.',
    brief: [
      'Listen carefully, Commander, because this one is delicate. The Serpent Order operates a second Temple in this sector — and after Ember Vale, our analysts want this one breathing, not burning. Its launch codes, its doctrine archives, everything, intact.',
      'It will be charging a nuclear strike the entire time you are on the ground, so you have a clock even though nobody set one. Fight through the garrison, but keep your guns OFF the Temple — the day an engineer walks through its door, the war changes.',
    ],
    setup(g, o) {
      const bt = o.side === 'udc' ? 'tmpl' : 'eye';
      const b = MISSIONS.placeB(g, o.aiSide, bt, o.as.cx + 3, o.as.cy + 2);
      const twr = o.aiSide === 'udc' ? 'gtwr' : 'gun';
      if (b) {
        MISSIONS.placeB(g, o.aiSide, twr, b.cx - 2, b.cy + 2);
        MISSIONS.placeB(g, o.aiSide, twr, b.cx + b.w + 1, b.cy + 2);
      }
    },
    events: [
      { at: 30,
        eva: 'The prize must be taken INTACT. An engineer must reach it — keep your guns off it.',
        fn: g => {
          const ob = g.mission.objective;
          const bt = typeof ob.btype === 'object' ? ob.btype[g.humanSide] : ob.btype;
          for (const b of g.buildings.values()) {
            if (b.type !== bt) continue;
            Fog.revealCircle(g, b.cx + 1, b.cy + 1, 5);
            _ping(g, cellCenterX(b.cx + 1), cellCenterY(b.cy + 1), 'crate');
            break;
          }
        } },
      { when: g => {
          const ob = g.mission.objective;
          const bt = typeof ob.btype === 'object' ? ob.btype[g.humanSide] : ob.btype;
          for (const b of g.buildings.values()) {
            if (b.type === bt && b.owner !== g.humanSide) return b.hp < b.maxHp * 0.6;
          }
          return false;
        },
        eva: 'WARNING — the target structure is burning! Cease fire around it!' },
      { at: 420,
        eva: 'An engineering detachment has arrived at the landing zone.',
        reinforce: { types: ['e6', 'e6', 'apc'] } },
    ],
  },
  {
    n: 9, title: 'SEVERED HEAD',
    sector: "THE SERPENT'S THROAT — FORTIFIED GORGE", terr: [0.72, 0.36], seed: 6008,
    credits: 8000, aiCredits: 12000, aiCalm: 0.7, aiWaveCap: 12,
    objective: { type: 'annihilate' },
    objText: 'Annihilate the Serpent Order stronghold. Total victory.',
    brief: [
      'This is the one, Commander. The Serpent Order’s regional stronghold — deep coffers, layered defenses, and a Temple that will be charging a nuclear strike from the moment you arrive.',
      'There is no quota and no clock. Build, grind, and take them apart piece by piece. Expect their heaviest armor and constant pressure. Cut off the serpent’s head, and the region is free.',
    ],
    events: [
      { at: 25, eva: 'Their Temple is already charging. Watch the sky, Commander.' },
      { at: 250,
        eva: 'Heavy armor reinforcements have reached the sector.',
        reinforce: { types: ['htnk', 'mtnk'] } },
      { every: 340, from: 650, until: 2400,
        eva: 'Fresh reinforcements at the landing zone.',
        reinforce: { types: ['mtnk', 'e3', 'e3'] } },
      { when: g => {
          let sup = 0;
          for (const id of g.ai.buildingIds) {
            const b = g.buildings.get(id);
            if (b && DATA.buildings[b.type].superweapon) sup++;
          }
          if (sup > 0) { g._m5Sup = true; return false; }
          return !!g._m5Sup;
        },
        eva: 'Their superweapon is DOWN. Press the attack!' },
    ],
  },
  {
    n: 10, title: 'AVALANCHE',
    sector: 'AVALANCHE FOOTHILLS — THE LAST FORTRESS', terr: [0.85, 0.22], seed: 9091,
    credits: 10000, aiCredits: 16000, aiCalm: 0.5, aiWaveCap: 14,
    objective: { type: 'annihilate' },
    objText: 'Annihilate the fortress. Everything they have is already built — and pointed at you.',
    brief: [
      'No preamble, Commander. The last Serpent fortress in the theater is dug in across this valley — refineries running, factories hot, defense grid live, Temple charging. They have had years to prepare and they know you are coming.',
      'You get a war chest, a steady trickle of reinforcements, and the truth: this will be a grind. Take ground, hold it, and bring the mountain down on them. Win here, and the war is over.',
    ],
    setup(g, o) {
      const A = o.aiSide, as = o.as;
      const fac = A === 'udc' ? 'weap' : 'afld';
      const inf = A === 'udc' ? 'pyle' : 'hand';
      const sup = A === 'udc' ? 'eye' : 'tmpl';
      const twr = A === 'udc' ? 'gtwr' : 'gun';
      const adv = A === 'udc' ? 'atwr' : 'obli';
      MISSIONS.placeB(g, A, 'nuk2', as.cx - 4, as.cy - 2);
      MISSIONS.placeB(g, A, 'nuk2', as.cx + 4, as.cy - 2);
      MISSIONS.placeB(g, A, 'proc', as.cx - 3, as.cy + 3);
      MISSIONS.placeB(g, A, 'silo', as.cx, as.cy + 5);
      MISSIONS.placeB(g, A, fac, as.cx + 4, as.cy + 2);
      MISSIONS.placeB(g, A, inf, as.cx + 2, as.cy - 4);
      MISSIONS.placeB(g, A, 'hq', as.cx - 2, as.cy - 5);
      MISSIONS.placeB(g, A, sup, as.cx + 6, as.cy - 4);
      const dx = o.hs.cx < as.cx ? -1 : 1, dy = o.hs.cy < as.cy ? -1 : 1;
      MISSIONS.placeB(g, A, twr, as.cx + dx * 6, as.cy + dy * 2);
      MISSIONS.placeB(g, A, adv, as.cx + dx * 4, as.cy + dy * 5);
      MISSIONS.placeB(g, A, twr, as.cx + dx * 1, as.cy + dy * 7);
      MISSIONS.squad(g, A, A === 'udc' ? ['harv', 'mtnk', 'mtnk'] : ['harv', 'ltnk', 'ltnk'],
        { cx: as.cx - 2, cy: as.cy + 4 });
    },
    events: [
      { at: 20, eva: 'Their fortress is fully operational. Expect immediate and constant pressure.' },
      { at: 300,
        eva: 'First reinforcement wave has arrived.',
        reinforce: { types: ['mtnk', 'mtnk', 'e3', 'e3'] } },
      { every: 400, from: 700, until: 3600,
        eva: 'Reinforcements at the landing zone.',
        reinforce: { types: ['htnk', 'e3', 'e3'] } },
      { every: 420, from: 500, crates: 1, eva: 'Supply drop on the perimeter.' },
    ],
  },
],

// =============================================================================
// THE SERPENT CAMPAIGN — the ascension of the Order
// =============================================================================
srp: [
  {
    n: 1, title: 'FIRST SERMON',
    sector: 'THE VERDANT REACH — SOUTHERN FRONTIER', terr: [0.88, 0.30], seed: 8121,
    credits: 0, aiCredits: 0, aiCalm: 9, aiWaveCap: 0, aiNoSell: true,
    noHumanSpawn: true,
    // the classic squad mission: no base, no production for ANYONE — the
    // empty whitelist locks every build item, and setup() strips the stock
    // enemy base down to a hand-placed listening post
    allow: [],
    objective: { type: 'annihilate' },
    objText: 'No base, no production. Wipe out the UDC listening post with the faithful you are given.',
    brief: [
      'There is no base tonight, child of the Serpent. No factories, no harvest, no war machine — the Order asks for something older: faith, and a knife in the dark. A Coalition listening post has taken root upriver, and its antennas drink every whisper the Order breathes.',
      'Take your cell and silence it. Kill the garrison, flatten the post, leave nothing standing that flies their colors. More of the faithful will find you on the road — the Order provides. Prove tonight that the Serpent needs no engine of war to win one.',
    ],
    setup(g, o) {
      // strip the stock enemy base: the listening post is hand-built below
      for (const id of [...g.ai.buildingIds]) { const b = g.buildings.get(id); if (b) removeBuilding(b); }
      for (const id of [...g.ai.unitIds]) { const u = g.units.get(id); if (u) removeUnit(u); }
      // your cell — everything the Order grants you tonight
      MISSIONS.squad(g, o.side, ['e1', 'e1', 'e1', 'e1', 'e3'], o.hs);
      // the listening post: comm array, its power, and a standing garrison
      MISSIONS.placeB(g, o.aiSide, 'hq', o.as.cx, o.as.cy);
      MISSIONS.placeB(g, o.aiSide, 'nuke', o.as.cx - 3, o.as.cy + 1);
      MISSIONS.squad(g, o.aiSide, ['e1', 'e1', 'e3'], { cx: o.as.cx + 2, cy: o.as.cy + 3 });
      // pickets walk the approaches between you and the post
      for (const t of [0.45, 0.7]) {
        const cx = Math.round(o.hs.cx + (o.as.cx - o.hs.cx) * t);
        const cy = Math.round(o.hs.cy + (o.as.cy - o.hs.cy) * t);
        MISSIONS.squad(g, o.aiSide, ['e1', 'e1'], { cx, cy });
      }
    },
    events: [
      { at: 10, eva: 'Your cell is assembled. There will be no base — the faithful you carry ARE the mission.' },
      { at: 40,
        eva: 'The listening post sits upriver. It hears everything. Make it hear you last.',
        fn: g => {
          for (const b of g.buildings.values()) {
            if (b.type !== 'hq' || b.owner === g.humanSide) continue;
            Fog.revealCircle(g, b.cx + 1, b.cy + 1, 5);
            _ping(g, cellCenterX(b.cx + 1), cellCenterY(b.cy + 1), 'attack');
            break;
          }
        } },
      { at: 150,
        eva: 'More of the faithful have answered the call. Flame walks with them.',
        reinforce: { types: ['e1', 'e1', 'e4'] } },
      { at: 340,
        eva: 'The Order sends rockets for the antennas. Bring them down.',
        reinforce: { types: ['e3', 'e3'] } },
      { when: g => {
          for (const b of g.buildings.values()) {
            if (b.type === 'hq' && b.owner !== g.humanSide) return b.hp < b.maxHp * 0.5;
          }
          return false;
        },
        eva: 'The antennas are burning! Finish it — leave nothing standing.' },
    ],
  },
  {
    n: 2, title: 'TITHES OF THE EARTH',
    sector: 'THE GREENBELT — CONTESTED FIELDS', terr: [0.76, 0.44], seed: 4257,
    credits: 3000, aiCredits: 5000, aiCalm: 1.4,
    objective: { type: 'harvest', amount: 6000 },
    objText: 'Hold a treasury of 6000 credits at once. Build silos — the Order audits the vault, not the ledger.',
    brief: [
      'Faith does not fuel the war machine, disciple. Chrysalite does. The Order requires a war chest of six thousand credits from this sector, and the Coalition squats upon the richest fields.',
      'Take what is ours beneath their noses. The quota is counted in the vault, not the ledger — six thousand credits held at once. Raise silos, guard your harvesters as you would your own blood, and spend only what the harvest can replace.',
    ],
    events: [
      { at: 50,
        eva: 'The faithful whisper of a BLUE chrysalite lode in the midfield. Double value at the refinery.',
        fn: g => {
          for (let i = 0; i < g.tib.length; i++) {
            if (g.tibType[i] === 1 && g.tib[i] > 0) {
              const cx = i % C.MAP_W, cy = (i / C.MAP_W) | 0;
              Fog.revealCircle(g, cx, cy, 5);
              _ping(g, cellCenterX(cx), cellCenterY(cy), 'crate');
              break;
            }
          }
        } },
      { at: 260,
        eva: 'Raiders inbound — they are hunting your harvesters!',
        attack: { types: { udc: ['jeep', 'jeep', 'e1'], srp: ['bike', 'bggy', 'e1'] }, target: 'harv' } },
      { every: 210, from: 470, until: 1400,
        eva: 'Another raiding party is closing on the harvest line.',
        attack: { types: { udc: ['jeep', 'jeep', 'e3'], srp: ['bike', 'bike', 'e3'] }, target: 'harv' } },
      { at: 430,
        eva: 'The Order has diverted a spare harvester to your tithe.',
        reinforce: { types: ['harv'] } },
      { when: g => g.human.credits >= 4800,
        eva: 'The tithe is nearly gathered. Guard the vault.' },
    ],
  },
  {
    n: 3, title: 'THE SANCTUM HOLDS',
    sector: 'KARST PLATEAU — THE OLD HILL FORT', terr: [0.68, 0.28], seed: 9773, holdout: true,
    credits: 8000, aiCredits: 11000, aiCalm: 0.5,
    objective: { type: 'survive', minutes: 15 },
    objText: 'Hold the sanctum for 15 minutes. Seal the three passes with stone and flame.',
    brief: [
      'The Coalition storm is coming, disciple, and the Order has chosen its ground: the old hill sanctum at the heart of the sector, ringed in stone with three gates.',
      'The crystal within the walls is thin — the true harvest lies beyond the passes, under their guns. Weigh every convoy against the risk. Seal the gates with turret and flame, endure for fifteen minutes, and their offensive breaks on our walls like water.',
    ],
    events: [
      { at: 10, eva: 'The faithful ride to relieve you — fifteen minutes. Seal the passes.' },
      { at: 175,
        eva: 'Armor column approaching from the NORTH!',
        attack: { from: 'north', types: { udc: ['mtnk', 'mtnk', 'jeep'], srp: ['ltnk', 'ltnk', 'bike'] } } },
      { at: 350,
        eva: 'Assault teams moving in from the SOUTH-WEST!',
        attack: { from: 'southwest', types: { udc: ['mtnk', 'e2', 'e2', 'jeep'], srp: ['ftnk', 'e4', 'e4', 'bike'] } } },
      { at: 460, crates: 2, eva: 'Supply drop inbound — salvage crates at the perimeter.' },
      { at: 545,
        eva: 'Artillery sighted EAST — do not let them shell the walls!',
        attack: { from: 'east', types: { udc: ['msam', 'msam', 'mtnk'], srp: ['arty', 'arty', 'ltnk'] } } },
      { at: 700,
        eva: 'The vanguard of the faithful has broken through to your gates!',
        reinforce: { types: ['ltnk', 'ltnk', 'e4', 'e4'] } },
      { at: 790,
        eva: 'FINAL ASSAULT — everything they have left is coming. The sanctum holds!',
        attack: [
          { from: 'north', types: { udc: ['mtnk', 'mtnk', 'e3', 'e1', 'e1'], srp: ['ltnk', 'ltnk', 'e4', 'e1', 'e1'] } },
          { from: 'south', types: { udc: ['mtnk', 'jeep', 'e3', 'e3'], srp: ['ftnk', 'bike', 'e3', 'e3'] } },
        ] },
    ],
  },
  {
    n: 4, title: 'FANGS IN THE DARK',
    sector: 'LANTERN HILLS — COALITION SIGNAL POST', terr: [0.80, 0.60], seed: 3113,
    credits: 0, aiCredits: 0, aiCalm: 9, aiWaveCap: 0, aiNoSell: true,
    noHumanSpawn: true,
    objective: { type: 'demolish', btype: 'hq' },
    objText: 'Destroy the UDC command post with your infiltration team. No base. No reinforcements.',
    brief: [
      'The Serpent does not always come as an army, disciple. Sometimes it comes as a whisper. The Coalition routes every patrol on this front through a command post in the Lantern Hills — and its silence is worth a thousand soldiers.',
      'You are given a champion of the Order, a fire team, and one transport. Their pickets walk the hills and their towers never blink. Move as the Serpent moves — unseen, then absolute. Burn the post and vanish. The team is the mission.',
    ],
    setup(g, o) {
      MISSIONS.squad(g, o.side, ['rmbo', 'e4', 'e4', 'apc'], o.hs);
      const hub = MISSIONS.placeB(g, o.aiSide, 'hq', o.as.cx + 3, o.as.cy + 2);
      const twr = o.aiSide === 'udc' ? 'gtwr' : 'gun';
      if (hub) {
        MISSIONS.placeB(g, o.aiSide, twr, hub.cx - 2, hub.cy + 2);
        MISSIONS.placeB(g, o.aiSide, twr, hub.cx + hub.w + 1, hub.cy);
      }
      const picket = o.aiSide === 'udc' ? ['e1', 'e3'] : ['e1', 'e4'];
      for (const t of [0.4, 0.65]) {
        const cx = Math.round(o.hs.cx + (o.as.cx - o.hs.cx) * t);
        const cy = Math.round(o.hs.cy + (o.as.cy - o.hs.cy) * t);
        MISSIONS.squad(g, o.aiSide, picket, { cx, cy });
      }
    },
    events: [
      { at: 8, eva: 'The fangs are in the grass. Keep them alive — no one is coming to help.' },
      { at: 30,
        eva: 'The command post glows in the hills. Marking it now.',
        fn: g => {
          for (const b of g.buildings.values()) {
            if (b.type !== 'hq' || b.owner === g.humanSide) continue;
            Fog.revealCircle(g, b.cx + 1, b.cy + 1, 5);
            _ping(g, cellCenterX(b.cx + 1), cellCenterY(b.cy + 1), 'attack');
            break;
          }
        } },
      { at: 150,
        eva: 'A patrol is sweeping your last known position. Keep moving.',
        attack: { types: { udc: ['jeep', 'e1'], srp: ['bggy', 'e1'] }, target: 'base' } },
      { when: g => {
          for (const b of g.buildings.values()) {
            if (b.type === 'hq' && b.owner !== g.humanSide) return b.hp < b.maxHp * 0.5;
          }
          return false;
        },
        eva: 'The post is burning! Strike again and slip away!' },
    ],
  },
  {
    n: 5, title: 'STARVE THE MACHINE',
    sector: 'ASHFIELD BASIN — THE ENEMY BREADBASKET', terr: [0.60, 0.50], seed: 3141,
    credits: 6000, aiCredits: 7000,
    objective: { type: 'killEconomy' },
    objText: 'Destroy every UDC refinery and harvester in the sector.',
    brief: [
      'The Coalition war chest overflows with stolen harvest, disciple. Their refineries in this sector fill it by the hour, and their generals grow bold on the surplus.',
      'The Serpent strikes not the shield but the hand that feeds the arm. Their refineries, their harvesters — all of it to ash. Leave their soldiers standing in a base that cannot pay them.',
    ],
    events: [
      { at: 45, eva: 'Their ore trucks run the midfield at all hours. Hunt them where they harvest.' },
      { at: 300, creatures: 3, eva: 'Fleshlings are migrating through the crystal fields. They attack anything that moves.' },
      { at: 660, creatures: 4, eva: 'More fleshlings in the fields. Keep your infantry clear.' },
      { when: g => {
          let n = 0;
          for (const id of g.ai.buildingIds) { const b = g.buildings.get(id); if (b && b.type === 'proc') n++; }
          for (const id of g.ai.unitIds) { const u = g.units.get(id); if (u && DATA.units[u.type].harvester) n++; }
          const drop = g._m4Eco !== undefined && n < g._m4Eco;
          g._m4Eco = n;
          return drop;
        },
        repeat: true,
        eva: 'They felt that. Retaliation force inbound!',
        attack: { types: { udc: ['mtnk', 'jeep', 'e3'], srp: ['ltnk', 'bike', 'e3'] }, target: 'base' } },
    ],
  },
  {
    n: 6, title: 'THE RELIC ROAD',
    sector: 'PILGRIM ROAD — CONVOY COUNTRY', terr: [0.48, 0.64], seed: 5150,
    credits: 0, aiCredits: 0, aiCalm: 9, aiWaveCap: 0, aiNoSell: true,
    objective: { type: 'escort', unit: 'apc', dest: 'ai', radius: 2.5 },
    noHumanSpawn: true,
    objText: 'Deliver the transport to the extraction beacon. Its cargo is worth more than your column.',
    brief: [
      'The Order entrusts you with a relic, disciple: a Coalition targeting core, sealed in an armored transport. What it knows must reach the Temple vaults — and the valley between is thick with their patrols.',
      'You command only the column before you. No foundries will answer, no reinforcements will come. The road is watched by towers and idle armor. Move like the Serpent — quietly, then all at once — and deliver the transport to the beacon.',
    ],
    setup(g, o) {
      for (const id of g.ai.buildingIds.slice()) {
        const b = g.buildings.get(id);
        if (b) removeBuilding(b);
      }
      const conv = o.side === 'udc'
        ? ['apc', 'mtnk', 'mtnk', 'e3', 'e3', 'jeep']
        : ['apc', 'ltnk', 'ltnk', 'e3', 'e3', 'bggy'];
      MISSIONS.squad(g, o.side, conv, o.hs);
      const twr = o.aiSide === 'udc' ? 'gtwr' : 'gun';
      const picket = o.aiSide === 'udc' ? ['e1', 'e3', 'jeep'] : ['e1', 'e3', 'bggy'];
      for (const t of [0.35, 0.55, 0.78]) {
        const cx = Math.round(o.hs.cx + (o.as.cx - o.hs.cx) * t);
        const cy = Math.round(o.hs.cy + (o.as.cy - o.hs.cy) * t);
        MISSIONS.placeB(g, o.aiSide, twr, cx, cy);
        MISSIONS.squad(g, o.aiSide, picket, { cx, cy });
      }
      MISSIONS.placeB(g, o.aiSide, twr, o.as.cx - 2, o.as.cy);
      MISSIONS.squad(g, o.aiSide, o.aiSide === 'udc' ? ['mtnk', 'e3'] : ['ltnk', 'e3'], o.as);
    },
    events: [
      { at: 8, eva: 'The relic is rolling. The transport MUST survive — screen it at all times.' },
      { at: 35, eva: 'The faithful mark gun nests along the valley road. Scout before you commit the column.' },
      { when: g => {
          for (const id of g.human.unitIds) {
            const u = g.units.get(id);
            if (u && u.type === 'apc') return u.hp < u.maxHp * 0.5;
          }
          return false;
        },
        eva: 'The transport is taking heavy fire! Pull it back and screen it!' },
      { when: g => {
          const d = g.startPos.ai;
          for (const id of g.human.unitIds) {
            const u = g.units.get(id);
            if (u && u.type === 'apc') return dist(u.x, u.y, cellCenterX(d.cx), cellCenterY(d.cy)) < 15 * C.CELL;
          }
          return false;
        },
        eva: 'The beacon is in sight. All at once, disciple — punch through!' },
    ],
  },
  {
    n: 7, title: 'BLIND THE LANCE',
    sector: 'MIRROR MESA — THE UPLINK FIELDS', terr: [0.55, 0.34], seed: 5225,
    credits: 6000, aiCredits: 10000, aiCalm: 0.8,
    objective: { type: 'demolish', btype: 'eye' },
    objText: 'Destroy the uplink station that feeds their orbital lance. Everything else is optional.',
    brief: [
      'The Coalition’s weapon in the sky sees everything, disciple — because a station on this mesa tells it where to look. Every gathering of the faithful, every convoy, every temple: the lance finds them all through this one uplink.',
      'Their garrison will bleed you for every field between here and the mesa. Do not oblige them. Build fast, strike where it matters, and tear the uplink out by the roots. When it falls, the sky goes dark — and the Serpent moves unseen once more.',
    ],
    setup(g, o) {
      const b = MISSIONS.placeB(g, o.aiSide, 'eye', o.as.cx + 3, o.as.cy + 2);
      const adv = o.aiSide === 'udc' ? 'atwr' : 'obli';
      if (b) {
        MISSIONS.placeB(g, o.aiSide, adv, b.cx - 2, b.cy + 2);
        MISSIONS.placeB(g, o.aiSide, adv, b.cx + b.w + 1, b.cy + 2);
        MISSIONS.placeB(g, o.aiSide, 'nuk2', b.cx + 1, b.cy - 3);
      }
    },
    events: [
      { at: 25,
        eva: 'The uplink is live. The lance watches. Marking the target.',
        fn: g => {
          for (const b of g.buildings.values()) {
            if (b.type !== 'eye' || b.owner === g.humanSide) continue;
            Fog.revealCircle(g, b.cx + 1, b.cy + 1, 6);
            _ping(g, cellCenterX(b.cx + 1), cellCenterY(b.cy + 1), 'strike');
            break;
          }
        } },
      { at: 420,
        eva: 'Brothers have reached your banner. Keep the pressure on the uplink.',
        reinforce: { types: ['ltnk', 'arty', 'e4', 'e3'] } },
      { when: g => {
          for (const b of g.buildings.values()) {
            if (b.type === 'eye' && b.owner !== g.humanSide) return b.hp < b.maxHp * 0.5;
          }
          return false;
        },
        eva: 'The uplink is cracking! Put it down before their engineers answer!' },
    ],
  },
  {
    n: 8, title: 'CHANGED VOICES',
    sector: 'BLACKWATER CROSSING — DEEP BEHIND THE LINES', terr: [0.36, 0.52], seed: 7414,
    credits: 7000, aiCredits: 9000, aiCalm: 0.9,
    objective: { type: 'capture', btype: 'eye' },
    objText: 'Capture the Advanced Comm. Center INTACT with an engineer. If it falls, the mission fails.',
    brief: [
      'The Coalition uplink station in this sector speaks to their weapon in the sky, disciple. After Mirror Mesa they built its twin — and this time the Order does not want it silenced. The Order wants it to change WHOSE voice it obeys.',
      'Their orbital lance will hunt you the whole while, so move with purpose. Break the garrison, spare the prize — one stray shell and the uplink is ash and the mission with it. Deliver an engineer to its door and the sky itself changes sides.',
    ],
    setup(g, o) {
      const bt = o.side === 'udc' ? 'tmpl' : 'eye';
      const b = MISSIONS.placeB(g, o.aiSide, bt, o.as.cx + 3, o.as.cy + 2);
      const twr = o.aiSide === 'udc' ? 'gtwr' : 'gun';
      if (b) {
        MISSIONS.placeB(g, o.aiSide, twr, b.cx - 2, b.cy + 2);
        MISSIONS.placeB(g, o.aiSide, twr, b.cx + b.w + 1, b.cy + 2);
      }
    },
    events: [
      { at: 30,
        eva: 'The prize must be taken INTACT. An engineer must reach it — keep your guns off it.',
        fn: g => {
          const ob = g.mission.objective;
          const bt = typeof ob.btype === 'object' ? ob.btype[g.humanSide] : ob.btype;
          for (const b of g.buildings.values()) {
            if (b.type !== bt) continue;
            Fog.revealCircle(g, b.cx + 1, b.cy + 1, 5);
            _ping(g, cellCenterX(b.cx + 1), cellCenterY(b.cy + 1), 'crate');
            break;
          }
        } },
      { when: g => {
          const ob = g.mission.objective;
          const bt = typeof ob.btype === 'object' ? ob.btype[g.humanSide] : ob.btype;
          for (const b of g.buildings.values()) {
            if (b.type === bt && b.owner !== g.humanSide) return b.hp < b.maxHp * 0.6;
          }
          return false;
        },
        eva: 'WARNING — the prize is burning! Cease fire around it!' },
      { at: 420,
        eva: 'An engineering cell has arrived at the landing zone.',
        reinforce: { types: ['e6', 'e6', 'apc'] } },
    ],
  },
  {
    n: 9, title: 'BREAK THE BASTION',
    sector: 'BASTION GORGE — THE COALITION REDOUBT', terr: [0.28, 0.68], seed: 6008,
    credits: 8000, aiCredits: 12000, aiCalm: 0.7, aiWaveCap: 12,
    objective: { type: 'annihilate' },
    objText: 'Annihilate the UDC fortress. Total victory.',
    brief: [
      'The final trial before the last, child of the Serpent. The Coalition’s regional fortress stands across this wasteland — rich, walled, and armed with an orbital lance that will hunt your every gathering.',
      'The Order empties its coffers for you. Build without mercy, endure the light from the sky, and grind their fortress to dust. When the last UDC banner falls, this land belongs to the Serpent — forever.',
    ],
    events: [
      { at: 25, eva: 'Their orbital lance is already charging. Do not gather in the open.' },
      { at: 250,
        eva: 'Heavy armor has answered the call.',
        reinforce: { types: ['ftnk', 'ltnk', 'ltnk'] } },
      { every: 340, from: 650, until: 2400,
        eva: 'Fresh brothers at the landing zone.',
        reinforce: { types: ['ltnk', 'e4', 'e3'] } },
      { when: g => {
          let sup = 0;
          for (const id of g.ai.buildingIds) {
            const b = g.buildings.get(id);
            if (b && DATA.buildings[b.type].superweapon) sup++;
          }
          if (sup > 0) { g._m5Sup = true; return false; }
          return !!g._m5Sup;
        },
        eva: 'Their lance is DOWN. The sky is ours — press the attack!' },
    ],
  },
  {
    n: 10, title: 'AGE OF THE SERPENT',
    sector: 'AVALANCHE FOOTHILLS — THE LAST FORTRESS', terr: [0.12, 0.78], seed: 9091,
    credits: 10000, aiCredits: 16000, aiCalm: 0.5, aiWaveCap: 14,
    objective: { type: 'annihilate' },
    objText: 'Annihilate the fortress. Their whole war machine is awake — bury it.',
    brief: [
      'The end of the road, child of the Serpent. The Coalition’s final fortress works at full song — harvesters streaming, factories pouring armor, the lance in the sky drinking from three uplinks. They are strongest here. So must you be.',
      'The Order gives you its last coffers and its blessing. Grind their walls, starve their vaults, and when their final banner burns, the age of the Serpent begins.',
    ],
    setup(g, o) {
      const A = o.aiSide, as = o.as;
      const fac = A === 'udc' ? 'weap' : 'afld';
      const inf = A === 'udc' ? 'pyle' : 'hand';
      const sup = A === 'udc' ? 'eye' : 'tmpl';
      const twr = A === 'udc' ? 'gtwr' : 'gun';
      const adv = A === 'udc' ? 'atwr' : 'obli';
      MISSIONS.placeB(g, A, 'nuk2', as.cx - 4, as.cy - 2);
      MISSIONS.placeB(g, A, 'nuk2', as.cx + 4, as.cy - 2);
      MISSIONS.placeB(g, A, 'proc', as.cx - 3, as.cy + 3);
      MISSIONS.placeB(g, A, 'silo', as.cx, as.cy + 5);
      MISSIONS.placeB(g, A, fac, as.cx + 4, as.cy + 2);
      MISSIONS.placeB(g, A, inf, as.cx + 2, as.cy - 4);
      MISSIONS.placeB(g, A, 'hq', as.cx - 2, as.cy - 5);
      MISSIONS.placeB(g, A, sup, as.cx + 6, as.cy - 4);
      const dx = o.hs.cx < as.cx ? -1 : 1, dy = o.hs.cy < as.cy ? -1 : 1;
      MISSIONS.placeB(g, A, twr, as.cx + dx * 6, as.cy + dy * 2);
      MISSIONS.placeB(g, A, adv, as.cx + dx * 4, as.cy + dy * 5);
      MISSIONS.placeB(g, A, twr, as.cx + dx * 1, as.cy + dy * 7);
      MISSIONS.squad(g, A, A === 'udc' ? ['harv', 'mtnk', 'mtnk'] : ['harv', 'ltnk', 'ltnk'],
        { cx: as.cx - 2, cy: as.cy + 4 });
    },
    events: [
      { at: 20, eva: 'Their fortress is fully operational. Expect immediate and constant pressure.' },
      { at: 300,
        eva: 'The first brothers have answered the last call.',
        reinforce: { types: ['ltnk', 'ltnk', 'e4', 'e3'] } },
      { every: 400, from: 700, until: 3600,
        eva: 'The faithful gather at the landing zone.',
        reinforce: { types: ['ftnk', 'ltnk', 'e3'] } },
      { every: 420, from: 500, crates: 1, eva: 'Supply drop on the perimeter.' },
    ],
  },
],
};

// the arc for a faction (campaigns exist for the two root factions only)
MISSIONS.arc = function (side) {
  return MISSIONS[side === 'srp' ? 'srp' : 'udc'];
};

// ---- mission event engine ------------------------------------------------
// Missions carry an `events` array; MISSIONS.tick(game) runs once per sim tick
// (from the main loop, inside the deterministic step, single-player only).
// Every action is a pure function of (game.tick, sim state, game.rng), so
// replays re-run the script identically.
//
// Event triggers (one per event):
//   at: seconds                      — fires once at a fixed time
//   every: seconds [, from, until]   — repeats on a cadence
//   when: g => bool [, repeat: true] — fires on a rising edge (re-arms if repeat)
// Event actions (any combination; side-keyed {udc:…, srp:…} values resolve
// against the HUMAN side for eva/reinforce and the AI side for attack):
//   eva: text            — radio line (HUD banner + synthesized voice)
//   reinforce: {types[, at]}          — friendly column arrives at the map edge
//   attack: {types[, from][, target]} — enemy raid ('base' | 'harv')
//   crates: n            — supply drop near the player's base
//   creatures: n         — fleshlings surface in the crystal fields
//   credits: n           — wire transfer
//   fn: g => {}          — escape hatch for bespoke beats
(function () {
  const DIRS = {
    north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0],
    northeast: [1, -1], northwest: [-1, -1], southeast: [1, 1], southwest: [-1, 1],
  };

  function _side(v, side) { return (v && !Array.isArray(v) && typeof v === 'object') ? v[side] : v; }

  // open, passable, unoccupied cells spiralling out from (cx, cy). Crystal
  // cells are a last resort — reinforcements materialising inside a chrysalite
  // field wade out through it (infantry take damage, and it looks absurd)
  function _openNear(g, cx, cy, n, rMax) {
    const out = [], dusty = [];
    for (let r = 1; r <= (rMax || 14) && out.length < n; r++) {
      for (let dy = -r; dy <= r && out.length < n; dy++) {
        for (let dx = -r; dx <= r && out.length < n; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx, y = cy + dy;
          if (!inMap(x, y)) continue;
          const i = cellIdx(x, y);
          if (!terrainPassable(g.terrain[i]) || g.occ[i]) continue;
          if (g.tib[i] > 0) { dusty.push({ cx: x, cy: y }); continue; }
          out.push({ cx: x, cy: y });
        }
      }
    }
    while (out.length < n && dusty.length) out.push(dusty.shift());
    return out;
  }

  // a staging point toward the given compass edge (or nearest edge) from anchor
  function _edgeSpot(g, dir, anchor) {
    let tx, ty;
    if (dir && DIRS[dir]) {
      tx = anchor.cx + DIRS[dir][0] * 999;
      ty = anchor.cy + DIRS[dir][1] * 999;
    } else if (dir === 'enemy') {
      const ap = g.startPos.ai; tx = ap.cx; ty = ap.cy;
    } else { tx = anchor.cx; ty = anchor.cy < C.MAP_H / 2 ? -999 : 999; }
    const cx = clamp(tx, 4, C.MAP_W - 5), cy = clamp(ty, 4, C.MAP_H - 5);
    return { cx, cy };
  }

  function _spawnSquad(g, side, types, at) {
    const spots = _openNear(g, at.cx, at.cy, types.length);
    const units = [];
    for (let i = 0; i < types.length; i++) {
      const sp = spots[i] || spots[spots.length - 1];
      if (!sp) break;
      const u = makeUnit(types[i], side, sp.cx, sp.cy);
      addUnit(u);
      units.push(u);
    }
    return units;
  }

  function _reinforce(g, spec) {
    const hp = g.startPos.human;
    const shore = !!(g.mission && g.mission.shore);
    // shore landings put in EAST of the base column — the home chrysalite
    // field grows on the far side of the start, and boats grounding beside
    // it had squads wading crystal on their way up the beach
    const anchor = shore ? { cx: hp.cx + 6, cy: hp.cy } : hp;
    const org = _edgeSpot(g, spec.at, anchor);
    const types = _side(spec.types, g.humanSide) || [];
    const units = _spawnSquad(g, g.humanSide, types, org);
    // the column gathers south of the base pad — except on shore maps, where
    // south is the surf: there it forms up on the landward side, so a landed
    // MCV has honest ground to deploy on instead of a strip of wet sand
    const gx = shore ? hp.cx + 4 : hp.cx;
    const gy = shore ? hp.cy - 3 : hp.cy + 3;
    units.forEach((u, i) => orderMove(u, gx + (i % 3) - 1, gy + ((i / 3) | 0)));
    if (units.length) {
      _ping(g, cellCenterX(org.cx), cellCenterY(org.cy), 'reinforce');
      AUDIO.eva('reinforcements');
    }
  }

  function _attackWave(g, spec) {
    const hp = g.startPos.human;
    const org = _edgeSpot(g, spec.from || 'enemy', hp);
    const types = _side(spec.types, g.ai.side) || [];
    const units = _spawnSquad(g, g.ai.side, types, org);
    let tx = hp.cx, ty = hp.cy;
    if (spec.target === 'harv') {
      for (const id of g.human.unitIds) {
        const u = g.units.get(id);
        if (u && DATA.units[u.type].harvester) { tx = worldToCell(u.x); ty = worldToCell(u.y); break; }
      }
    }
    units.forEach((u, i) => orderAttackMove(u, clamp(tx + (i % 3) - 1, 1, C.MAP_W - 2),
      clamp(ty + ((i / 3) | 0) - 1, 1, C.MAP_H - 2)));
    if (units.length) _ping(g, cellCenterX(org.cx), cellCenterY(org.cy), 'attack');
  }

  function _supplyDrop(g, n) {
    const hp = g.startPos.human;
    const crates = g.crates || (g.crates = []);
    const spots = _openNear(g, hp.cx, hp.cy, n * 3);
    let placed = 0;
    // outer ring first, so drops don't land inside the base footprint
    for (let i = spots.length - 1; i >= 0 && placed < n; i--) {
      const s = spots[i];
      if (g.tib[cellIdx(s.cx, s.cy)] > 0) continue;
      crates.push({ cx: s.cx, cy: s.cy, born: g.tick });
      _ping(g, cellCenterX(s.cx), cellCenterY(s.cy), 'crate');
      placed++;
    }
  }

  function _creatures(g, n) {
    const hp = g.startPos.human;
    let spawned = 0;
    for (let tries = 0; tries < 60 && spawned < n; tries++) {
      const cx = 2 + ((g.rng() * (C.MAP_W - 4)) | 0);
      const cy = 2 + ((g.rng() * (C.MAP_H - 4)) | 0);
      const i = cellIdx(cx, cy);
      if (g.tib[i] <= 0) continue;
      if (Math.abs(cx - hp.cx) + Math.abs(cy - hp.cy) < 16) continue;
      const spot = _openNear(g, cx, cy, 1, 3)[0];
      if (!spot) continue;
      addUnit(makeUnit('vice', 'mut', spot.cx, spot.cy));
      spawned++;
    }
  }

  function _runActions(g, ev) {
    const say = _side(ev.eva, g.humanSide);
    if (say) AUDIO.evaText(say);
    if (ev.credits) g.human.credits += ev.credits;
    if (ev.reinforce) for (const s of [].concat(ev.reinforce)) _reinforce(g, s);
    if (ev.attack) for (const s of [].concat(ev.attack)) _attackWave(g, s);
    if (ev.crates) _supplyDrop(g, ev.crates);
    if (ev.creatures) _creatures(g, ev.creatures);
    if (ev.fn) ev.fn(g);
  }

  MISSIONS.tick = function (g) {
    const m = g.mission;
    if (!m || !m.events || g.status !== 'playing') return;
    const st = g._mEv || (g._mEv = m.events.map(() => ({ fired: 0, next: -1, hold: false })));
    for (let i = 0; i < m.events.length; i++) {
      const ev = m.events[i], s = st[i];
      let fire = false;
      if (ev.at !== undefined) {
        if (!s.fired && g.tick >= ev.at * C.TPS) fire = true;
      } else if (ev.every !== undefined) {
        const from = (ev.from || 0) * C.TPS;
        const until = ev.until !== undefined ? ev.until * C.TPS : Infinity;
        if (g.tick >= from && g.tick <= until) {
          if (s.next < 0) s.next = from + ev.every * C.TPS;
          if (g.tick >= s.next) { fire = true; s.next = g.tick + ev.every * C.TPS; }
        }
      } else if (ev.when) {
        const c = !!ev.when(g);
        if (c && !s.hold && (!s.fired || ev.repeat)) { fire = true; }
        s.hold = c;
      }
      if (!fire) continue;
      s.fired++;
      _runActions(g, ev);
    }
  };

  // shared setup helper: place a finished building near (cx, cy), spiralling
  // for a clear footprint. Returns the building or null.
  MISSIONS.placeB = function (g, side, type, cx, cy) {
    const d = DATA.buildings[type];
    for (let r = 0; r <= 10; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx, y = cy + dy;
          let ok = true;
          for (let fy = 0; fy < d.h && ok; fy++) {
            for (let fx = 0; fx < d.w && ok; fx++) {
              const i = inMap(x + fx, y + fy) ? cellIdx(x + fx, y + fy) : -1;
              if (i < 0 || !terrainPassable(g.terrain[i]) || g.occ[i] || g.tib[i] > 0) ok = false;
            }
          }
          if (!ok) continue;
          const b = makeBuilding(type, side, x, y);
          b.buildProgress = 1;
          addBuilding(b);
          return b;
        }
      }
    }
    return null;
  };
  MISSIONS.squad = _spawnSquad;
  MISSIONS.openNear = _openNear;
})();

// ---- campaign progress (localStorage, per faction) ---------------------------
// Storage access is guarded: in storage-hostile environments (quota-full
// origins, ancient private modes) progress falls back to session memory so a
// throwing setItem can never break the win flow or the mission menu.

const MissionProgress = {
  _mem: { udc: 0, srp: 0 },
  _key(side) { return 'hw_progress_' + (side === 'srp' ? 'srp' : 'udc'); },
  _norm(side) { return side === 'srp' ? 'srp' : 'udc'; },
  get(side) {
    const s = this._norm(side);
    let v = this._mem[s];
    try {
      const st = parseInt(localStorage.getItem(this._key(s)) || '0', 10);
      if (!isNaN(st) && st > v) v = st;
    } catch (e) { /* storage denied: memory only */ }
    return v;
  },
  unlockUpTo(n, side) {
    const s = this._norm(side);
    if (n <= this.get(s)) return;
    this._mem[s] = n;
    try { localStorage.setItem(this._key(s), String(n)); } catch (e) { /* keep in memory */ }
  },
  unlocked(mission, side) { return mission.n <= this.get(side) + 1; },
};
