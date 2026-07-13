# Harvest War — Engineering Spec

An original real-time strategy game in the mid-90s mold, built from scratch with
**original code and original procedurally-generated pixel art / synthesized audio**.
Inspired by the classic RTS genre; contains no assets, names, or code from any other game.

## Tech constraints

- Plain ES2020 JavaScript, **no modules, no build step, no dependencies**. Every file is a
  classic `<script>` that defines the global symbols listed for it below and nothing else.
- Internal resolution **640×400** (period-correct low resolution), rendered on one `<canvas>`
  scaled up with `image-rendering: pixelated`.
- Game logic runs at a fixed **15 ticks/second** (`C.TPS`) the classic "normal" RTS tick rate;
  rendering runs on `requestAnimationFrame`.
- All randomness inside the simulation must use `game.rng()` (seeded) — never `Math.random()`
  inside sim/production/ai/map code. UI/audio/effects may use `Math.random()`.
- Script load order (index.html): `core.js, data.js, sprites_terrain.js, terrain_paint.js,
  sprites_units.js, sprites_infantry.js, sprites_buildings.js, audio.js, music.js, missions.js,
  map.js, path.js, fog.js, sim.js, production.js, ai.js, input.js, render.js, net.js, main.js`
  (net.js must load after sim/production — it wraps their order functions — and before main).
- Every file must pass `node --check`.

## Screen layout (all coordinates in internal 640×400 px)

- **Tab bar**: y 0..16, full width. Left: "Options" tab (click → pause menu). Right half shows
  credits readout (ticks up/down toward real value, ~worth /40 per frame, min 1) and a game
  timer. Sidebar background is dark metal grey (`PAL.uiMetal`).
- **Map viewport**: x 0..480, y 16..400 (480×384 → 20×16 cells of 24px).
- **Sidebar**: x 480..640, y 16..400 (160×384), metal grey panel:
  - **Radar** area: 480..640 × 16..146 (160×130). Shows faction logo (drawn: UDC gold
    shield-and-chevron crest on navy / Serpent Order coiled-serpent ring on black) until player owns a powered
    `hq`; then a 128×128 minimap centered (2px per cell, terrain colors, chrysalite green,
    units as 2px team-color dots, buildings 2px blocks, shroud black, white viewport
    rectangle). Click/drag on active radar moves the camera.
  - **Buttons row**: y 146..168: three 48×20 buttons at x 484/536/588: `REPAIR`, `SELL`, `MAP`
    (MAP is decorative/disabled). Repair/Sell toggle input modes; active mode = lit border.
  - **Two build strips**: left strip x 484..548 = **structures**, right
    strip x 552..616 = **units** (infantry+vehicles+aircraft mixed, ordered by DATA list).
    Each strip shows **4 cameo icons** of 64×48 stacked from y 172 (spacing 50px: 172, 222,
    272, 322), and at the strip bottom (y 372..384) a pair of 32×12 up/down scroll arrow
    buttons. Strips scroll independently (`game.human.scroll.b` / `.u`).
  - Superweapon cameos (`ion` for UDC w/ eye, `nuke` for the Serpent Order w/ tmpl) appear in the units
    strip when their building exists; overlay text shows charge countdown m:ss or "READY".
- Cursor: OS cursor hidden over canvas; custom cursor sprite drawn by render at
  `Input.mouse` position using `Input.cursorKind`.

## Coordinate systems

- **cell**: integer grid coords `cx∈[0,64), cy∈[0,64)`; index `cellIdx(cx,cy) = cy*C.MAP_W+cx`.
- **world px**: `wx = cx*24 + 12` is a cell center. Units store world px centers (floats).
- **screen px**: `sx = wx - game.camera.x`, `sy = wy - game.camera.y + C.TAB_H`.
  Camera is clamped to `[0, C.MAP_W*24 - C.VIEW_W] × [0, C.MAP_H*24 - C.VIEW_H]`.
- **facing**: 0..15, 0 = north (up), clockwise (4 = east). Infantry use 8 facings (facing>>1).

## File ownership & public globals

`core.js` and `data.js` are ALREADY WRITTEN — read them, they are the source of truth for
every shared shape and constant. Do not redefine their symbols. Each remaining file must
define **exactly** the globals listed and may freely call any global listed for other files.

| file | globals defined |
|---|---|
| core.js | `C`, `PAL`, `game`, `SPRITES`, `EV`, `uid`, `mulberry`, `clamp`, `lerp`, `dist`, `cellIdx`, `inMap`, `worldToCell`, `cellCenterX/Y`, `dirTo16`, `turnFacing`, `angleOf16`, `mkCanvas`, `rotFrames`, `makeGame`, `makePlayer`, `makeUnit`, `makeBuilding`, `addUnit`, `addBuilding`, `removeUnit`, `removeBuilding`, `getEnt`, `occAt`, `setOcc`, `clearOcc`, `terrainPassable`, `isPassable`, `footprintCells`, `applyDamage`, `enemyOf` |
| data.js | `DATA` (warheads, weapons, units, buildings, build lists, announcer lines) |
| sprites_terrain.js | fills `SPRITES.terrain`, `SPRITES.chrysalite`, `SPRITES.fx`, `SPRITES.cursor`, `SPRITES.logo`, `SPRITES.shroudEdge` |
| terrain_paint.js | `TERRAINPAINT` (`build(game) -> {canvas, anim}` — continuous full-map ground painter) |
| sprites_units.js | fills `SPRITES.units[key][side]` for every vehicle & aircraft, and their `SPRITES.cameo[key]` |
| sprites_infantry.js | fills `SPRITES.infantry[key][side]` for every infantry type, and their `SPRITES.cameo[key]` |
| sprites_buildings.js | fills `SPRITES.buildings[key][side]` for every building, and their `SPRITES.cameo[key]`, plus `SPRITES.cameo.ion` / `SPRITES.cameo.nuke` |
| audio.js | `AUDIO` (`init, play, eva, ack, setEnabled, enabled, setVoiceEnabled, voiceEnabled, tickCredits`) |
| music.js | `MUSIC` (`start, stop, setEnabled, enabled` — original procedural soundtrack, eight tracks, random opener, rotates after two loops) |
| missions.js | `MISSIONS` (campaign definitions: seed, credits, AI knobs, objective, per-side briefings), `MissionProgress` (localStorage `hw_progress` unlock tracking) |
| map.js | `MAPGEN` (`generate(game, seed, opts?)` — `opts.holdout` centers the human start inside a three-gated rock fortress ring with thin chrysalite inside and rich fields beyond) |
| path.js | `findPath(unit, destCx, destCy, opts?) -> [{cx,cy},...]` |
| fog.js | `Fog` (`init, revealCircle, update, isExplored`) |
| sim.js | `Sim` (`tick`), `orderMove`, `orderAttack`, `orderHarvest`, `orderDeploy`, `orderEnter`, `orderBoard`, `unloadCargo`, `stopUnit`, `killEntity`, `fireIon`, `fireNuke`, `spawnEffect`, `spawnBullet` |
| production.js | `Production` (`tick, tryStart, toggleHold, cancel, items, canPlace, place, sell, toggleRepair, computePower, categoryOf, prereqOk, superReady, launchSuper, setPrimary`) |
| ai.js | `AI` (`init, tick, _peek` — `_peek` is a read-only debug/test hook) |
| input.js | `Input` (`init, tick, mouse, cursorKind, mode, modeArg`) |
| render.js | `Render` (`init, frame, worldFromScreen, hitTest`) |
| net.js | `NET` (P2P lockstep: `host, acceptAnswer, join, testLocal, close, pump, ready, applyTick, postTick, stalledMs, initExplored, checksum`, flags `active/applying/inSim/side/desynced`) |
| main.js | `Main` (`boot, startGame, endGame`), starts loop, menu DOM wiring |

