'use strict';
// data.js — game rules: warheads, weapons, units, buildings, build lists, EVA lines.
// Values follow the 1995 original's balance (costs/hp/speeds approximated from it).

const DATA = {};

// warhead damage multiplier vs armor class
DATA.warheads = {
  sa:    { none: 1.0, light: 0.55, heavy: 0.28, wood: 0.30, concrete: 0.18 }, // small arms
  he:    { none: 0.95, light: 0.65, heavy: 0.45, wood: 0.90, concrete: 0.55 }, // high explosive
  ap:    { none: 0.30, light: 0.75, heavy: 1.00, wood: 0.65, concrete: 0.80 }, // armor piercing
  fire:  { none: 1.30, light: 0.60, heavy: 0.30, wood: 1.00, concrete: 0.45 },
  laser: { none: 1.0, light: 1.0, heavy: 1.0, wood: 1.0, concrete: 1.0 },
};

// range in cells, rof in ticks, speed px/tick (0 = hitscan), splash px
DATA.weapons = {
  m16:       { dmg: 15, range: 3.0, rof: 12, speed: 0, warhead: 'sa', splash: 0, sound: 'mgun' },
  pistol:    { dmg: 8,  range: 2.5, rof: 8,  speed: 0, warhead: 'sa', splash: 0, sound: 'pistol' },
  sniper:    { dmg: 90, range: 5.0, rof: 25, speed: 0, warhead: 'sa', splash: 0, sound: 'pistol' },
  grenade:   { dmg: 40, range: 3.5, rof: 28, speed: 5, warhead: 'he', splash: 14, arc: true, sound: 'rocket' },
  dragon:    { dmg: 42, range: 4.5, rof: 32, speed: 6, warhead: 'ap', splash: 8, homing: true, antiAir: true, sound: 'rocket' },
  flamer:    { dmg: 32, range: 2.0, rof: 24, speed: 0, warhead: 'fire', splash: 10, sound: 'flame' },
  chemspray: { dmg: 36, range: 2.0, rof: 24, speed: 0, warhead: 'fire', splash: 10, sound: 'flame' },
  mg50:      { dmg: 22, range: 3.5, rof: 10, speed: 0, warhead: 'sa', splash: 0, sound: 'mgun' },
  cannon75:  { dmg: 42, range: 4.0, rof: 32, speed: 8, warhead: 'ap', splash: 8, sound: 'cannon' },
  cannon90:  { dmg: 55, range: 4.25, rof: 34, speed: 8, warhead: 'ap', splash: 8, sound: 'cannon' },
  cannon120: { dmg: 75, range: 4.5, rof: 40, speed: 8, warhead: 'ap', splash: 10, sound: 'cannon' },
  mammothTusk: { dmg: 40, range: 5.0, rof: 40, speed: 6, warhead: 'he', splash: 16, homing: true, antiAir: true, sound: 'rocket' },
  rocket227: { dmg: 55, range: 6.5, rof: 45, speed: 7, warhead: 'he', splash: 18, homing: true, antiAir: true, sound: 'rocket' },
  bikeRockets: { dmg: 40, range: 4.0, rof: 30, speed: 7, warhead: 'ap', splash: 8, homing: true, antiAir: true, sound: 'rocket' },
  flameTank: { dmg: 55, range: 2.5, rof: 26, speed: 0, warhead: 'fire', splash: 16, sound: 'flame' },
  stealthMissile: { dmg: 50, range: 4.5, rof: 36, speed: 7, warhead: 'he', splash: 12, homing: true, sound: 'rocket' },
  arty155:   { dmg: 90, range: 6.0, rof: 55, speed: 4, warhead: 'he', splash: 22, arc: true, inaccurate: true, sound: 'cannon' },
  orcaRockets: { dmg: 50, range: 3.5, rof: 18, speed: 7, warhead: 'ap', splash: 10, homing: true, sound: 'rocket' },
  heliMg:    { dmg: 25, range: 3.0, rof: 8, speed: 0, warhead: 'sa', splash: 0, sound: 'mgun' },
  gtwrMg:    { dmg: 22, range: 4.0, rof: 10, speed: 0, warhead: 'sa', splash: 0, sound: 'mgun' },
  atwrMissile: { dmg: 90, range: 5.5, rof: 26, speed: 8, warhead: 'he', splash: 10, homing: true, antiAir: true, sound: 'rocket' },
  slime:     { dmg: 30, range: 1.3, rof: 22, speed: 0, warhead: 'fire', splash: 8, sound: 'flame' },
  gunTurret: { dmg: 45, range: 4.75, rof: 30, speed: 8, warhead: 'ap', splash: 8, sound: 'cannon' },
  obelisk:   { dmg: 400, range: 7.0, rof: 90, speed: 0, warhead: 'laser', splash: 0, charge: 30, sound: 'laser' },
  samMissile: { dmg: 60, range: 5.5, rof: 25, speed: 9, warhead: 'he', splash: 8, homing: true, antiAir: true, airOnly: true, sound: 'rocket' },
};

