'use strict';
// missions.js — the campaign: mission definitions, briefings and progress.
// Global: MISSIONS. Consumed by main.js (setup, win check), ai.js (difficulty
// knobs via game.mission) and render.js (objective HUD line).
//
// Each mission:
//   n          1-based campaign order (also the unlock index)
//   title      shown on the operations list and the briefing header
//   seed       fixed map seed, so a mission is a repeatable battlefield
//   credits    human starting credits        (default 5000)
//   aiCredits  AI starting credits           (default 5000)
//   aiCalm     multiplier on the AI's attack-wave cadence — above 1 is a
//              gentler opponent, below 1 keeps the waves coming
//   aiWaveCap  ceiling on units per AI strike wave (default 9)
//   holdout    true = fortress scenario: the player starts at the center of
//              the map inside a rock ring with three gated passes (map.js),
//              thin chrysalite inside the walls and rich fields beyond them
//   objective  { type: 'annihilate' }
//              { type: 'harvest', amount }        — HOLD that many credits at
//                                                   once (bank balance)
//              { type: 'survive', minutes }       — outlast the onslaught
//              { type: 'killEconomy' }            — destroy every enemy
//                refinery and harvester (arms once the enemy has built one)
//   brief      { gdi: [paragraphs], nod: [paragraphs] } — in-universe text
//   objText    { gdi, nod } one-line objective summary for briefing + HUD