## Game state (created by `makeGame` in core.js — read it)

Key fields: `tick, seed, rng, terrain (Uint8Array), tvar (Uint8Array), tib (Uint16Array),
occ (Int32Array unit/building id per cell or 0), units (Map id→unit),
buildings (Map id→building), bullets [], effects [], players {gdi, nod}, human, ai,
humanSide, camera {x,y}, selection [id...], groups {1..9: [ids]}, shroud (Uint8Array),
status ('playing'|'won'|'lost'), speed (tick multiplier 1), stats {kills, losses,
buildingsKilled, buildingsLost, harvested}, evaCooldowns {}`.

Player fields (`makePlayer`): `side ('gdi'|'nod'), isAI, credits, storage (recomputed),
power {out, drain}, queues {building:null|Job, infantry:null|Job, vehicle:null|Job,
air:null|Job} (each factory kind builds concurrently on its own line), unitQueue
{infantry:[], vehicle:[], air:[]} (pending keys per line, max C.QUEUE_MAX each),
ready {building: key|null}, scroll {b:0,u:0}, radar (bool, recomputed),
super {key:null|'ion'|'nuke', timer, max}, unitIds [], buildingIds [],
primary {infantry:0, vehicle:0, air:0} (building ids; set by Production.setPrimary)`.
Job = `{key, spent, total, ticksLeft, ticksTotal, hold}`. `categoryOf(key)` returns
`'building'` for structures or the factory kind (`'infantry'|'vehicle'|'air'`) for units
— that's the queue line it belongs to. Owning more finished factories of a kind speeds
that line's ticksLeft/credit drip (capped ×2.5); owning more finished `eye`/`tmpl`
speeds the matching superweapon charge (capped ×4/tick).