// units. speed = px/tick. sight in cells. armor: none/light/heavy.
// side: 'gdi' | 'nod' | null (both). prereq: extra buildings required beyond the factory.
DATA.units = {
  // infantry
  e1:   { name: 'Minigunner', cost: 100, hp: 50, speed: 1.1, sight: 3, armor: 'none', weapon: 'm16', infantry: true, side: null, factory: 'infantry', prereq: [] },
  e2:   { name: 'Grenadier', cost: 160, hp: 50, speed: 1.3, sight: 3, armor: 'none', weapon: 'grenade', infantry: true, side: 'gdi', factory: 'infantry', prereq: [] },
  e3:   { name: 'Rocket Soldier', cost: 300, hp: 45, speed: 0.9, sight: 3, armor: 'none', weapon: 'dragon', infantry: true, side: null, factory: 'infantry', prereq: [] },
  e4:   { name: 'Flamethrower', cost: 200, hp: 70, speed: 1.1, sight: 3, armor: 'none', weapon: 'flamer', infantry: true, side: 'nod', factory: 'infantry', prereq: [] },
  e5:   { name: 'Chem Warrior', cost: 300, hp: 70, speed: 1.1, sight: 3, armor: 'none', weapon: 'chemspray', infantry: true, side: 'nod', factory: 'infantry', prereq: ['tmpl'], tibImmune: true },
  e6:   { name: 'Engineer', cost: 500, hp: 25, speed: 1.1, sight: 2, armor: 'none', weapon: null, infantry: true, side: null, factory: 'infantry', prereq: [], engineer: true },
  rmbo: { name: 'Commando', cost: 1000, hp: 80, speed: 1.4, sight: 5, armor: 'none', weapon: 'sniper', infantry: true, side: null, factory: 'infantry', prereq: ['hq'], antiBuildingBonus: 6 },
  // vehicles
  jeep: { name: 'Hum-Vee', cost: 400, hp: 150, speed: 3.0, sight: 4, armor: 'light', weapon: 'mg50', side: 'gdi', factory: 'vehicle', prereq: [], turn: 2 },
  bggy: { name: 'Nod Buggy', cost: 300, hp: 140, speed: 3.2, sight: 4, armor: 'light', weapon: 'mg50', side: 'nod', factory: 'vehicle', prereq: [], turn: 2 },
  bike: { name: 'Recon Bike', cost: 500, hp: 90, speed: 3.8, sight: 4, armor: 'light', weapon: 'bikeRockets', side: 'nod', factory: 'vehicle', prereq: [], turn: 3 },
  apc:  { name: 'APC', cost: 700, hp: 200, speed: 2.8, sight: 4, armor: 'heavy', weapon: 'mg50', side: 'gdi', factory: 'vehicle', prereq: ['pyle'], crush: true, turn: 2 },
  ltnk: { name: 'Light Tank', cost: 600, hp: 300, speed: 2.2, sight: 4, armor: 'heavy', weapon: 'cannon75', side: 'nod', factory: 'vehicle', prereq: [], crush: true, turret: true, turn: 1 },
  mtnk: { name: 'Medium Tank', cost: 800, hp: 400, speed: 2.0, sight: 4, armor: 'heavy', weapon: 'cannon90', side: 'gdi', factory: 'vehicle', prereq: [], crush: true, turret: true, turn: 1 },
  htnk: { name: 'Mammoth Tank', cost: 1500, hp: 600, speed: 1.4, sight: 5, armor: 'heavy', weapon: 'cannon120', weapon2: 'mammothTusk', side: 'gdi', factory: 'vehicle', prereq: ['fix'], crush: true, turret: true, turn: 1, selfHeal: true },
  ftnk: { name: 'Flame Tank', cost: 800, hp: 300, speed: 2.2, sight: 4, armor: 'heavy', weapon: 'flameTank', side: 'nod', factory: 'vehicle', prereq: [], crush: true, turn: 1 },
  stnk: { name: 'Stealth Tank', cost: 900, hp: 110, speed: 3.0, sight: 4, armor: 'light', weapon: 'stealthMissile', side: 'nod', factory: 'vehicle', prereq: ['hq'], stealth: true, turn: 2 },
  arty: { name: 'Artillery', cost: 450, hp: 75, speed: 1.6, sight: 4, armor: 'light', weapon: 'arty155', side: 'nod', factory: 'vehicle', prereq: [], turn: 1 },
  msam: { name: 'Rocket Launcher', cost: 800, hp: 100, speed: 1.8, sight: 4, armor: 'light', weapon: 'rocket227', side: 'gdi', factory: 'vehicle', prereq: ['hq'], turn: 1 },
  harv: { name: 'Harvester', cost: 1400, hp: 600, speed: 1.8, sight: 2, armor: 'light', weapon: null, side: null, factory: 'vehicle', prereq: ['proc'], harvester: true, turn: 1 },
  mcv:  { name: 'MCV', cost: 5000, hp: 600, speed: 1.4, sight: 2, armor: 'light', weapon: null, side: null, factory: 'vehicle', prereq: ['fix'], deploysTo: 'fact', turn: 1 },
  // creature — never buildable; spawns when infantry die on tiberium
  vice: { name: 'Visceroid', cost: 0, hp: 150, speed: 1.2, sight: 3, armor: 'light', weapon: 'slime', side: null, factory: null, prereq: [], creature: true, tibImmune: true, turn: 4 },
  // aircraft
  orca: { name: 'Orca', cost: 1200, hp: 125, speed: 4.0, sight: 5, armor: 'light', weapon: 'orcaRockets', side: 'gdi', factory: 'air', prereq: [], air: true, ammo: 6 },
  heli: { name: 'Apache', cost: 1200, hp: 125, speed: 3.6, sight: 5, armor: 'light', weapon: 'heliMg', side: 'nod', factory: 'air', prereq: [], air: true, ammo: 10 },
};

