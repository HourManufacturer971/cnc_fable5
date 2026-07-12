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
//   objective  { type: 'annihilate' }
//              { type: 'harvest', amount }        — bank that much chrysalite
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
  },
  {
    n: 2, title: 'GREEN GOLD', seed: 4257,
    credits: 3000, aiCredits: 5000, aiCalm: 1.4,
    objective: { type: 'harvest', amount: 6000 },
    objText: {
      gdi: 'Bank 6000 credits of harvested chrysalite. Keep your harvesters alive.',
      nod: 'Bank 6000 credits of harvested chrysalite. The Order provides nothing else.',
    },
    brief: {
      gdi: [
        'The war effort runs on chrysalite, Commander, and headquarters is running on fumes. This sector holds some of the richest fields we have charted — and a Serpent Order garrison that knows it.',
        'Your task is not conquest. Establish refining operations and bank six thousand credits of processed chrysalite. Defend the harvest chain; every crystal counts. Wipe the enemy out if you must, but the quota is the mission.',
      ],
      nod: [
        'Faith does not fuel the war machine, disciple. Chrysalite does. The Order requires six thousand credits of the green harvest from this sector, and the Coalition squats upon the richest fields.',
        'Take what is ours beneath their noses. Guard your harvesters as you would your own blood — the quota is sacred. Annihilation of the UDC is permitted, but it is not required. The harvest is all.',
      ],
    },
  },
  {
    n: 3, title: 'HOLD THE LINE', seed: 9773,
    credits: 7000, aiCredits: 9000, aiCalm: 0.55,
    objective: { type: 'survive', minutes: 10 },
    objText: {
      gdi: 'Survive for 10 minutes. Reinforcements are inbound.',
      nod: 'Endure the Coalition storm for 10 minutes. The faithful do not break.',
    },
    brief: {
      gdi: [
        'Bad news, Commander. The Serpent Order has massed for a counter-offensive and your position is squarely in its path. Air support is grounded and the relief column is ten minutes out.',
        'Dig in. Wall up, keep your power grid humming and your defenses hot. Whatever comes out of that haze — hold the line for ten minutes and this position stays ours.',
      ],
      nod: [
        'The Coalition believes this temple site can be swept aside before dawn, disciple. They are already moving — armor, infantry, gunships, all of it.',
        'The Serpent does not retreat. Root yourself, raise stone and flame around the faithful, and endure their storm for ten minutes. Break their momentum here and their whole offensive dies in the mud.',
      ],
    },
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
  },
];

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