Unit fields (`makeUnit`): `id, kind:'unit', type, owner, x, y, facing, turretFacing, hp,
path [], pathi, moveTarget {cx,cy}|null, targetId, state ('idle'|'move'|'attack'|'harvest'|
'return'|'unload'|'enter'|'board'|'boarded'|'air'|...), cooldown, tib (harvester load
0..C.HARV_CAP), ammo, cloaked, decloakTicks, anim, spawnTick, guardAnchor {x,y}|null,
cargo (array of passenger unit objects, or null — only present when DATA.units[type].transport
is set), boardTargetId (id of the transport an infantry unit is walking to)`.
A boarded passenger is fully detached from `game.units`/occupancy (kept alive only by the
transport's `cargo` array reference) until `unloadCargo` re-adds it; it dies with its
transport if the transport is destroyed.

Building fields (`makeBuilding`): `id, kind:'building', type, owner, cx, cy (top-left), hp,
turretFacing, targetId, cooldown, buildProgress (0..1, 1 = finished), repairing, anim,
rally {cx,cy}|null, spawnTick`.

## Terrain ids

`0 grass, 1 dirt, 2 rock (impassable), 3 water (impassable), 4 tree (impassable),
5 blossom tree (impassable, regrows chrysalite around it), 6 bridge deck (passable,
drawn over water)`. `game.tvar` picks sprite variants.
Chrysalite lives in `game.tib` (0..C.TIB_MAX per cell) independent of terrain (only on 0/1).
MAPGEN also fills `game.decor = { bridge, waterfall, village }`: bridge cells, the
waterfall cell, and the neutral hamlet layout that main.js spawns as 'civ'-owned
buildings/units (players include a `civ` stub owner nobody auto-targets). The hamlet is
farmhouse + chapel (`chur`) + two cottages + barn; the chapel drops a guaranteed cash
crate when destroyed (see Crates).

## Core game rules (be faithful to the 1995 original)

### Economy
- Harvester: capacity `C.HARV_CAP = 700` credits (28 "bails" of 25). Harvest one bail per
  ~10 ticks from the current cell (`game.tib` -= 25), auto-move across the field, when full
  (or field exhausted and >0 load) drive to own refinery dock cell (the cell just south of
  the refinery's middle column), unload over ~60 ticks adding credits gradually
  (respect storage cap; excess is lost + EVA `silosNeeded` and a red `-N` popup when ≥50
  evaporates), then return to last field.
  Idle harvesters auto-seek visible chrysalite. New refinery spawns a free harvester beside it.
- Harvester field discipline: target cells are LEASHED to ~20 cells of the home dock while
  local crystal lasts; when the neighborhood is dry an EMPTY harvester treks unleashed to
  whatever is left on the map (never idles the economy to death), and a PARTIALLY loaded
  one tops off within ~10 cells of itself — so a far field is eaten until the hopper is
  full, never one cell per round trip. Known-unreachable cells are blacklisted
  (`u._noReach`) for ~60s. Cell choice is SCORED, not nearest-wins:
  `dist² − (3x3 richness)/100 + 60·crowd`, where crowd counts other own harvesters whose
  current target sits within 3 cells — the fleet aims at fat pockets and spreads out
  instead of stacking on the same dying crumb (all sim-state reads, deterministic).
  COMMITMENT (`_pickTibTarget`): when the best leashed cell's 3x3 pocket is under 400
  (a dying field), an EMPTY harvester runs a richness-first sweep of the whole map
  (`score = 0.1·dist² − rich`) and commits to any field ≥3× richer than the local scraps —
  no more grinding 25-credit crumbs while a full field sits two screens away.
- Dock etiquette (`_shoveIdle`): a returning harvester within 4 cells of its dock nudges
  FRIENDLY idle ground units off the dock cell and off its next path cell (orderMove to a
  free neighbor, never onto another dock). Enemy units are a legitimate blockade and stay.
- Sealed dock rescue: in `return`, if the path's END cell can't reach within 1.5 cells of
  the dock (walled in — findPath retargets blocked destinations, so emptiness is not the
  signal) the harvester re-books to any OTHER refinery whose dock its path can actually
  reach (`u._procId`); if none exists, the human owner gets EVA `harvesterStranded` + a
  radar ping (throttled ~30s).
- Under fire, a harvester announces `harvesterUnderAttack` + radar ping (throttled ~20s,
  human owner only — cosmetic, never sim-affecting).
- `Production.canPlace` REJECTS any own-building footprint covering one of your refinery
  dock cells, and a new refinery whose dock cell would be off-map/impassable/built-over.
- Default factory rally (`_defaultRally`) is 2 cells south of the factory but dodges to
  the nearest cell that isn't on/adjacent to an own refinery dock — fresh units must never
  congregate where harvesters unload. An explicitly-set `fac.rally` is respected as-is.
- Storage: refinery 1000, silo 1500. `player.storage` = sum over owned finished buildings.
  Credits over storage bleed away (clamped on add).
- Chrysalite growth: every ~75 ticks a few random chrysalite cells with value ≥ 125 spread 25 to
  a random adjacent grass/dirt cell (new cells start at 25, cap C.TIB_MAX=300); blossom
  trees seed/refill adjacent cells more aggressively. Growth throttles as the map saturates
  (>550 live cells: fewer spreads; >850: none) so unharvested fields plateau. Infantry
  standing on chrysalite take 1 hp per 8 ticks (chem warrior `e5` immune).
- **Supply crates** (`g.crates`, sim state, in the MP checksum): every 10s there's a 40%
  chance a crate spawns on a random passable, unoccupied, chrysalite-free cell (max 2 live,
  expire after 3 min). Any gdi/nod ground unit entering the cell consumes it (checked every
  5 ticks via `g.occ`); effect rolls on `game.rng`: <0.5 cash 1200-2000 (ignores storage
  caps — found money), <0.65 heal every owned unit to full, <0.8 the picker gains +3 kills
  (instant promotion), <0.95 a free mtnk/ltnk beside the crate (800 scrap if no room),
  else map-wide recon (explored for that side; shroud too if it's the local human's).
  Feedback (EVA `crateSalvage/crateRepairs/crateUnit/crateRecon`, effects) is humanSide-
  gated and cosmetic. Drawn as a small blinking supply box; blinking white radar dot
  (explored cells only). A crate may carry `kind: 'cash'` — it then skips the lottery
  (`roll = 0.2`, same rng pattern on both clients since kind is shared sim state).
  Destroying the village chapel (`chur`) drops one such crate in the rubble.

### Power
- `Production.computePower(player)` recomputes `player.power` (sum of DATA `power` /
  `drain` over finished buildings, scaled by hp fraction for generators like the original).
- Low power (`drain > out`): production takes **2×** ticks, radar goes dark (EVA `lowPower`
  once/30s), obelisk and AGT can't fire, SAMs can't fire.

### Construction (sidebar)
- Two queues per player: `building` and `unit` (unit strip covers infantry+vehicles+air but
  only ONE thing builds at a time per strip, like the original — no multi-queue).
- Prerequisites per DATA `prereq` (list of building keys, all must exist finished) plus the
  producing building itself; UDC items require UDC production buildings etc. per DATA `side`
  (null = both sides).
- Cost is deducted **incrementally** each tick while building; if credits run dry the job
  stalls (EVA `insufficientFunds` once/15s). `ticksTotal = ceil(cost * C.BUILD_TPC)`
  (C.BUILD_TPC ≈ 0.9 ticks per credit) — doubled while low power.
- Buildings: when done, EVA `constructionComplete`; icon flashes READY; click icon → enter
  placement mode; place on valid cells (all footprint cells: in map, terrain 0/1, no tib,
  unoccupied, unshrouded, and at least one footprint cell within `C.ADJACENCY=1` cells of an
  existing friendly building footprint). Placement draws green/red cell overlay. Right-click
  or Esc exits placement (job stays ready). On place: building appears with construction
  animation (buildProgress 0→1 over ~25 ticks, rendered as bottom-up reveal + scaffold
  flicker), then EVA `newOptions` if it unlocked anything.
- Units: when done, spawn at primary factory (barracks/hand for infantry, weap for
  vehicles, hpad for aircraft, afld for Serpent Order vehicles: a cargo plane effect flies across and
  the vehicle appears at the airstrip), EVA `unitReady`, walk to rally point (building
  `rally`, set by clicking a factory then left-clicking ground... keep: rally = 2 cells south
  of factory).
- Left-click an in-progress icon → toggle hold (EVA `onHold` / `building`); right-click →
  cancel, refund `spent` (EVA `cancelled`).
- Icon click with unmet prereqs/never → buzz. Icon layout order comes from
  `DATA.buildList[side].buildings` / `.units` filtered to `Production.prereqOk` "visible"
  (prereq met → shown; else hidden).

### Repair / Sell
- Repair mode: click own damaged building → toggles `repairing`; heals `C.REPAIR_HP=1` hp
  per tick at cost `cost/maxHp * C.REPAIR_COST=0.3` credits per hp (stops when broke/full).
  Wrench overlay blinks while repairing. EVA `repairing` on start.
- **Vehicle repair at the Repair Facility** (`fix`, DATA `repairPad`): `_tickRepairPads`
  (sim.js, every tick, sides in fixed gdi→nod order) heals ONE own ground vehicle per
  pad per pass — the first `state === 'idle'`, damaged, non-infantry non-air unit found in
  a row-major scan of the footprint+2 apron — 2 hp/tick at the building repair rate,
  skipped when broke. Clicking an own finished `fix` with vehicles selected orders them to
  formation cells at the pad's south edge ('repair' cursor, EVA `repairing`); the order is
  plain orderMove so it needs no new net command. `u._fixT` stamps healing for the render
  wrench blink. A damaged harvester parked at the pad is EXEMPT from idle auto-seek until
  healed (`_onRepairPad`) — the wrench finishes before the field calls. Engineer-heal of a
  damaged own building outranks the pad branch on click, matching the cursor.
- Sell mode: click own building → removed after quick deconstruct effect, refund
  `0.5 * cost * (hp/maxHp)`, play sell sound. Selling the last construction-capable building
  is allowed (the original let you doom yourself).

### Combat
- Weapons in `DATA.weapons`: `{dmg, range (cells), rof (ticks), speed (px/tick, 0=hitscan),
  warhead, splash (px, 0=direct), antiAir (bool), turret (bool for shooter aiming)}`.
- Damage = `dmg * DATA.warheads[wh][armor]` via `applyDamage` (already in core.js); armor ∈
  none/light/heavy/wood/concrete.
- Units auto-acquire: idle combat units scan every 8 ticks for nearest enemy within
  `sight+1` cells and attack (harvester/mcv/apc/engineer never auto-attack; they FLEE:
  harvester heads to refinery when hit). Attackers chase up to ~4 cells past their
  guardAnchor then return.
- **Attack-move** (`orderAttackMove(u, cx, cy)`, state `amove`, `u._amove={cx,cy}`): sweep
  toward the cell, auto-acquiring every 8 ticks; acquisition sets `targetId`/`state='attack'`
  DIRECTLY (not via orderAttack) so `_amove` survives, and when the target dies the unit
  re-issues the sweep to the stored destination. Any explicit player order (move/attack/
  stop) clears `_amove`. Non-combat and air units delegate to plain move. Networked as the
  `amv` command.
- **Veterancy**: gdi/nod units track `u.kills` (credited in `killEntity` to a living
  attacker of a different side; civilian victims don't count). `vetLevel(u)`: ≥3 kills =
  veteran (+20% weapon damage, silver chevron), ≥6 = elite (+40%, gold chevrons, self-heals
  1hp/24 ticks). Promotion of your own unit: EVA `unitPromoted` + rising gold-chevron
  effect. Kills and crates are mixed into the MP checksum. Defensive buildings (gtwr, atwr, gun, obli, sam) auto-target
  nearest enemy in range every 4 ticks (sam only antiAir). Obelisk: 2s charge-up sound+glow
  before each shot, laser beam effect, needs power. Units return fire when damaged (if
  attacker in range & targetable).
- Projectiles: hitscan (mg/flame short) apply damage immediately + tracer/flame effect;
  shells travel linear with small arc, rockets home on target, artillery lobs (slow, big
  splash, inaccurate vs moving). Splash damages all entities within radius (linear falloff,
  friendly fire ON like the original).
- Tanks (flag `crush`) kill enemy infantry by driving onto their cell (squish sound) —
  pathfinding treats enemy-held cells as passable-but-costly, so a move order whose route
  happens to cross stationary infantry crushes it; left-click on an enemy always orders
  attack, never a deliberate drive-over.
- Behemoth Tank (flag `dualBarrel`) fires its primary cannon as two half-damage shots from
  offset muzzle points each volley (same total damage as one shot — a visual/behavioral
  flourish, not a buff); its sprite carries a `_scaleBoost` read by `Render`'s `sca()` so it
  draws visibly bigger than every other tank.
- Transports (flag `transport: N` on a unit, e.g. `apc: 5`) carry infantry: `orderBoard(u,
  transport)` walks the infantry adjacent then embarks it (`removeUnit` + push onto
  `transport.cargo`, kept alive only by that reference); `unloadCargo(transport)` disembarks
  everyone into free nearby cells. A destroyed transport kills its cargo.
- Aircraft (`orca`, `heli`): fly ignoring terrain/occupancy (state 'air'), have `ammo`
  (orca 6 rockets, heli 15 mg bursts, from DATA), fly to target, orbit-strafe firing until
  ammo out, then auto-return to a free `hpad` to rearm (ammo refills over ~5s) and RESUME
  the old target if it still stands. Pad claims cycle: a rearmed bird lifts off and clears
  the pad the moment another empty own airframe is waiting, and an empty bird with no free
  pad re-asks every ~3s (a pad may free up or get built later) — a wing larger than its
  pads still keeps flying. Selected aircraft show AMMO PIPS under the health bar. Only
  `antiAir` weapons can hit them. Drawn with drop-shadow, bob animation, above everything.
- Stealth tank `stnk`: `cloaked=true` unless firing (decloak 45 ticks) or within 2 cells of
  enemy infantry/defense. Cloaked units invisible to enemy (AI ignores), drawn as shimmer
  outline for owner. Uncloaked briefly when damaged.
- Engineer `e6`: `orderEnter` on enemy building → walks in, captured! (building swaps owner,
  engineer consumed, like the original's instant capture). On own damaged building: restores
  full hp, consumed.
- MCV: `orderDeploy` (click when selected, or press D) → if 3×2 fact footprint (top-left =
  mcv cell + (-1,-1)) placeable → replaced by fact building. Else buzz + no-deploy cursor.

### Superweapons
- UDC: `eye` finished → orbital lance, charge `C.SUPER_TICKS.ion = 5400` ticks (6 min). Ready →
  EVA `ionReady`, cameo READY; click cameo → target mode → click map: white-blue beam column
  effect, `800 dmg` warhead `laser` splash 36px at point after ~1s (INVARIANT: leaves a
  900hp conyard at sliver hp instead of one-shotting it). Then recharges.
- Both fires push a radar `strike` ping AND a `g._strikes` entry — render draws a pulsing
  red reticle + cross at the aim point during the warning seconds (explored cells only).
- Serpent Order: `tmpl` finished → nuke, `C.SUPER_TICKS.nuke = 6300`. EVA `nukeReady`/`nukeLaunched`;
  missile drops after 3s: `600 dmg` warhead `he`, splash 84px, leaves scorch, screen flash
  + shake. Superweapon state lives on `player.super`; timers tick in Production.tick; only
  while the granting building exists (destroyed → super removed).

### Fog of war
- Black shroud, permanently revealed (no re-shroud, like TD). `game.shroud` bytes: 0 hidden,
  1 explored. Reveal circles of `sight` radius around human units/buildings each few ticks.
  AI sees everything. Hidden cells: draw black; cells adjacent to hidden get jagged dark
  edge overlay (`SPRITES.shroudEdge`). Radar: three layers — the painted terrain
  downscaled once per map (`minimapBase`), shroud+tiberium refreshed every 8 ticks, and
  entity blips drawn EVERY frame from live world coordinates (enemy blips gated on
  current line-of-sight, cloaked units hidden). Radar shows only explored. Enemies/tib in hidden
  cells invisible & untargetable; can't place buildings or superweapons into shroud.

### Win / lose
- A side with **no buildings and no units** loses (check every 15 ticks once game past
  30s). Human wins → EVA `missionAccomplished`, score screen; loses → `missionFailed`.
  Score screen (Main): dark screen, tally lines (time, credits harvested, units
  destroyed/lost, buildings destroyed/lost, score) + "PLAY AGAIN" button → menu.

### Campaign missions (missions.js + main.js)
- Faction pick opens an **Operations** overlay: SKIRMISH (random map, exactly the old
  behavior) plus 5 fixed-seed missions, locked in order. Progress = `hw_progress` in
  localStorage (highest mission number completed); a mission button opens a **briefing**
  overlay (per-side flavor paragraphs + one-line objective) with COMMENCE / Back.
- `startGame(side, {mission})` stores the definition on `game.mission`, applies
  `mission.credits` / `mission.aiCredits`, and uses `mission.seed`. Restart Mission
  restarts the same mission; `?mission=N` boots one headlessly.
- Objectives, checked in `Main._checkEnd` (annihilation still wins/loses everything):
  `harvest {amount}` (win when the BANK BALANCE `g.human.credits >= amount` — spending
  sets you back, storage silos are required to hold it), `survive {minutes}` (win at
  the bell; mission 3 pairs this with `holdout: true` map gen), `killEconomy` (arms once
  the AI owns a refinery or harvester — flag `game._ecoArmed` — then wins when the count
  returns to zero). Winning unlocks the next mission (`MissionProgress.unlockUpTo`).
- AI difficulty knobs read from `game.mission` by ai.js: `aiCalm` multiplies wave-cadence
  delays (first strike + between waves), `aiWaveCap` caps units per strike wave.
  Skirmish (`game.mission` null) keeps the exact original cadence.
- Render draws a small objective status chip at the top-left of the viewport
  (`TREASURY n / m`, `HOLD OUT mm:ss`, `ECONOMY TARGETS LEFT: n`, or the annihilate
  line); skirmish shows none.

### Multiplayer (net.js — deterministic lockstep, P2P)
- 1v1 over a WebRTC data channel with MANUAL signaling: host and guest exchange
  two base64 codes by hand (any chat) — no server, no accounts; the only outside
  service is a public STUN server for NAT discovery (LAN/same-machine works
  without it). A `BroadcastChannel` transport (`?mpbc=name&mphost=1&side=`)
  drives two-tab play on one machine and the automated tests.
- Lockstep: both clients run the identical sim from the host's seed; only
  orders travel. Each order is queued locally, broadcast with execution tick
  `now + DELAY` (5 ticks), and applied on BOTH clients at that tick, gdi's
  batch before nod's. A client may only advance to tick T once it holds both
  batches for T; the loop stalls otherwise (render keeps running, "WAITING FOR
  OPPONENT…" after 600 ms). Batches for a tick horizon are always broadcast
  BEFORE the barrier check so a stall can never deadlock.
- Order interception: net.js wraps the global order functions and the
  Production mutators at load time. Wrappers pass straight through when NET is
  inactive, when inside the sim step (`NET.inSim` — harvester auto-seek, rally
  moves, AI), or when executing scheduled commands (`NET.applying`); otherwise
  they serialize a command. Fog-based validation (`cellOk` shroud test,
  `launchSuper` explored test) is pre-validation on the issuing client only and
  is skipped under `NET.applying`.
- MP start is symmetric and canonical: both sides get an MCV + escort; gdi
  always takes the map's SW slot, nod the NE one, gdi spawns first (identical
  entity ids on both clients). `_uid` resets in `makeGame`. AI.tick is skipped
  (AI.init still runs — a symmetric rng draw). The main loop ticks production
  in fixed side order (gdi, nod), never human-first.
- Desync detection: FNV-1a checksum of (tick, unit id/x/y/hp/load, building
  id/hp/progress, credits, super timers) exchanged every 128 ticks; mismatch →
  both clients show "DESYNC DETECTED", `game.status = 'desync'`, link closed.
  Disconnect / Abort mid-game forfeits: the remaining player wins.
- **Determinism rules all future sim changes must respect**: sim randomness
  only via `game.rng`; sim behavior must never read `g.shroud`/`g.visible`,
  `g.humanSide`, or `p.isAI` (for fog filtering use `_exploredFor(g, side)` —
  per-side maps `g.mpExplored` in MP; for player feedback gate on
  `p === g.human` / `owner === g.humanSide`, which is cosmetic-only); iterate
  players in fixed side order; effects/audio/EVA may diverge per client and
  stay out of the checksum. `Math.sin/cos/atan2` are engine-dependent — pairs
  on the same browser are safe; cross-browser matches may eventually desync
  (detected, not prevented).

### Gameplay feedback (juice)
- Depth: buildings and ground units draw in ONE painter's pass sorted by baseline
  (building = footprint bottom edge, unit = feet at y + CELL/2), so units pass BEHIND
  tall structures and in front of their feet. Air units, bullets, effects stay on top.
- Pad repairs blink a small gold wrench over the vehicle (`u._fixT`, `_drawWrench`).
- `applyDamage` stamps `target._hitT = game.tick`; render re-draws the sprite twice with
  `globalCompositeOperation='lighter'` for 2 ticks — a white hit-flash (units, buildings).
- Successful move/harvest/rally orders spawn a `moveMark` effect (green collapsing ring,
  ttl 14); attack orders an `atkMark` (red). Drawn procedurally in `_drawEffect`.
- Harvester unload accumulates `u._paid`; on completion (human only) spawns a `cash`
  effect — floating gold `+N` text that drifts up and fades (ttl 24).
- `_tickDamageSmoke` (sim.js): buildings under 45% hp emit drifting smoke puffs
  (period 22 ticks, 10 when under 22%); non-air vehicles under 40% hp trail smoke.
  Timed off tick+id hashes — never `game.rng` — so the sim stream is untouched.
- **Radar pings** (`g._pings`, per-client COSMETIC buffer, capped 24, never checksummed):
  base-attack, harvester-attack, harvester-stranded, crate and superweapon `strike` events
  push `{x,y,kind,t}`; radar draws expanding rings (strike red, harv gold, else orange,
  90-tick life). `Space` jumps the camera to the newest ping.
- Base-attack alarm: building damage accumulates in `g._atkAcc` (decays after 300 quiet
  ticks); at ≥50 total the human owner gets EVA `baseUnderAttack` (throttled 30s) + ping —
  a stray potshot no longer triggers the klaxon.
- `insufficientFunds` nag escalates: 15s → 30s → 60s → 120s between repeats
  (`g._fundsNags`), reset the moment a harvester delivers ≥1 credit.
- HUD balance shows `$ N /storage` (suffix hidden until the first refinery); both turn red
  when credits ride the cap — the moment loads start evaporating.
- IDLE HARV chip (tab bar, blinking): appears only when own harvesters are idle — which
  only happens once every reachable field is gone or blocked, i.e. the economy has
  actually stalled. Clicking it cycles through the idle harvesters (select + center).
  Render/input only, per-client.
- **Hunt mode** (`_huntCount`, render-only): enemy down to ≤3 non-wall buildings AND zero
  combat units → gold `TARGETS REMAINING: n` chip (playing state, takes precedence over
  the mission-objective line) and the surviving enemy buildings AND units show on radar.
  Unarmed stragglers (harvester, MCV, engineer) count as targets too — victory needs every
  unit dead, so the assist must not vanish with the last building. DISABLED whenever
  `NET.active`: in MP `g.ai` is the remote human and the reveal would be a fog cheat.

### Controls (classic left-click scheme)
- **Left-click**: select own unit(s)/building; with selection on: click enemy → attack;
  click ground → move (units) ; click chrysalite w/ harvester selected → harvest; click own
  building w/ engineer... (engineer targets enemy building = enter/capture cursor); click
  selected MCV again → deploy; click own factory → select it (its rally shown).
- **Drag left**: selection box (own units only; buildings excluded unless single-click).
- **Right-click**: deselect / cancel mode (placement, repair, sell, super target). NO
  right-click orders — authentic to the original.
- Shift+click adds/removes from selection. Double-click a unit selects all visible of type.
- Ctrl+click on open GROUND with combat units selected = attack-move to that spot (`A` also
  arms an attack-move mode: attack cursor, next left-click sweeps there in formation).
  Ctrl+click on an ENTITY stays focus-fire — entity beats ground.
- Ctrl+1..9 assign group; 1..9 select; double-tap centers camera.
- Keyboard scroll: arrows; edge scroll when mouse at viewport edge (cursor becomes scroll
  arrow; red no-scroll variant at map bounds). `H` jump to conyard. `S` stop. `G` guard.
  `Esc` → pause menu / cancels modes. `D` deploy MCV. `T` select same type on screen.
  `E` select every armed unit on screen. `Space` jump camera to the newest radar ping
  (preventDefault so the page never scrolls).
- Shift+click a unit icon queues 5 at once; Shift+right-click cancels/refunds the whole
  batch (buildings stay single — placement is one at a time anyway).
- Cursor kinds: `default, scroll(8 dirs), noscroll(8), select, move, nomove, attack, enter,
  capture, harvest, deploy, nodeploy, sell, nosell, repair, norepair, super`.
- Selected entities draw the classic **white corner brackets** + health bar (green >2/3,
  yellow >1/3, red below; buildings get wider bars). Hovering own selectable entity =
  `select` cursor.
- **Touch** (same `Input` module, listeners on the canvas): tap = left-click; one-finger
  drag pans the camera (place mode: moves the ghost; wall ready: draws the run; radar:
  scrubs; build strips: scrolls one row per icon-height); long-press (400ms) then drag =
  box select (touch boxes ADD to the selection; tapping a unit inside a multi-selection
  drops it); long-press an icon = cancel production; long-press a group chip = assign;
  two-finger tap = right-click; two-finger drag = pan in any mode. Fingers are counted
  via `targetTouches` and tracked by identifier so a thumb resting on the letterbox bars
  never corrupts gestures; touch-owned drag state is flagged on the gesture so hybrid
  mouse+touch devices can't cross-abort each other's drags. Near-miss taps on small
  chrome (Options, REPAIR/SELL, strip arrows, group chips) snap to the control.
  `mouse.inside` stays false during touch so the in-canvas cursor and edge scroll never
  engage (restored afterward on hybrid devices); `preventDefault` on touchstart stops
  synthesized mouse events; `touch-action: none` on the canvas kills browser gestures.
- **Control-group chips** on the tab bar (`C.GROUP_X/W/SPACING/N`, hitTest zone
  `tab-group`): click/tap recalls (twice centers), right-click or touch long-press
  assigns the current selection (empty selection clears). Gold when the group has live
  members, with an `xN` count. Second click on a sole-selected factory = set primary;
  on a sole-selected loaded transport = unload; on the MCV = deploy.
- **Maximize screen on mobile** (`main.js` `_maximizeScreen`), layered because no single
  mechanism works everywhere:
  1. Fullscreen API (standard + `webkit`-prefixed, feature-detected), requested
     synchronously inside the faction-pick tap. On success, `screen.orientation.lock`
     ('landscape') is attempted (best-effort). Desktop (fine pointer) never
     auto-requests.
  2. Minimal-ui scroll shim: under `@media (pointer: coarse)` the document is sized to
     the LARGE viewport (`100vh`) while `#wrap` is `position: fixed` at the dynamic
     viewport (`100dvh`) — so while the browser bar is showing, the page has exactly
     bar-height of scrollable slack. Mobile browsers only collapse the bar on a real
     scroll and the game swallows all canvas touches, so `#swipeHint` (a body-level
     overlay with `touch-action: pan-y`, deliberately outside `#wrap`) lets one swipe
     through. `_barVisible()` = documentElement.scrollHeight − visualViewport.height
     > 8; resize/scroll listeners auto-dismiss the overlay when the bar collapses; a
     skip button suppresses it. Shown after the fullscreen attempt fails (600ms check)
     and from the pause-menu button (labelled `Maximize Screen` where the Fullscreen
     API is absent, e.g. iPhone).
  3. PWA: `manifest.webmanifest` (display `fullscreen`, orientation `landscape`,
     procedurally-generated chrysalite icons incl. a maskable variant) + `sw.js`
     (network-first with cache fallback → installable + offline) + a menu `Install as
     App` button wired to `beforeinstallprompt`, plus `apple-mobile-web-app-capable`/
     `apple-touch-icon` for iOS Add-to-Home-Screen. Installed launches have no browser
     chrome at all.
- **Adaptive width on touch devices** (`core.js` `applyScreenAspect` + `main.js`
  `_fitScreen` + `Render.resize`): `C.SCREEN_W` and every derived x-constant
  (`SIDEBAR_X`, `VIEW_PW/W`, `RADAR_X`, `MM_X`, `STRIP_BX/UX`) are recomputed from the
  visual viewport's aspect (clamped 1.6–2.4, sidebar keeps its 320px on the right, the
  battlefield viewport absorbs the rest), the canvas bitmap is resized to match (which
  resets context state — `Render.resize` re-asserts `imageSmoothingEnabled=false`), and
  the CSS box fills the screen exactly. Every consumer reads `C.*` live so the whole UI
  re-flows; re-run on visualViewport/window resize, orientationchange and
  fullscreenchange. Fine-pointer devices keep the fixed 1600×1000 layout untouched.

### AI opponent (`ai.js`)
- Skirmish AI. Starts with deployed base (see map/main setup) + same credits as player.
  Personality by side (UDC: tanks+AGT; Serpent: turrets/spire+buggy/ltnk/arty swarm).
- Loop (~every 30 ticks): strict-priority build goals: power ahead of drain → proc →
  barracks/hand → weap/afld → proc #2 → hq → defenses (want grows with wave count AND the
  game clock, up to 9, arced toward the player; only the first 4 block tech) → tech
  (eye/tmpl, after 4 defenses stand and `g.tick > 6000`) → remaining defenses → fix/hpad →
  proc #3-4 late → silos when storage is tight → superweapon on player's densest cluster.
  The first goal blocked only by credits becomes the SAVINGS TARGET (`S.savingFor`):
  new unit starts pause (harvesters exempt, and never below a 9-strong army floor) so
  the treasury can climb; each goal's bar is capped at `p.storage - 200` so a
  one-refinery economy can't deadlock below its own storage ceiling.
- Placement (`_findSpot`) keeps a 1-cell clear ring around every own refinery — checked
  in both directions (buildings near an existing proc, and a new proc near existing
  buildings) so harvesters can always dock and the economy never gets walled in.
- Harvester fleet scales with refineries (`min(6, procs*2+1)`), replaced eagerly.
- Military: continuous production alternating infantry/vehicles from DATA list weighted by
  personality; group attackers; first wave at ~3-4 min, then every ~2.5-3.5 min send
  everything idle at the player's base. Each wave picks an APPROACH BEARING (rotations of
  the direct line, `APPROACHES` = 0/±0.55/±1.1/±1.7 rad; early waves near-frontal, the
  repertoire widening with the wave count) and runs TWO-PHASE staging: gather 13-18 cells
  from the player's base on that bearing (leash 600 ticks), then advance AS A GROUP to a
  forward point 7-11 cells out, then strike together (60% closed up or +380 ticks) — no
  dribbling in. The strike is an ATTACK-MOVE sweep onto the target cell, so the wave
  fights through whatever it meets instead of tunnel-visioning one building while
  turrets shoot it in the back.
  Defend: units near base intercept intruders. If AI has no conyard but has money+weap →
  build mcv? (skip — too fancy; just keep fighting).
- AI places buildings on a spiral search around its conyard obeying `Production.canPlace`.
- AI ignores shroud, does not cheat resources (its harvesters really harvest), except: if
  fully broke (<100 credits) for 60s straight and no harvester, gets a 2000 credit "bailout"
  — but ONLY while it can still restore an income: a conyard (rebuilds anything), or
  refinery + vehicle factory both standing (`Production.prereqOk('harv')`, so the money
  can buy a harvester). A beaten AI with neither sits on its stumps instead of respawning
  money forever (endgame drag fix).
- If a ready building has no legal spot, the AI cancels it AND cooldowns that key for
  ~100s (`S.noSpot`); `_nextBuilding` skips cooled-down keys so the goals below still run
  (no build→cancel livelock freezing base development on cramped maps).
- Skirmish difficulty presets (Operations menu → SKIRMISH EASY/NORMAL/HARD) ride the same
  knobs campaign missions use, as a pseudo-mission on `game.mission` (no `n`, no
  `objective`): EASY `{aiCalm:1.7, aiWaveCap:6, aiCredits:3500}`, NORMAL null, HARD
  `{aiCalm:0.65, aiCredits:9000}`. `startGame` applies `aiCredits` to the AI treasury;
  restart preserves the preset; no unlock writes for skirmish (guard on `mission.n`).

### Audio (`audio.js`) — all synthesized, no samples
- WebAudio: build each SFX from oscillators/noise buffers with quick envelopes. Names used
  by other files: `click, buzz, tick, place, sell, repair, crush, mgun, pistol, cannon,
  rocket, flame, laser, obeliskCharge, expS, expL, nukeSiren, nukeBoom, ionHum, ionBlast,
  squish, harvest, radarOn, radarOff, ready, cashUp` — `AUDIO.play(name)` (missing name =
  silent no-op). Keep volumes balanced (master gain ~0.35). `AUDIO.tickCredits()` = rapid
  tick used by the credits counter.
- `AUDIO.eva(key)`: announces `DATA.eva[key]`. **No browser TTS** — the voice is
  synthesized by `voxTransmission` (two detuned sawtooths → three parallel bandpass
  formants that step between vowel shapes per syllable → per-syllable amplitude gate →
  radio band-limit), bracketed by radio-static blips, queued so lines never overlap. It
  does not pronounce words; it reads as an in-universe comms computer. The literal text is
  always surfaced by `EV.emit('eva', text)` → render.js draws a fading HUD banner, so the
  message survives even with voice or all audio off. Gated by `voiceEnabled`.
- `AUDIO.ack(kind, cls)`: order feedback. Non-'select' always leads with a radio `squelch`;
  then (always for 'select', ~45% otherwise) a short `voxAck` chatter blip — a 1-2 syllable
  transmission pitched by unit class (inf high, veh low). Suppressed while an EVA line is
  playing, throttled to ~1/second, gated by `voiceEnabled`.
- `AUDIO.setVoiceEnabled(bool)` / `AUDIO.voiceEnabled`: the comms voice toggles separately
  from `setEnabled` (all SFX) and `MUSIC` — pause-menu "Voice" button, persisted in
  localStorage. All three are independent.
- `AUDIO.init()` must be called from a user gesture (menu click) to unlock the context.

### Art direction (sprites_*.js) — original pixel art, mid-90s RTS look
- All sprites drawn programmatically on offscreen canvases at 1× with integer `fillRect`
  pixels; NO anti-aliasing, no gradients except tiny dithers; dark outline (#111-ish) around
  readable silhouettes; light source top-left; palettes from `PAL` in core.js.
- Team colors: UDC = desert gold/tan (`PAL.gdi*`), Serpent Order = steel grey with red accents
  (`PAL.nod*`). Same shapes, different palette per `side`.
- Vehicles: 24×24 canonical facing NORTH, then `rotFrames(c, 16)` (core helper) for 16
  facings; turreted vehicles (ltnk, mtnk, htnk, gun turret) supply separate `body` and
  `turret` frame arrays (turret drawn centered over body). Tracks/wheels visibly darker;
  htnk (behemoth) is bulkier, double barrels; harv has a scoop + tumbling intake anim frames
  (2); mcv has a big crane box. Aircraft 24×24 with rotor anim frames (2, drawn as spinning
  blur bar) — orca is a tan VTOL with stub wings, heli a grey attack chopper.
- Infantry: 24×24 canvas, figure ~10-12px tall centered-bottom, 8 facings × {stand:1,
  walk:4, fire:2} frames + shared `die:4` frames (crumple). Tiny but readable: helmet dot,
  gun stick 2px in facing dir. e1 gold/grey uniform, e2 with backpack, e3 tube on shoulder,
  e4 orange tanks (flamer), e5 green suit, e6 white hardhat+toolbox, rmbo dark+headband.
- Buildings: footprint w,h from DATA × 24px, plus draw a 1-cell-high concrete **bib** strip
  along the bottom (inside the canvas, part of the sprite; sprite canvas height =
  (h)*24 + 8 bib overhang is fine as long as anchored to footprint top-left). 2 anim
  frames for idle life (blinking lights, radar dish rotation on hq (draw 4 rotation
  frames), power plant steam) + `damaged` variant (cracks, smoke stains) used below 50% hp.
  Distinct recognizable shapes per the original: fact = big crane pad; nuke = cooling
  towers; proc = tank + dock arm; pyle/hand = barracks huts; weap = big garage door; afld =
  runway strip (4×2); silo = twin domes; hq = dish; eye = big golf-ball dome; tmpl = black
  pyramid with red trim; gtwr = sandbag tower; atwr = tall twin-rocket tower; gun/obli:
  base drawn in building sprite, obelisk = black spike (glows when charging); sam = domed
  launcher with open/close anim (3 frames); hpad = square pad with H; fix = ring platform.
- Cameos (`SPRITES.cameo[key]`, 64×48): mini portrait of the thing on dark slate bg with
  faction-color bottom stripe and 1px black frame — stylized, chunky, readable. Also
  `SPRITES.cameo.ion` (satellite dish + beam) and `SPRITES.cameo.nuke` (missile).
- Terrain (`SPRITES.terrain[id] = [variants...]` 24×24): grass = mottled olive greens; dirt
  = tan; rock = grey boulders on dirt; water = blue with light ripple dither (2 anim
  variants OK); tree = dark green canopy w/ shadow on grass base; blossom = white-pink
  canopy pod. These tiles are the FALLBACK path only — the shipped ground comes from
  `terrain_paint.js` (below). `SPRITES.chrysalite = [3 densities][3 variants]` — clusters of
  bright green crystals (PAL.tib*), density by cell value thirds, variant picked per cell by
  position hash (render also jitters the draw a few px to break the cell grid).

### Terrain painting (`terrain_paint.js`, global `TERRAINPAINT`)
- `TERRAINPAINT.build(game) -> { canvas, anim }` — called by render when the terrain cache
  is (re)built. Paints the whole map per-pixel at 24 px/cell in world space: bilinear-sampled
  per-cell material fields (dirt/water/rock) + value-noise mottle and edge-raggedness fields
  + per-pixel grain dithering, so ground types flow across cell borders with organic edges
  (no tile seams). Water gets depth bands, foam and a wet-sand shore; rock cells get varied
  boulder formations; tree cells get overlapping canopies (deciduous + conifer) over a
  darkened forest floor; open land gets sparse doodads (tufts, flowers, pebbles, cracks,
  bushes). The painting is nearest-upscaled ×2 into the screen-scale cache.
- `anim` = `[{cx, cy, frames:[canvas...], phase}]`: transparent overlays render redraws live
  (blossom pods, open-water glints). Frames are world-scale (drawn ×C.ZOOM).
- Deterministic from `game.seed` only (hash/value-noise, no `game.rng`, no `Math.random`);
  never mutates game state. Budget ~400ms, once per new map.
- FX (`SPRITES.fx`): `expS` (6 frames, 24px fireball→smoke), `expL` (8 frames, 48px),
  `muzzle` (2 fr), `tracer` (drawn by render as line, no sprite needed), `smoke` (4 fr grey
  puffs), `flame` (3 fr), `scorch` (static dark splat), `ionBeam` (drawn procedurally in
  render OK), `nukeCloud` (6 fr, 64px mushroom), `crater` (static), `plane` (cargo plane
  48×24, 1 fr, for airstrip deliveries), `wrench` (12px), `flagReady`? (skip), `dock` arcs.
- `SPRITES.cursor[kind]` 16-24px each, hotspot center except `default` (tip at top-left)
  and `scroll*` (edge). `SPRITES.logo.gdi/nod` ~120×90 emblems for radar-idle and menu.
- `SPRITES.shroudEdge`: 8 directional 24×24 jagged black-edge tiles (N,NE,E,...) with
  alpha.

### Map generation (`map.js`)
- 64×64. Deterministic from seed via `mulberry` (features additionally use seeded hash
  noise — NEVER `Math.random`/`game.rng`). Geography grows from a hidden ELEVATION field
  (`buildElevation`: 4-octave fbm + a gentle climb toward the rim) that every feature
  reads, so the landscape is internally consistent:
  - the west→east river FOLLOWS THE VALLEY (per column, step ±1 to the lowest-elevation
    cell ahead; base plateaus repel the channel so the start-safety guard never censors
    it into visible gaps), widens downstream, keeps two fords — one pinned where it
    crosses the start↔start segment — and most seeds get a timber bridge;
  - rock crowns the ~93rd elevation percentile, broken by detail noise into ridge lines
    with saddles; grass at the foot of rock weathers to talus dirt; high, dry (far from
    water) flats bake to dirt regions;
  - woods follow moisture (BFS distance-to-water): dense gallery forest on the banks,
    groves in the lowlands gated by a broad meadow mask (no mega-forests), sparse stands
    up high; tree clumps + lone trees for texture; ford mouths and bridge ends are
    deliberately felled clear (`clearTrees`);
  - ponds pool at genuine local elevation minima but never within 7 cells of a ford or
    the bridge (depressions cluster on the valley floor — an unguarded pond would fuse
    onto the river and seal the crossing); mid-map chrysalite fields pick the
    lowest-lying valid spot (crystal collects in valleys); worn dirt roads run from the
    village to the river crossing and toward the nearest base (`road`, grass-only brush).
  A ragged 1-3 cell rocky rim rings the map (never blocking the two base areas or the
  corridor between them; BFS connectivity check widens the corridor as a last resort).
- Two start zones: player SW-ish (around 12,50), AI NE-ish (around 52,12) — keep a 12-cell
  radius buildable (grass/dirt only). 4-5 chrysalite fields: one near each base (~120 cells
  rich), 2-3 mid-map, each with a blossom tree at heart. Fill `game.tib` values 75..300
  denser at field center.
- Also sets `game.startPos = {human:{cx,cy}, ai:{cx,cy}}`.

### Setup (main.js `startGame(side)`)
- `makeGame`, `MAPGEN.generate`, Fog.init; human: **MCV + 1 jeep/bggy + 3 e1** near start,
  5000 credits. AI: pre-deployed `fact` + `nuke` + same escort at its start, 5000 credits,
  AI.init. Camera centered on human start. EVA plays faction intro? Just `AUDIO.eva('battleControlOnline')` ("Battle control online").
- Main loop: accumulator fixed-step `C.TPS * game.speed`; per tick: `Input.tick` →
  `Production.tick(each player)` → `Sim.tick` → `AI.tick` → `Fog.update`; render every RAF
  with `Render.frame`. Pause when menu open (`game.paused`).
- Menu DOM (#menu overlays in index.html): title screen with the two faction emblems
  (canvas-drawn logos injected), faction buttons UDC / Serpent Order → Operations
  (three SKIRMISH difficulty rows, then the five campaign ops) → Briefing → game; pause
  menu (Resume, Sound/Music/Voice toggles, Fullscreen, Speed slider 0.5–2.2 defaulting
  to 1.7, Restart mission, Abort mission); score screen. Esc toggles.
- Win check per rules; on end: `Main.endGame(won)` shows score screen; sound
  `missionAccomplished`/`missionFailed` EVA.

## Testing hooks (must implement)

- `main.js` exposes `window.game` (live game object) and `Main.startGame` so a headless
  browser can boot straight into a game: `Main.startGame('gdi', {seed: 42})`.
- Add URL params: `?side=gdi&seed=42&nomenu=1&mission=N` (and `mpbc=name&mphost=1`
  for two-tab multiplayer over BroadcastChannel) → boot directly into game (skip menu),
  `&mute=1` → `AUDIO.setEnabled(false)`.
- Every module must be defensive at boot: no top-level code that throws if DOM absent
  except main.js boot listener.

## Non-goals

FMV, naval, mid-mission save/load, multiplayer beyond 1v1. Keep the door open but do not
build. (Campaign missions, 1v1 multiplayer, walls, veterancy, and difficulty levels have
since graduated out of this list and are specified above.)