const MISSIONS = [
  {
    n: 1, title: 'LANDFALL', seed: 8121,
    credits: 6000, aiCredits: 2500, aiCalm: 1.8, aiWaveCap: 5,
    objective: { type: 'annihilate' },
    objText: {
      gdi: 'Destroy the Serpent Order outpost. Leave nothing standing.',
      nod: 'Crush the UDC beachhead before it takes root.',
    },
    brief: {
      gdi: [
        'Commander. A Serpent Order cell has gone to ground in this valley and is bleeding the region dry. Intel puts their strength at a single fortified outpost — light garrison, minimal armor.',
        'Your MCV is en route with an escort. Deploy, establish a chrysalite income, and burn that outpost off the map. This is your proving ground, Commander — make it clean.',
      ],
      nod: [
        'The Coalition has landed, child of the Serpent. A lone UDC expedition digs in across the valley, far from reinforcement — arrogant, and alone.',
        'The Order has granted you an MCV and the honor of first strike. Take root, harvest the green gold, and erase them. Let the valley learn whose land this is.',
      ],
    },
    events: [
      { at: 45,
        eva: 'Enemy scouts are probing your perimeter. Expect a raid.',
        attack: { types: { gdi: ['jeep', 'e1'], nod: ['bggy', 'e1'] }, target: 'base' } },
      { at: 180,
        eva: 'A reinforcement column has reached the sector.',
        reinforce: { types: { gdi: ['mtnk', 'e3', 'e3'], nod: ['ltnk', 'e3', 'e3'] } } },
      { when: g => {
          let n = 0;
          for (const id of g.ai.buildingIds) { const b = g.buildings.get(id); if (b && !DATA.buildings[b.type].wall) n++; }
          return g._m1Seen === undefined ? ((g._m1Seen = n), false) : n < g._m1Seen;
        },
        eva: 'Their outpost is burning. Finish the job.' },
    ],
  },
  {
    n: 2, title: 'GREEN GOLD', seed: 4257,
    credits: 3000, aiCredits: 5000, aiCalm: 1.4,
    objective: { type: 'harvest', amount: 6000 },
    objText: {
      gdi: 'Hold a treasury of 6000 credits at once. Storage silos will be essential.',
      nod: 'Hold a treasury of 6000 credits at once. Build silos — the Order audits the vault, not the ledger.',
    },
    brief: {
      gdi: [
        'The war effort runs on chrysalite, Commander, and headquarters is running on fumes. This sector holds some of the richest fields we have charted — and a Serpent Order garrison that knows it.',
        'Your task is not conquest. Establish refining operations and amass a WAR CHEST of six thousand credits — held in your treasury at one time, so raise storage silos and spend with care. Defend the harvest chain; wipe the enemy out if you must, but the balance is the mission.',
      ],
      nod: [
        'Faith does not fuel the war machine, disciple. Chrysalite does. The Order requires a war chest of six thousand credits from this sector, and the Coalition squats upon the richest fields.',
        'Take what is ours beneath their noses. The quota is counted in the vault, not the ledger — six thousand credits held at once. Raise silos, guard your harvesters as you would your own blood, and spend only what the harvest can replace.',
      ],
    },
    events: [
      { at: 50,
        eva: 'Survey drones report a BLUE chrysalite lode in the midfield. Double value at the refinery.',
        fn: g => {   // reveal the blue pocket and mark it on radar
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
        attack: { types: { gdi: ['jeep', 'jeep', 'e1'], nod: ['bike', 'bggy', 'e1'] }, target: 'harv' } },
      { every: 210, from: 470, until: 1400,
        eva: 'Another raiding party is closing on the harvest line.',
        attack: { types: { gdi: ['jeep', 'jeep', 'e3'], nod: ['bike', 'bike', 'e3'] }, target: 'harv' } },
      { at: 430,
        eva: 'Command has diverted a spare harvester to your operation.',
        reinforce: { types: ['harv'] } },
      { when: g => g.human.credits >= 4800,
        eva: 'The war chest is nearly full. Guard the vault.' },
    ],
  },
  {
    n: 3, title: 'HOLD THE LINE', seed: 9773, holdout: true,
    credits: 8000, aiCredits: 11000, aiCalm: 0.5,
    objective: { type: 'survive', minutes: 15 },
    objText: {
      gdi: 'Hold the plateau for 15 minutes. Fortify the three passes.',
      nod: 'Hold the sanctum for 15 minutes. Seal the three passes with stone and flame.',
    },
    brief: {
      gdi: [
        'Bad news, Commander. The Serpent Order has massed for a counter-offensive, and the only ground worth holding is this walled plateau in the dead center of the sector — high rock all around, three passes in.',
        'There is a chrysalite pocket inside the walls, but it will not carry you fifteen minutes — the rich fields lie OUTSIDE the passes, and every convoy you send is a convoy you must cover. Wall the gaps, keep the power humming, and hold until the relief column arrives.',
      ],
      nod: [
        'The Coalition storm is coming, disciple, and the Order has chosen its ground: the old hill sanctum at the heart of the sector, ringed in stone with three gates.',
        'The crystal within the walls is thin — the true harvest lies beyond the passes, under their guns. Weigh every convoy against the risk. Seal the gates with turret and flame, endure for fifteen minutes, and their offensive breaks on our walls like water.',
      ],
    },
    events: [
      { at: 10, eva: 'Relief column ETA fifteen minutes. Seal the passes and dig in.' },
      { at: 175,
        eva: 'Armor column approaching from the NORTH!',
        attack: { from: 'north', types: { gdi: ['mtnk', 'mtnk', 'jeep'], nod: ['ltnk', 'ltnk', 'bike'] } } },
      { at: 350,
        eva: 'Flame units moving in from the SOUTH-WEST!',
        attack: { from: 'southwest', types: { gdi: ['mtnk', 'e2', 'e2', 'jeep'], nod: ['ftnk', 'e4', 'e4', 'bike'] } } },
      { at: 460, crates: 2, eva: 'Supply drop inbound — salvage crates at the perimeter.' },
      { at: 545,
        eva: 'Artillery sighted EAST — do not let them shell the walls!',
        attack: { from: 'east', types: { gdi: ['msam', 'msam', 'mtnk'], nod: ['arty', 'arty', 'ltnk'] } } },
      { at: 700,
        eva: 'The relief vanguard has broken through to your position!',
        reinforce: { types: { gdi: ['mtnk', 'mtnk', 'e3', 'e3'], nod: ['ltnk', 'ltnk', 'e4', 'e4'] } } },
      { at: 790,
        eva: 'FINAL ASSAULT — everything they have left is coming. Hold the line!',
        attack: [
          { from: 'north', types: { gdi: ['mtnk', 'mtnk', 'e3', 'e1', 'e1'], nod: ['ltnk', 'ltnk', 'e4', 'e1', 'e1'] } },
          { from: 'south', types: { gdi: ['mtnk', 'jeep', 'e3', 'e3'], nod: ['ftnk', 'bike', 'e3', 'e3'] } },
        ] },
    ],
  },
  {
    n: 4, title: 'SCORCHED HARVEST', seed: 3141,
    credits: 6000, aiCredits: 7000,
    objective: { type: 'killEconomy' },
    objText: {
      gdi: 'Destroy every Serpent Order refinery and harvester in the sector.',
      nod: 'Destroy every UDC refinery and harvester in the sector.',
    },
    brief: {
      gdi: [
        'We cannot beat their army head-on in this sector, Commander — but an army is only as strong as its purse. The Serpent Order feeds this entire front from the refineries here.',
        'Cut the artery. Every refinery, every harvester — hunt them down and burn them. You do not need to level their base; starve it and the front collapses on its own.',
      ],
      nod: [
        'The Coalition war chest overflows with stolen harvest, disciple. Their refineries in this sector fill it by the hour, and their generals grow bold on the surplus.',
        'The Serpent strikes not the shield but the hand that feeds the arm. Their refineries, their harvesters — all of it to ash. Leave their soldiers standing in a base that cannot pay them.',
      ],
    },
    events: [
      { at: 45, eva: 'Their ore trucks run the midfield at all hours. Hunt them where they harvest.' },
      { at: 300, creatures: 3, eva: 'Fleshlings are migrating through the crystal fields. They attack anything that moves.' },
      { at: 660, creatures: 4, eva: 'More fleshlings in the fields. Keep your infantry clear.' },
      { when: g => {   // every economy kill stings — expect a revenge wave
          let n = 0;
          for (const id of g.ai.buildingIds) { const b = g.buildings.get(id); if (b && b.type === 'proc') n++; }
          for (const id of g.ai.unitIds) { const u = g.units.get(id); if (u && DATA.units[u.type].harvester) n++; }
          const drop = g._m4Eco !== undefined && n < g._m4Eco;
          g._m4Eco = n;
          return drop;
        },
        repeat: true,
        eva: 'They felt that. Retaliation force inbound!',
        attack: { types: { gdi: ['mtnk', 'jeep', 'e3'], nod: ['ltnk', 'bike', 'e3'] }, target: 'base' } },
    ],
  },
  {
    n: 5, title: 'SEVERED HEAD', seed: 6008,
    credits: 8000, aiCredits: 12000, aiCalm: 0.7, aiWaveCap: 12,
    objective: { type: 'annihilate' },
    objText: {
      gdi: 'Annihilate the Serpent Order stronghold. Total victory.',
      nod: 'Annihilate the UDC fortress. Total victory.',
    },
    brief: {
      gdi: [
        'This is the one, Commander. The Serpent Order’s regional stronghold — deep coffers, layered defenses, and a Temple that will be charging a nuclear strike from the moment you arrive.',
        'There is no quota and no clock. Build, grind, and take them apart piece by piece. Expect their heaviest armor and constant pressure. Cut off the serpent’s head, and the region is free.',
      ],
      nod: [
        'The final trial, child of the Serpent. The Coalition’s regional fortress stands across this wasteland — rich, walled, and armed with an orbital lance that will hunt your every gathering.',
        'The Order empties its coffers for you. Build without mercy, endure the light from the sky, and grind their fortress to dust. When the last UDC banner falls, this land belongs to the Serpent — forever.',
      ],
    },
    events: [
      { at: 25,
        eva: { gdi: 'Their Temple is already charging. Watch the sky, Commander.',
               nod: 'Their orbital lance is already charging. Do not gather in the open.' } },
      { at: 250,
        eva: 'Heavy armor reinforcements have reached the sector.',
        reinforce: { types: { gdi: ['htnk', 'mtnk'], nod: ['ftnk', 'ltnk', 'ltnk'] } } },
      { every: 340, from: 650, until: 2400,
        eva: 'Fresh reinforcements at the landing zone.',
        reinforce: { types: { gdi: ['mtnk', 'e3', 'e3'], nod: ['ltnk', 'e4', 'e3'] } } },
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
    n: 6, title: 'THE LONG ROAD', seed: 5150,
    credits: 0, aiCredits: 0, aiCalm: 9, aiWaveCap: 0,
    objective: { type: 'escort', unit: 'apc', dest: 'ai', radius: 2.5 },
    noHumanSpawn: true,
    objText: {
      gdi: 'Deliver the transport to the extraction beacon. If it dies, the mission dies with it.',
      nod: 'Deliver the transport to the extraction beacon. Its cargo is worth more than your column.',
    },
    brief: {
      gdi: [
        'No base this time, Commander. Salvage teams pulled a sealed Serpent prototype core out of the stronghold ruins, and every warlord in the valley wants it back. It rides in an armored transport, and you ride with it.',
        'Your escort is what you see — no MCV, no reinforcements, no second chances. Checkpoints and gun nests line the valley road. Scout ahead, pick your route, and put that transport on the extraction beacon in one piece.',
      ],
      nod: [
        'The Order entrusts you with a relic, disciple: a Coalition targeting core, sealed in an armored transport. What it knows must reach the Temple vaults — and the valley between is thick with their patrols.',
        'You command only the column before you. No foundries will answer, no reinforcements will come. The road is watched by towers and idle armor. Move like the Serpent — quietly, then all at once — and deliver the transport to the beacon.',
      ],
    },
    setup(g, o) {
      // the AI keeps no base here — strip the default camp; its escort squad
      // stays behind as the beacon's last guard
      for (const id of g.ai.buildingIds.slice()) {
        const b = g.buildings.get(id);
        if (b) removeBuilding(b);
      }
      // the convoy: transport + escort, parked at the player start
      const conv = o.side === 'gdi'
        ? ['apc', 'mtnk', 'mtnk', 'e3', 'e3', 'jeep']
        : ['apc', 'ltnk', 'ltnk', 'e3', 'e3', 'bggy'];
      MISSIONS.squad(g, o.side, conv, o.hs);
      // checkpoints along the road: a tower + pickets at thirds of the route
      const twr = o.aiSide === 'gdi' ? 'gtwr' : 'gun';
      const picket = o.aiSide === 'gdi' ? ['e1', 'e3', 'jeep'] : ['e1', 'e3', 'bggy'];
      for (const t of [0.35, 0.55, 0.78]) {
        const cx = Math.round(o.hs.cx + (o.as.cx - o.hs.cx) * t);
        const cy = Math.round(o.hs.cy + (o.as.cy - o.hs.cy) * t);
        MISSIONS.placeB(g, o.aiSide, twr, cx, cy);
        MISSIONS.squad(g, o.aiSide, picket, { cx, cy });
      }
      // heavier guard on the beacon itself
      MISSIONS.placeB(g, o.aiSide, twr, o.as.cx - 2, o.as.cy);
      MISSIONS.squad(g, o.aiSide, o.aiSide === 'gdi' ? ['mtnk', 'e3'] : ['ltnk', 'e3'], o.as);
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
    n: 7, title: 'INSIDE JOB', seed: 7414,
    credits: 7000, aiCredits: 9000, aiCalm: 0.9,
    objective: { type: 'capture', btype: { gdi: 'tmpl', nod: 'eye' } },
    objText: {
      gdi: 'Capture the Serpent Temple INTACT with an engineer. If it falls, the mission fails.',
      nod: 'Capture the Advanced Comm. Center INTACT with an engineer. If it falls, the mission fails.',
    },
    brief: {
      gdi: [
        'Listen carefully, Commander, because this one is delicate. The Serpent Order operates a Temple in this sector — and our analysts want it breathing, not burning. Its launch codes, its doctrine archives, everything, intact.',
        'It will be charging a nuclear strike the entire time you are on the ground, so you have a clock even though nobody set one. Fight through the garrison, but keep your guns OFF the Temple — the day an engineer walks through its door, the war changes.',
      ],
      nod: [
        'The Coalition uplink station in this sector speaks to their weapon in the sky, disciple. The Order does not want it silenced — the Order wants it to change WHOSE voice it obeys.',
        'Their orbital lance will hunt you the whole while, so move with purpose. Break the garrison, spare the prize — one stray shell and the uplink is ash and the mission with it. Deliver an engineer to its door and the sky itself changes sides.',
      ],
    },
    setup(g, o) {
      // the prize stands pre-built at the enemy base, modestly garrisoned
      const bt = o.side === 'gdi' ? 'tmpl' : 'eye';
      const b = MISSIONS.placeB(g, o.aiSide, bt, o.as.cx + 3, o.as.cy + 2);
      const twr = o.aiSide === 'gdi' ? 'gtwr' : 'gun';
      if (b) {
        MISSIONS.placeB(g, o.aiSide, twr, b.cx - 2, b.cy + 2);
        MISSIONS.placeB(g, o.aiSide, twr, b.cx + b.w + 1, b.cy + 2);
      }
    },
    events: [
      { at: 30,
        eva: 'The prize must be taken INTACT. An engineer must reach it — keep your guns off it.',
        fn: g => {   // show the player what they came for
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
    n: 8, title: 'AVALANCHE', seed: 9091,
    credits: 10000, aiCredits: 16000, aiCalm: 0.5, aiWaveCap: 14,
    objective: { type: 'annihilate' },
    objText: {
      gdi: 'Annihilate the fortress. Everything they have is already built — and pointed at you.',
      nod: 'Annihilate the fortress. Their whole war machine is awake — bury it.',
    },
    brief: {
      gdi: [
        'No preamble, Commander. The last Serpent fortress in the theater is dug in across this valley — refineries running, factories hot, defense grid live, Temple charging. They have had years to prepare and they know you are coming.',
        'You get a war chest, a steady trickle of reinforcements, and the truth: this will be a grind. Take ground, hold it, and bring the mountain down on them. Win here, and the war is over.',
      ],
      nod: [
        'The end of the road, child of the Serpent. The Coalition’s final fortress works at full song — harvesters streaming, factories pouring armor, the lance in the sky drinking from three uplinks. They are strongest here. So must you be.',
        'The Order gives you its last coffers and its blessing. Grind their walls, starve their vaults, and when their final banner burns, the age of the Serpent begins.',
      ],
    },
    setup(g, o) {
      // the enemy fortress stands finished on day one
      const A = o.aiSide, as = o.as;
      const fac = A === 'gdi' ? 'weap' : 'afld';
      const inf = A === 'gdi' ? 'pyle' : 'hand';
      const sup = A === 'gdi' ? 'eye' : 'tmpl';
      const twr = A === 'gdi' ? 'gtwr' : 'gun';
      const adv = A === 'gdi' ? 'atwr' : 'obli';
      MISSIONS.placeB(g, A, 'nuk2', as.cx - 4, as.cy - 2);
      MISSIONS.placeB(g, A, 'nuk2', as.cx + 4, as.cy - 2);
      MISSIONS.placeB(g, A, 'proc', as.cx - 3, as.cy + 3);
      MISSIONS.placeB(g, A, 'silo', as.cx, as.cy + 5);
      MISSIONS.placeB(g, A, fac, as.cx + 4, as.cy + 2);
      MISSIONS.placeB(g, A, inf, as.cx + 2, as.cy - 4);
      MISSIONS.placeB(g, A, 'hq', as.cx - 2, as.cy - 5);
      MISSIONS.placeB(g, A, sup, as.cx + 6, as.cy - 4);
      // defense arc facing the player's approach
      const dx = o.hs.cx < as.cx ? -1 : 1, dy = o.hs.cy < as.cy ? -1 : 1;
      MISSIONS.placeB(g, A, twr, as.cx + dx * 6, as.cy + dy * 2);
      MISSIONS.placeB(g, A, adv, as.cx + dx * 4, as.cy + dy * 5);
      MISSIONS.placeB(g, A, twr, as.cx + dx * 1, as.cy + dy * 7);
      MISSIONS.squad(g, A, A === 'gdi' ? ['harv', 'mtnk', 'mtnk'] : ['harv', 'ltnk', 'ltnk'],
        { cx: as.cx - 2, cy: as.cy + 4 });
    },
    events: [
      { at: 20, eva: 'Their fortress is fully operational. Expect immediate and constant pressure.' },
      { at: 300,
        eva: 'First reinforcement wave has arrived.',
        reinforce: { types: { gdi: ['mtnk', 'mtnk', 'e3', 'e3'], nod: ['ltnk', 'ltnk', 'e4', 'e3'] } } },
      { every: 400, from: 700, until: 3600,
        eva: 'Reinforcements at the landing zone.',
        reinforce: { types: { gdi: ['htnk', 'e3', 'e3'], nod: ['ftnk', 'ltnk', 'e3'] } } },
      { every: 420, from: 500, crates: 1, eva: 'Supply drop on the perimeter.' },
    ],
  },
];

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
// Event actions (any combination; side-keyed {gdi:…, nod:…} values resolve
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

  // open, passable, unoccupied cells spiralling out from (cx, cy)
  function _openNear(g, cx, cy, n, rMax) {
    const out = [];
    for (let r = 1; r <= (rMax || 14) && out.length < n; r++) {
      for (let dy = -r; dy <= r && out.length < n; dy++) {
        for (let dx = -r; dx <= r && out.length < n; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx, y = cy + dy;
          if (inMap(x, y) && terrainPassable(g.terrain[cellIdx(x, y)]) &&
              !g.occ[cellIdx(x, y)]) out.push({ cx: x, cy: y });
        }
      }
    }
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
    const org = _edgeSpot(g, spec.at, hp);
    const types = _side(spec.types, g.humanSide) || [];
    const units = _spawnSquad(g, g.humanSide, types, org);
    units.forEach((u, i) => orderMove(u, hp.cx + (i % 3) - 1, hp.cy + 3 + ((i / 3) | 0)));
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

// ---- campaign progress (localStorage) ----------------------------------------
// Storage access is guarded: in storage-hostile environments (quota-full
// origins, ancient private modes) progress falls back to session memory so a
// throwing setItem can never break the win flow or the mission menu.

const MissionProgress = {
  KEY: 'hw_progress',
  _mem: 0,
  get() {
    let v = this._mem;
    try {
      const s = parseInt(localStorage.getItem(this.KEY) || '0', 10);
      if (!isNaN(s) && s > v) v = s;
    } catch (e) { /* storage denied: memory only */ }
    return v;
  },
  unlockUpTo(n) {
    if (n <= this.get()) return;
    this._mem = n;
    try { localStorage.setItem(this.KEY, String(n)); } catch (e) { /* keep in memory */ }
  },
  unlocked(mission) { return mission.n <= this.get() + 1; },
};