// buildings. w,h in cells. power +out, drain -.
DATA.buildings = {
  fact: { name: 'Construction Yard', cost: 5000, hp: 500, w: 3, h: 2, armor: 'wood', sight: 4, power: 30, drain: 0, side: null, prereq: [] },
  nuke: { name: 'Power Plant', cost: 300, hp: 300, w: 2, h: 2, armor: 'wood', sight: 2, power: 100, drain: 0, side: null, prereq: [] },
  nuk2: { name: 'Adv. Power Plant', cost: 700, hp: 400, w: 2, h: 2, armor: 'wood', sight: 2, power: 200, drain: 0, side: null, prereq: ['nuke'] },
  proc: { name: 'Tiberium Refinery', cost: 2000, hp: 450, w: 3, h: 2, armor: 'wood', sight: 4, power: 0, drain: 30, side: null, prereq: ['nuke'], storage: 1000, freeUnit: 'harv' },
  silo: { name: 'Tiberium Silo', cost: 150, hp: 150, w: 2, h: 1, armor: 'wood', sight: 2, power: 0, drain: 10, side: null, prereq: ['proc'], storage: 1500 },
  pyle: { name: 'Barracks', cost: 300, hp: 400, w: 2, h: 2, armor: 'wood', sight: 3, power: 0, drain: 20, side: 'gdi', prereq: ['nuke'], factory: 'infantry' },
  hand: { name: 'Hand of Nod', cost: 300, hp: 400, w: 2, h: 2, armor: 'wood', sight: 3, power: 0, drain: 20, side: 'nod', prereq: ['nuke'], factory: 'infantry' },
  weap: { name: 'Weapons Factory', cost: 2000, hp: 300, w: 3, h: 2, armor: 'wood', sight: 3, power: 0, drain: 30, side: 'gdi', prereq: ['proc'], factory: 'vehicle' },
  afld: { name: 'Airstrip', cost: 2000, hp: 500, w: 4, h: 2, armor: 'wood', sight: 4, power: 0, drain: 30, side: 'nod', prereq: ['proc'], factory: 'vehicle' },
  hq:   { name: 'Comm. Center', cost: 1000, hp: 500, w: 2, h: 2, armor: 'wood', sight: 5, power: 0, drain: 40, side: null, prereq: ['proc'], radar: true },
  eye:  { name: 'Adv. Comm. Center', cost: 2800, hp: 500, w: 2, h: 2, armor: 'concrete', sight: 5, power: 0, drain: 200, side: 'gdi', prereq: ['hq', 'weap'], superweapon: 'ion' },
  tmpl: { name: 'Temple of Nod', cost: 3000, hp: 1000, w: 3, h: 3, armor: 'concrete', sight: 4, power: 0, drain: 150, side: 'nod', prereq: ['hq', 'afld'], superweapon: 'nuke' },
  hpad: { name: 'Helipad', cost: 1500, hp: 400, w: 2, h: 2, armor: 'wood', sight: 3, power: 0, drain: 10, side: null, prereq: ['proc'], factory: 'air', freeUnitAir: true },
  fix:  { name: 'Repair Facility', cost: 1200, hp: 400, w: 3, h: 3, armor: 'wood', sight: 3, power: 0, drain: 30, side: null, prereq: ['weap', 'afld'], prereqAny: true, repairPad: true },
  gtwr: { name: 'Guard Tower', cost: 500, hp: 400, w: 1, h: 1, armor: 'wood', sight: 4, power: 0, drain: 10, side: 'gdi', prereq: ['pyle'], weapon: 'gtwrMg', defense: true, threat: 0.4 },
  atwr: { name: 'Adv. Guard Tower', cost: 1000, hp: 400, w: 1, h: 1, armor: 'concrete', sight: 5, power: 0, drain: 60, side: 'gdi', prereq: ['hq'], weapon: 'atwrMissile', needsPower: true, defense: true, threat: 0.9 },
  gun:  { name: 'Gun Turret', cost: 600, hp: 400, w: 1, h: 1, armor: 'heavy', sight: 5, power: 0, drain: 20, side: 'nod', prereq: ['hand'], weapon: 'gunTurret', turret: true, defense: true, threat: 0.5 },
  obli: { name: 'Obelisk of Light', cost: 1500, hp: 400, w: 1, h: 1, armor: 'concrete', sight: 5, power: 0, drain: 150, side: 'nod', prereq: ['hq'], weapon: 'obelisk', needsPower: true, defense: true, threat: 0.9 },
  sam:  { name: 'SAM Site', cost: 750, hp: 300, w: 2, h: 1, armor: 'heavy', sight: 5, power: 0, drain: 25, side: 'nod', prereq: ['hand'], weapon: 'samMissile', needsPower: true, defense: true, threat: 0.3 },
};

// sidebar ordering (filtered by prereqOk at runtime)
DATA.buildList = {
  gdi: {
    buildings: ['nuke', 'proc', 'pyle', 'nuk2', 'silo', 'weap', 'hq', 'gtwr', 'fix', 'hpad', 'atwr', 'eye'],
    units: ['e1', 'e2', 'e3', 'e6', 'rmbo', 'jeep', 'apc', 'mtnk', 'harv', 'msam', 'htnk', 'orca', 'mcv'],
  },
  nod: {
    buildings: ['nuke', 'proc', 'hand', 'nuk2', 'silo', 'afld', 'hq', 'gun', 'sam', 'fix', 'hpad', 'obli', 'tmpl'],
    units: ['e1', 'e3', 'e4', 'e6', 'e5', 'rmbo', 'bggy', 'bike', 'ltnk', 'harv', 'arty', 'ftnk', 'stnk', 'heli', 'mcv'],
  },
};

// EVA speech lines
DATA.eva = {
  building: 'Building',
  constructionComplete: 'Construction complete',
  unitReady: 'Unit ready',
  insufficientFunds: 'Insufficient funds',
  lowPower: 'Low power',
  newOptions: 'New construction options',
  baseUnderAttack: 'Base under attack',
  silosNeeded: 'Silos needed',
  ionReady: 'Ion cannon ready',
  ionCharging: 'Ion cannon charging',
  nukeReady: 'Nuclear weapon available',
  nukeLaunched: 'Nuclear weapon launched',
  unitLost: 'Unit lost',
  buildingCaptured: 'Building captured',
  cancelled: 'Cancelled',
  onHold: 'On hold',
  repairing: 'Repairing',
  unitRepaired: 'Unit repaired',
  select: 'Select target',
  missionAccomplished: 'Mission accomplished',
  missionFailed: 'Mission failed',
  battleControlOnline: 'Battle control online',
  battleControlTerminated: 'Battle control terminated',
  reinforcements: 'Reinforcements have arrived',
};

// unit voice acknowledgments (AUDIO.ack(kind, cls)) — per unit class
DATA.acks = {
  selectInf: ['Yes sir?', 'Reporting', 'Awaiting orders', 'Ready and waiting', 'Sir?'],
  selectVeh: ['Vehicle reporting', 'Reporting', 'Ready', 'Standing by'],
  selectAir: ['Airborne and ready', 'Reporting'],
  move: ['Acknowledged', 'Affirmative', 'Moving out', 'Right away sir', 'On my way'],
  attack: ['Acknowledged', 'Affirmative', 'Attacking', 'Engaging'],
};
