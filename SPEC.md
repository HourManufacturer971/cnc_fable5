# Harvest War — Engineering Spec

An original real-time strategy game in the mid-90s mold, built from scratch with
**original code and original procedurally-generated pixel art / synthesized audio**.
Inspired by the classic RTS genre; contains no assets, names, or code from any other game.

## Tech constraints

- Plain ES2020 JavaScript, **no modules, no build step, no dependencies**. Every file is a
  classic `<script>` that defines the global symbols listed for it below and nothing else.
- Internal resolution **640×400** (period-correct low resolution), rendered on one `<canvas>`
  scaled up with `image-rendering: pixelated`.
- **Device-resolution backing store** (`Render.resize`): the canvas bitmap matches the CSS
  box × `devicePixelRatio` (capped at 2× logical), with a `setTransform(dscale)` baked in so
  every draw call stays in logical `C.SCREEN` coordinates. Text and HUD hairlines rasterize
  at native resolution (no browser resampling = no fuzzy text at non-integer window scales);
  sprites still blit nearest-neighbour through the transform, keeping hard pixel edges.
  Caveat that follows: at fractional device scales, ABUTTING per-cell fills antialias
  into hairline seams — the black shroud therefore fills whole horizontal runs of
  shrouded cells with a half-pixel bleed instead of per-cell rects (a visible grid in
  the dark otherwise).
  Re-fits on window `resize` and after `_fitScreen` sets the CSS box (main.js). Input is
  unaffected — the mouse maps through `getBoundingClientRect` ratios to logical coords.
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
    heater shield on navy — rank pips over a chief divider, slim flat chevron / Serpent
    Order angular stencil-serpent in a segmented ring on black — straight mitred
    segments, kite head, slit eye; both flat-shaded, no gleam pixels) until player owns a powered
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
| music.js | `MUSIC` (`start(side), stop, setEnabled, enabled` — original procedural soundtrack, twelve tracks in faction playlists: Coalition T1–T8, Serpent Order S1–S4 ritual tracks; the session's first battle opens on the faction theme, later starts re-roll; rotates after two loops) |
| missions.js | `MISSIONS` (campaign definitions: seed, credits, AI knobs, objective, per-side briefings), `MissionProgress` (localStorage `hw_progress` unlock tracking) |
| map.js | `MAPGEN` (`generate(game, seed, opts?)` — `opts.holdout` centers the human start inside a three-gated rock fortress ring (gate mouths stashed on `g.decor.gates`); the plateau interior is scrubbed after field placement to ONE finite pocket hugging the wall away from the enemy — no other crystal, no blossom trees, bare gate mouths — so the base is buildable and the passes defensible; the midfield fallback goes to the hs/as midpoint, never the map center (which IS the fortress). `opts.shore` floods the southern edge with a rolling 3-7 row sea under a two-row bare-sand beach (own rng stream, carved after fields so nothing recolonizes the waterline; home/mid fields are held above it, and the waterfall scan stops short of the sea). Bridges get short worn dirt-road approaches stamped off both ends) |
| path.js | `findPath(unit, destCx, destCy, opts?) -> [{cx,cy},...]` |
| fog.js | `Fog` (`init, revealCircle, update, isExplored`) |
| sim.js | `Sim` (`tick`), `orderMove`, `orderAttack`, `orderHarvest`, `orderDeploy`, `orderEnter`, `orderBoard`, `unloadCargo`, `stopUnit`, `killEntity`, `fireIon`, `fireNuke`, `spawnEffect`, `spawnBullet` |
| production.js | `Production` (`tick, tryStart, toggleHold, cancel, items, canPlace, place, sell, toggleRepair, computePower, categoryOf, prereqOk, superReady, launchSuper, setPrimary`) |
| ai.js | `AI` (`init, tick, _peek` — `_peek` is a read-only debug/test hook) |
| input.js | `Input` (`init, tick, mouse, cursorKind, mode, modeArg`) |
| render.js | `Render` (`init, frame, resize, worldFromScreen, hitTest, cycleView, radarOn, viewPlayer`) |
| net.js | `NET` (P2P lockstep: `host, acceptAnswer, join, testLocal, close, pump, ready, applyTick, postTick, stalledMs, initExplored, checksum, execReplay, requestRematch`, flags `active/applying/inSim/side/desynced/PROTO/rematchOffered`, `onRematch` callback) |
| replay.js | `REPLAY` (`arm, logCmd, finish, hasLast, exportLast, exportLive, resumeData, watchLast, watchData, applyPending, stop`, flags `recording/playing` — see "Replays") |
| main.js | `Main` (`boot, startGame, startReplay, endGame`), starts loop, menu DOM wiring |

## Game state (created by `makeGame` in core.js — read it)

Key fields: `tick, seed, rng, terrain (Uint8Array), tvar (Uint8Array), tib (Uint16Array),
occ (Int32Array unit/building id per cell or 0), units (Map id→unit),
buildings (Map id→building), bullets [], effects [], players {udc, srp}, human, ai,
humanSide, camera {x,y}, selection [id...], groups {1..9: [ids]}, shroud (Uint8Array),
status ('playing'|'won'|'lost'), speed (tick multiplier 1), stats {kills, losses,
buildingsKilled, buildingsLost, harvested}, evaCooldowns {}`.

Player fields (`makePlayer`): `side ('udc'|'srp'), isAI, credits, storage (recomputed),
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

`0 grass, 1 dirt, 2 rock (impassable), 3 water (impassable), 4 tree (impassable,
DESTROYABLE: splash ordnance accumulates in g.treeHp — fire counts double — and at
140 the tree falls, the cell opens to grass and the renderer drops its canopy; EV
'treeDown'), 5 blossom tree (impassable, regrows chrysalite around it, NOT
destroyable), 6 bridge deck (passable,
drawn over water), 7 fallen bridge span (impassable open water; set by
`_bridgeCollapse`, restored to 6 by `_bridgeRepair`), 8 sand, 9 marsh, 10 scrub
(all three passable ground variants — beaches/wetland/dry heath — blended
seamlessly by the painter; vehicles kick up dust on sand like on dirt)`.
`game.tvar` picks sprite variants.
Chrysalite lives in `game.tib` (0..C.TIB_MAX per cell) independent of terrain (only on 0/1).
MAPGEN also fills `game.decor = { bridges, waterfall, village }`: an array of bridge
infos (`{ cells, rect, water, under, huts }` — up to two per river), the
waterfall cell, and the neutral hamlet layout that main.js spawns as 'civ'-owned
buildings/units (players include a `civ` stub owner nobody auto-targets). The hamlet is
farmhouse + chapel (`chur`) + two cottages + barn; the chapel drops a guaranteed cash
crate when destroyed (see Crates). Skirmish maps also place two neutral SUPPLY DEPOTS
(`depo`) on contested ground (near crossings/midfield, ≥18 cells from both starts) —
engineer-capturable; a held depot pays its owner 60 credits every 150 ticks
(`_tickDepots`, found money like crates: ignores the silo cap; cash popup humanSide-only).
GARRISONS: armed non-engineer infantry `orderEnter` a DATA `garrison`-capable civ (or own,
with room) building: the structure transfers to the occupier (`_transferBuilding` — the
same helper engineer capture uses; ownership gives radar color + fog sight), occupants
leave the map into `b.garrison[]` with their position synced to the building's heart, and
`_tickGarrisonFire` fights with each occupant's own weapon (+1 range, per-occupant
cooldowns, veterancy intact, occupant is the _fireWeapon shooter so kills credit).
Second-click/`U` unloads (generic `unloadCargo`, net op `unl` resolves buildings too) and
an EMPTIED structure reverts to 'civ'; a destroyed one kills its garrison (transport
rule). Render marks occupied buildings with owner-colored dots. All sim-state reads —
lockstep-safe; `orderEnter`/`unl` were already net commands.

## Core game rules (be faithful to the 1995 original)

### Economy
- Harvester: capacity `C.HARV_CAP = 700` credits (28 "bails" of 25). Harvest one bail per
  ~10 ticks from the current cell (`game.tib` -= 25), auto-move across the field, when full
  (or field exhausted and >0 load) drive to own refinery dock cell (the cell just south of
  the refinery's middle column), unload over ~60 ticks adding credits gradually
  (respect storage cap; excess is lost + EVA `silosNeeded` and a red `-N` popup when ≥50
  evaporates), then return to last field.
  Idle harvesters auto-seek visible chrysalite. New refinery spawns a free harvester beside it.
- **Blue chrysalite** (`g.tibType`, Uint8Array; 0 green / 1 blue): the first (most central)
  midfield spawns blue. Physically identical to green — same density, capacity and growth
  hooks — but each scoop banks `take × 2` into `u.tibVal`; at unload the load converts to
  its VALUE (`u.tib = max(u.tib, u.tibVal)`) so a full blue load pays 1400. A mined-out
  blue cell resets `tibType = 0` (regrowth is green). Render: `SPRITES.tiberiumBlue`
  (boot-time green→blue remap), blue bloom stamp, `#3c8ce0` minimap tint. Silos render a
  live sight-glass gauge of `credits/storage` (render-only, in `_drawBuilding`).
- Harvester field discipline: target cells are LEASHED to ~20 cells of the home dock while
  local crystal lasts; when the neighborhood is dry an EMPTY harvester treks unleashed to
  whatever is left on the map (never idles the economy to death). A PARTIALLY loaded one
  tops off around where it STANDS first (unanchored, ~16 cells — wide enough to walk a
  whole field pocket), falling back to the leashed home-side search only if its own
  surroundings are bare — so a far field is eaten until the hopper is FULL, never one
  cell per round trip. (Order matters: the home leash rejects every cell of a distant
  field, so leash-first sent far trekkers home half-empty — the harvtest covers this.)
  Known-unreachable cells are blacklisted
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
  expire after 3 min). Any udc/srp ground unit entering the cell consumes it (checked every
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
  of factory). Aircraft prefer the PRIMARY helipad when it is unclaimed, then any free
  pad. The human player's primary factory of each kind wears a gold PRIMARY tag
  (render-only, `_drawBuilding`); set with `P` or by clicking the selected factory again.
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
  (sim.js, every tick, sides in fixed udc→srp order) heals ONE own ground vehicle per
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
- **Crushing**: `crush: true` vehicles (all tanks + APC) kill enemy infantry by
  entering their cell (`_stepAlongPath` squish + SFX; `isPassable` admits the entry).
  The A* also PREFERS the straight line through them: cells held by enemy infantry
  cost a crusher +4 instead of the +80 soft-unit penalty, so ordering armor through
  a picket line runs it over instead of politely detouring (civilians keep the full
  penalty — only a deliberate order harms them).
- Units auto-acquire: idle combat units scan every 8 ticks for nearest enemy within
  `sight+1` cells and attack (harvester/mcv/apc/engineer never auto-attack; they FLEE:
  harvester heads to refinery when hit). Attackers chase up to ~4 cells past their
  guardAnchor then return.
- **Civilians** carry `civgun` (4 dmg, range 3, slow rof) but are excluded from
  `_autoAcquire` — they NEVER start fights and nobody auto-guns them. The 'damaged'
  handler makes a shot villager return fire on a reachable attacker (guardAnchor leash
  keeps them home); unreachable attackers (aircraft) still trigger the old panic-flee.
- **Wall runs**: dragging with a wall ready sweeps a run (`Input._wallCells`, ≤13 cells,
  wire format stays an explicit cell list). Angled drags rasterize as an orthogonal
  STAIRCASE — every cell shares an edge with the next, so the 16-frame auto-connect
  sprites always join and units can't slip between corner-touching posts. Hand-placed
  segments with a wall on a DIAGONAL only (no shared orthogonal neighbor to route
  through) draw one of 4 corner-stub sprites (`SPRITES.wallStub`, under the frame) so
  odd angles still read as a connected line.
- **Wall Gate** (`gate: true` in DATA.buildings; wall family, $250, instant place, one
  per click): a 3-CELL gatehouse. Placement centers on the clicked cell; orientation
  follows the wall run around it (`Production.gateOrient/gateFootprint` — walls N/S ⇒
  vertical) and the instance gets `b.w/b.h` of 3×1 or 1×3 (DATA stays 1×1; footprint and
  occ come from the instance). It may be placed ON TOP of the player's own plain wall
  segments — `canPlaceGate` accepts them and `_placeGate` removes them before the gate
  lands (`placeWallLine` routes gate placement, so MP/replay commands stay `(type,cx,cy)`
  and both clients derive the same orientation from sim state). Passable ONLY to the
  owner's ground units, on all three cells: `isPassable` allows owner+finished; A*
  `cellState` returns a near-free GATE state (+15 step); `_stepAlongPath` transits WITHOUT
  claiming occ — the gate keeps its own occ id, so enemy pathing never sees a hole.
  Render picks closed/open × horizontal/vertical frames from the instance footprint
  (opens when an owner ground unit is within 1.5 cells — cosmetic only, with a servo
  clunk SFX on state changes near the camera, tracked render-locally in `_gateWas`).
  **Art rule — the passage stays clear**: all three cells are traversable, so the
  structure lives at the span's outer BOUNDARY edges only — two slim curtain housings
  (the vertical gate's north housing sits entirely in the sprite's rise rows, its south
  one is a thin threshold the adjoining wall post overlaps) with red/green status lamps.
  The cells themselves carry only flat paving (curbs + lane ticks along the traffic
  direction). Closed = a hazard-striped curtain stretched between the housings; open =
  the curtain fully retracted (yellow tips peeking out), leaving three visually
  unobstructed squares so units never clip gate artwork while driving through. Walls
  auto-connect into the housings; the placement ghost previews the oriented span.
- **Attack-move** (`orderAttackMove(u, cx, cy)`, state `amove`, `u._amove={cx,cy}`): sweep
  toward the cell, auto-acquiring every 8 ticks; acquisition sets `targetId`/`state='attack'`
  DIRECTLY (not via orderAttack) so `_amove` survives, and when the target dies the unit
  re-issues the sweep to the stored destination. Any explicit player order (move/attack/
  stop) clears `_amove`. Non-combat and air units delegate to plain move. Networked as the
  `amv` command.
- **Veterancy**: udc/srp units track `u.kills` (credited in `killEntity` to a living
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
  1 explored. Reveal circles of `sight` radius around human units/buildings each few ticks;
  `game.visible` is the LIVE line-of-sight mask, recomputed by Fog every 5 ticks.
  AI sees everything. Hidden cells: draw black; cells adjacent to hidden get jagged dark
  edge overlay (`SPRITES.shroudEdge`).
- **Units follow the classic shroud rule** (`_unitSeen`, render-only): anything standing
  on EXPLORED ground draws in the viewport (an experiment with live-LOS-only unit
  visibility was reverted — it fought the permanent-reveal shroud). The minimap still
  gates enemy BLIPS on live line-of-sight. The replay spectator (`seeAll`) bypasses all.
- **Endgame reveal** (`revealAll`, recomputed per frame, SP only — never when `NET.active`):
  once the AI owns zero non-wall buildings, its surviving units draw everywhere and show
  on radar — complements hunt mode; no shroud-crawl for the last stragglers.
- Radar: three layers — the painted terrain
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
  returns to zero), `capture {btype}` (win the moment a building of that type flies the
  human's colors — an engineer walks in; btype may be a per-side map `{udc, srp}`; if
  every standing copy dies first — armed via `g._capArmed` — the mission FAILS), and
  `escort {unit, dest, radius}` (win when the human's unit of that type stands within
  `radius` cells of dest — `dest: 'ai'` resolves to `g.startPos.ai`; the unit dying
  loses instantly). Winning unlocks the next mission (`MissionProgress.unlockUpTo`).
- **Mission event engine** (`MISSIONS.tick(g)`, called from the main loop inside the
  deterministic step, SP only — skirmish and MP no-op): missions carry `events`, each
  with ONE trigger — `at: seconds`, `every: seconds [,from][,until]`, or
  `when: g=>bool [,repeat]` (rising edge) — and any mix of actions: `eva` (radio line
  via `AUDIO.evaText`, side-keyed strings allowed), `reinforce {types[,at]}` (friendly
  column spawns at the map edge and rolls to base — gathering LANDWARD of the
  base on shore maps, since the usual south-side rally would be in the surf;
  spawn spots (`_openNear`) prefer crystal-free cells everywhere, so landings
  and columns never materialize inside a chrysalite field; types side-keyed
  vs HUMAN side),
  `attack {types[,from][,target:'base'|'harv']}` (raid spawns at a compass edge and
  attack-moves in; types keyed vs AI side; arrays of specs allowed), `crates: n`
  (supply drop on the base perimeter), `creatures: n` (fleshlings in the fields),
  `credits: n`, `fn(g)`. Per-event runtime state in `g._mEv`; every action is a pure
  function of tick + sim state + `game.rng`, so REPLAYS re-run the script identically
  (covered by mtest3's record→playback checksum with a scripted raid inside).
- **Mission setup hooks**: `mission.noHumanSpawn` skips the default MCV+escort;
  `mission.setup(g, {hs, as, side, aiSide})` runs after standard spawns (stage
  dressing: pre-built enemy works, convoys, checkpoints). Helpers exported on the
  MISSIONS array: `MISSIONS.placeB(g, side, type, cx, cy)` (spiral-search finished
  building placement), `MISSIONS.squad(g, side, types, at)`, `MISSIONS.openNear`.
- **Per-mission tech gates**: `mission.allow` is a whitelist of building/unit
  keys — `Production.prereqOk` checks it FIRST (`_missionAllows`), so the
  sidebar, `tryStart` and the AI all obey it for EVERY player in the mission
  (list both factions' keys). `allow: []` locks production entirely (the squad
  missions). ai.js `_nextBuilding` guards every goal with `prereqOk` so a gated
  key can never wedge the build queue, and `_pickUnit` filters its weighted mix
  the same way. `mission.aiNoSell` pins scripted garrisons in place: the
  bankruptcy liquidation/final-rush block is skipped, so a fixed-purse camp
  goes quiet when the money runs out instead of selling itself and rushing.
  `_pickSale`/`_finalRush` also never sell the mission's demolish/capture
  objective building (`_saleForbidden`) — a fire sale must not end a mission.
  `mission.aiCredits: 0` is honored (checked `!== undefined`, not truthiness).
- The campaign is TWO SEPARATE FACTION ARCS of ten ops each (`MISSIONS.udc` /
  `MISSIONS.srp`, fetched via `MISSIONS.arc(side)`) — classic structure, original
  fiction. Mission defs are single-faction now (`brief` is a paragraph array,
  `objText` a string) and carry `terr: [x,y]` territory coords for the THEATER
  OF WAR screen (main.js `_drawTheater`): a procedurally drawn original country
  at war — the silhouette is built from layered coastal lobes (two broad
  sinusoidal lobes + headlands + coves) so it reads as peninsulas and bays,
  not a blob; every mission territory of BOTH arcs then pushes its coastal
  spokes out (`need = hypot + 0.12` margin over ±2 spokes) so all 20 ops stand
  on dry land — the corner ops' `terr` were also nudged inboard; 2-3 offshore
  islets sit in the sea. Sea with wave dashes and a coastal shelf around the
  Path2D coastline,
  rivers running to the coast, mountain chains, forest stipple, and eight
  towns with ORIGINAL names (VELMOR, KARSA POINT, OSTHOLM, …) threaded by
  dashed supply roads; the war state reads at a glance: home ground behind the
  front is tinted + hatched in the faction color and a bold toothed FRONT LINE
  (teeth toward the enemy) crosses the country at the frontier between the
  last secured op and the next, which is tagged NEXT OP (clickable →
  briefing); the map IS the whole mission select — there is no per-op button
  ledger. Node hit zones scale with the on-screen canvas size (finger-sized on
  phones), the hover caption carries state + the personal best ('OP 2: … —
  COMPLETE · BEST 12:34 · 3120'), the record also rides the briefing's sector
  line ('… · PERSONAL BEST mm:ss · score'), and a compact button row beneath
  the map holds Skirmish — Battle Setup (`#btnSkirmish` → the skirmish window)
  and Back; a phone media query shrinks padding and caps the map height so the
  whole panel fits a landscape phone unscrolled. The briefing
  tactical survey (`_drawBriefMap`) wears FACTION colors: a Serpent commander
  is RED and the Coalition enemy GOLD, never the seat-based inverse. `MissionProgress` is per faction (`hw_progress_udc/srp`,
  `get/unlockUpTo/unlocked` take a side) and records live at
  `hw_rec_<side>_<n>`. New objective type `demolish {btype}` (arms while a
  building of the type stands anywhere, wins when the last is rubble — capture
  doesn't count) powers the new archetypes: the no-base COMMANDO RAIDS (UDC 4
  BROKEN SPEAR / Serpent 4 FANGS IN THE DARK — `noHumanSpawn` + a
  rmbo/fire-team/apc squad against a pre-built, garrisoned enemy `hq`) and the
  SABOTAGE ops (UDC 7 SILENCE THE TEMPLE / Serpent 7 BLIND THE LANCE — a full
  base game against a pre-built charging enemy superweapon). Replay meta now
  carries `p: NET.PROTO` from `REPLAY.arm` and `watchData` refuses other
  versions. UDC arc: 1 FIRST FOOTHOLD (STAGED LANDING — `shore: true` puts a
  real sea and landing beach on the southern map edge; `noHumanSpawn` rifle
  team ashore ON the sand at tick 0, second boat at 45s, the MCV by scripted
  reinforcement at 75s, both with `at: 'south'` so they come in over the surf;
  restricted `allow` tech tree of power/refinery/silo/barracks/infantry;
  the enemy is a hand-placed camp — power, barracks, one gun, `aiNoSell`, a
  2500-credit purse that dribbles riflemen until it runs dry), 2 THE GREEN ENGINE
  (harvest 6000 + blue-lode reveal + harvester-hunting raids), 3 STATIC LINE
  (survive 15, holdout: announced directional waves, supply drops, relief
  vanguard, final assault), 4 BROKEN SPEAR (commando raid, demolish hq),
  5 SCORCHED HARVEST (killEconomy + fleshling migrations + revenge waves),
  6 THE LONG ROAD (escort: no base, convoy + checkpoints, AI camp stripped,
  pulsing beacon at `g.startPos.ai`), 7 SILENCE THE TEMPLE (sabotage, demolish
  tmpl), 8 INSIDE JOB (capture the tmpl INTACT, prize pre-built + revealed,
  damage warnings, engineer detachment), 9 SEVERED HEAD (annihilate stronghold),
  10 AVALANCHE (annihilate a fully pre-built fortress; reinforcement/supply
  drip). Serpent arc mirrors the shapes with its own story: FIRST SERMON
  (the classic NO-BASE SQUAD OP — `allow: []` locks production for both seats,
  `credits/aiCredits: 0`, setup strips the stock enemy spawn down to a
  hand-built listening post (hq + power + infantry pickets) and hands the
  player a five-strong cell; reinforcement cells at 150s/340s; annihilate),
  TITHES OF THE EARTH, THE SANCTUM HOLDS, FANGS IN THE DARK, STARVE THE
  MACHINE, THE RELIC ROAD, BLIND THE LANCE (demolish eye), CHANGED VOICES
  (capture eye), BREAK THE BASTION, AGE OF THE SERPENT.
- AI difficulty knobs read from `game.mission` by ai.js: `aiCalm` multiplies wave-cadence
  delays (first strike + between waves), `aiWaveCap` caps units per strike wave.
  Campaign ops without an explicit `aiWaveCap` keep the classic 9; open skirmish
  defaults to 11 (`_waveCap`) so late strikes mass like offensives.
- Render draws a small objective status chip at the top-left of the viewport
  (`TREASURY n / m`, `HOLD OUT mm:ss`, `ECONOMY TARGETS LEFT: n`, `CAPTURE THE X —
  INTACT`, `DESTROY THE X — n STANDING`, `DELIVER THE TRANSPORT — n CELLS TO THE
  BEACON`, or the annihilate line);
  skirmish shows none. Escort missions also draw a pulsing gold beacon at the goal
  (over the shroud — mission intel outranks fog) and a blinking radar marker.

### Multiplayer (net.js — deterministic lockstep, P2P)
- 1v1 over a WebRTC data channel with MANUAL signaling: host and guest exchange
  two short codes by hand (any chat) — no server, no accounts; the only outside
  service is a public STUN server for NAT discovery (LAN/same-machine works
  without it). A `BroadcastChannel` transport (`?mpbc=name&mphost=1&side=`)
  drives two-tab play on one machine and the automated tests.
- **Short codes** (~350 chars, was ~2000): `_packSdp` ships only ICE ufrag/pwd,
  DTLS fingerprint (+algo), setup role, mid and the candidate lines; `_unpackSdp`
  rebuilds the standard datachannel-only SDP from a template on the receiving
  end. The JSON envelope is `deflate-raw`-compressed (`CompressionStream`) and
  base64url'd with an `HW2.` prefix (`HW1.` = uncompressed fallback for browsers
  without the API; legacy full-SDP base64 still decodes). `_enc`/`_dec` are
  async. Real-SDP round trip is covered by a two-page Playwright test
  (BroadcastChannel tests bypass SDP entirely).
- Lockstep: both clients run the identical sim from the host's seed; only
  orders travel. Each order is queued locally, broadcast with execution tick
  `now + DELAY` (5 ticks), and applied on BOTH clients at that tick, udc's
  batch before srp's. A client may only advance to tick T once it holds both
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
- MP start is symmetric and canonical: both sides get an MCV + escort; udc
  always takes the map's SW slot, srp the NE one, udc spawns first (identical
  entity ids on both clients). `_uid` resets in `makeGame`. AI.tick is skipped
  (AI.init still runs — a symmetric rng draw). The main loop ticks production
  in fixed side order (udc, srp), never human-first.
- Desync detection: FNV-1a checksum of (tick, unit id/x/y/hp/load, building
  id/hp/progress, credits, super timers) exchanged every 128 ticks; mismatch →
  both clients show "DESYNC DETECTED", `game.status = 'desync'`, link closed.
  Disconnect / Abort mid-game forfeits: the remaining player wins.
- **Rematch**: `endGame` deliberately leaves the channel OPEN at the score screen
  (btnAgain/btnAbort still `NET.close()`). Both players pressing Rematch exchange
  `{rq:1}`; when both flags are set `_tryRematch` clears `started` and re-runs
  `_handshake()` — the host rolls a FRESH seed and the match relaunches over the
  same connection, sides kept, no new code exchange. `NET.onRematch('remote'|'gone')`
  drives the button labels ("opponent is ready" / hide when the peer leaves);
  `_peerGone` outside a live game only tears down + notifies. PROTO = 19 (bumped
  for splash rules — decks splash-immune with aimed fire tracked via bullet
  `aimId`, trees felled by splash via `g.treeHp`, atwr pod muzzles, hut-plot
  scrubbing; 18 covered
  for mapgen v3 — 84/100 maps, unbroken river with bridge-only crossings,
  edge-reaching lakes, walkable mesas, orphan-land stitching; 17 covered
  the first mapgen rework — wider river + tributary + always-a-lake, up to two
  bridges with under-terrain, sand/marsh/scrub ids 8-10, guaranteed expansion
  fields; 16 covered
  destroyable bridges — deck/hut entities at battle start, terrain 7 fallen
  spans, engineer bridge repair; 15 covered
  the side-token rename — the internal faction keys are `udc`/`srp` (extra
  slots `ud2`/`sr2`) everywhere: entity owners, replay/save meta, MP handshake,
  URL `?side=`, storage `hw_progress_udc/srp` + `hw_rec_<side>_<n>` — a clean
  break, no legacy-key migration; 14 covered
  the holdout interior scrub + gate clearing, midfield fallback off the
  map center, bridge road approaches, and the shore landing shifted east; 13
  covered the landing coastline: `shore` map gen, crystal-free reinforcement
  spawns, landward rally on shore maps; 12 covered the classic first-mission
  redesigns: per-mission `allow` tech gates,
  `aiNoSell`, honored `aiCredits: 0`, objective-building sale protection; 11
  covered the two-arc campaign rebuild; 10 covered value-based waves, faction
  balance retune, ltnk/nuke stats, poverty-trap fix; 9 covered depot capture
  bonus + $100 trickle and mapgen field spread; 8 covered conyard repair
  exemption and AI base discipline; 7 covered path lane noise, two-lane
  bridges, depot rate; 6 covered mapgen area scaling, superweapon auto-repair
  and wave massing).
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
- Contact shadows: infantry and ground vehicles cast a soft SE-offset ellipse (skipped
  while cloaked); air keeps its separate drop-shadow + bob.
- Vehicles rolling over bare dirt kick up drifting dust puffs (spawned in
  `_stepAlongPath` every 8 ticks off tick+id hash — cosmetic, never `game.rng`).
- Big explosions (`expL`) get a shockwave ring (first 8 ticks) and six gravity-drooping
  debris fragments on top of the sprite frames (`_bigBoomExtras`, deterministic off
  position — no rng, no state).
- Living ground: phase-quantized hash glitter (`_gl`, render-only) puts brief sun glints
  on open water and sparkles on chrysalite cells in view. No sim reads beyond
  terrain/tib; shroud draws over it as usual.
- **Atmosphere layer** (render-only, inside the viewport clip, after shroud, before the
  crisp selection/placement UI): `_drawGrade` runs a cinematic colour grade — a `multiply`
  dusty-warm shadow tint, a `screen` warm highlight, a `soft-light` cool-in-the-darks, and
  a cached 128px `overlay` film-grain pattern (≤0.05 α) that kills gradient banding — then
  `_drawGlow` (additive bloom), then `_drawVignette` (a cached elliptical radial darkening,
  rebuilt only on `C.VIEW_PW`/`VIEW_PH` resize). Every pass resets
  `globalCompositeOperation` to `source-over` and `globalAlpha` to 1; the main context stays
  `imageSmoothingEnabled=false` (only offscreen buffers smooth). A few full-viewport fills —
  no per-frame `getImageData`.
- **Emissive bloom** (`_drawGlow`, `globalCompositeOperation='lighter'`): cached soft
  radial-gradient stamps (`_glow(r,g,b)`) additively haze the bright things — tiberium
  cells (green, low per-cell α so overlap builds the field glow), fire/muzzle/explosion
  effects, laser/ion beams (drawn thicker), and charging obelisks (pulsing red). All gated
  by `g.shroud[...]===1` so nothing glows through unexplored fog. Piggybacks the existing
  visible-cell window and effect list — no new full-map iteration.
- **Water depth + shoreline foam** (render-only, per visible water cell gated by shroud):
  deep cells darken by their 8-neighbour water count (grades shore→channel), shore cells
  brighten turquoise with a shimmering foam rim on every land-facing edge.
- **HUD chrome** (flat, no gradients): `_bevel` is a solid fill + 1px line chip; the tab
  bar is a flat dark fill with a warm-gold baseline. The viewport/sidebar seam is one 8px
  dark channel under a single gold hairline that continues the tab bar's baseline down
  the screen; below the radar the power readout glows inside that same channel. Every
  sidebar module — radar/logo screen (flat black + gold hairline border),
  REPAIR/SELL/MAP row (`_btnRects`, shared by draw and hitTest), build strips and their
  scroll arrows, the tab-bar side label and right-aligned clock — snaps to one shared
  content column `C.SB_X0..C.SB_X1` (seam + 12px shoulder each side, derived in
  `applyScreenAspect`), sized so the content is exactly two cameo columns wide.
- **Living menu backdrop** (`_menuBackdrop`, drawn by `frame(null)` when no game exists):
  a cached dawn gradient, a warm horizon glow, a slowly drifting tactical grid, ~46 additive
  embers (seeded once with `Math.random`, advanced by a `performance.now` dt), a cached
  scanline tile and vignette. Replaces the old black fill; the `.overlay` veil is a soft
  radial so the drift shows around the panels. Menu chrome (`css/style.css`) is layered
  console panels — vertical gradient + scanlines + targeting corner-brackets + faction-tinted
  glow (`--accent`, retinted by `body[data-side]` set on faction pick), glowing title,
  hover-lit buttons, recessed faction cards with mottos. All cosmetic; determinism-safe.
- **Battle aftermath decals** (sim-spawned in `killEntity`, drawn in the ground-marks
  pass before entities): destroyed buildings leave a `rubble` effect sized to their
  footprint (ttl 1350 — charred bed drawn as hash-jittered row strips with pinched end
  rows plus outlying soot daubs past the footprint, so the silhouette is an eroded
  stain rather than the building's rectangle; hashed broken slabs, wall stubs, embers
  that cool over the first ~17s, alpha fade near expiry); non-air vehicles leave a `wreck` husk
  (ttl 675 — soot ring, burnt hull, collapsed cabin, cooling ember). Deterministic:
  spawned in the sim path, drawn from position hashes (`_gl`), no rng, not checksummed.
- **Hover feedback** (fine pointer, render-only): the unit or building under the cursor
  shows its health bar without being selected; in SELL mode the cursor quotes the
  refund (`+$n`, hp-scaled) before the click. Selected harvesters show 5 cargo pips
  (`u.tib / HARV_CAP`, green) like transports/aircraft show theirs.
- **First-battle nudge** (`_drawF1Tip`, localStorage `hw_tip_f1`): a one-time chip under
  the EVA banner (ticks 90–320 of the player's first SP battle) pointing at F1 / the
  Options menu for the controls reference.
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
- **Minimap sight states** (`_updateMinimap`, every 8 ticks): explored cells outside
  `g.visible` (live LOS, recomputed by Fog every 5 ticks) get a translucent grey wash —
  the map remembers terrain, not activity — and the live-sight region is rimmed with a
  soft green edge (4-neighbour boundary of the visible mask): the ring inside which
  enemy blips can appear. Unexplored stays black. All render-side, per-client.
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
- **Battle intro** (`_drawIntro`, render-only, keyed off `g.tick` so it is identical
  across MP peers and in replays): ticks 0–26 fade the whole screen up from black;
  ticks 0–58 show `g.introLabel` high on the viewport (18% down; set by `startGame`:
  `OP n: TITLE`, `SKIRMISH — DIFF`,
  or `MULTIPLAYER BATTLE`) as a title card — dark band across the viewport, gold rules,
  ramped in/out. The label is per-client display state; the sim never reads it.
- **Verdict tint** (`_drawVerdict`, render-local frame counter): once `g.status` is
  `won`/`lost` the battlefield ramps to a gold (win) or crimson+dark (loss) cast over
  ~48 frames, bridging the 1.4 s gap before the score panel. Resets while playing.
- **Sidebar tooltips** (`_drawIconTooltip`, fine-pointer only via `matchMedia`): hovering
  a strip icon draws a canvas tooltip left of the sidebar — name, `$cost`, a one-line
  role blurb from `DATA.blurb[key]` (superweapon icons use `key+'Strike'` and show the
  weapon name), and `Power +n` / `Power drain n` for buildings. Hidden while paused; on
  touch there is no hover so it never draws.
- **Score debrief**: rows end with `Field rating` — score-tiered `D CONSCRIPT` →
  `S LEGENDARY`, capped at `C` on a loss. Menu/overlay buttons play the UI click via a
  capture-phase delegated listener in `boot` (any click is a gesture, so it may also
  `AUDIO.init()`).
- **Controls reference** (`#controls` overlay): opened from the Options menu button or
  `F1`/`?` in game (`Main.showControls` pauses first); Esc steps back to the pause menu
  (guard in `togglePause`), and `endGame`/`desyncEnd` clear it like the pause panel.
  Mouse + keyboard columns always show; the touch column is `.coarseOnly`.

### Controls (classic left-click scheme)
- **Left-click**: select own unit(s)/building; with selection on: click enemy → attack;
  click ground → move (units) ; click chrysalite w/ harvester selected → harvest; click own
  building w/ engineer... (engineer targets enemy building = enter/capture cursor); click
  selected MCV again → deploy; click own factory → select it (its rally shown).
- **Drag left**: selection box (own units only; buildings excluded unless single-click).
- **Right-drag**: grabs and pans the map (tracked on window-level listeners so leaving
  the canvas or window doesn't strand the gesture; <5 px of client movement still counts
  as a plain right-click). Windowed browsers make edge scrolling clumsy — this is the
  primary desktop pan.
- **Right-click**: deselect / cancel mode (placement, repair, sell, super target). NO
  right-click orders — authentic to the original.
- Shift+click adds/removes from selection. Double-click a COMBAT unit selects every
  own on-screen unit of the same DOMAIN — ground units grab the ground army, aircraft
  grab the wing; air and ground never mix (`_selectArmyOnScreen(air)`), harvesters and
  MCVs always excluded; double-click a harvester/MCV keeps the classic same-type select
  (economy management). T hotkey still selects same-type.
- Ctrl+click on open GROUND with combat units selected = attack-move to that spot (`A` also
  arms an attack-move mode: attack cursor, next left-click sweeps there in formation).
  Ctrl+click on an ENTITY stays focus-fire — entity beats ground.
- Ctrl+1..9 assign group; 1..9 select; double-tap centers camera.
- Keyboard scroll: arrows; edge scroll when mouse at viewport edge (cursor becomes scroll
  arrow; red no-scroll variant at map bounds). `H` jump to conyard. `S` stop. `G` guard.
  `Esc` → pause menu / cancels modes. `D` deploy MCV. `T` select same type on screen.
  `E` select every unit on screen except harvesters. `Space` jump camera to the newest radar ping
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
  visual viewport's aspect (clamped 1.6–2.4, sidebar keeps its 296px on the right, the
  battlefield viewport absorbs the rest), the canvas bitmap is resized to match (which
  resets context state — `Render.resize` re-asserts `imageSmoothingEnabled=false`), and
  the CSS box fills the screen exactly. Every consumer reads `C.*` live so the whole UI
  re-flows; re-run on visualViewport/window resize, orientationchange and
  fullscreenchange. Fine-pointer devices keep the fixed 1600×1000 layout untouched.
- **Wide touch sidebar** (`core.js` `applyTouchSidebar`, called once at boot on
  coarse pointers BEFORE the first layout pass): `SIDEBAR_W/RADAR_W` 296→392,
  cameo slots 128×96→176×132, strip spacing 100→138 with 4 visible rows —
  finger-sized build icons on phone-sized screens. Both widths are exact fits:
  8px seam + 12px shoulder + two cameo columns with an 8px gutter + 12px
  shoulder — no dead margin at either size. `applyScreenAspect` derives
  `SB_X0/SB_X1`, `STRIP_BX/UX` and `MM_X` from `CAMEO_PW`/`SIDEBAR_W`, so the
  whole sidebar re-flows from the two base numbers; hit zones and strip
  scrolling follow the constants automatically.
- **Pinch-to-zoom** (`Render.setViewZoom(f)`, `C.VZOOM`): render.js splits its
  scale into `BZ` (the fixed bake scale — terrain cache, tree sprites and the
  cursor stay authored at `C.ZOOM`) and a live `Z = BZ × C.VZOOM` used by every
  world→screen path (`X/Y/cs`, `sca()`, `worldFromScreen`), so retargeting Z
  re-scales the whole battlefield; cached bitmaps blit with explicit
  `Z/BZ`-scaled dims. `C.VIEW_W/H` recompute from the zoom, which drives
  culling, camera clamps, edge/keyboard/wheel panning and the radar's viewport
  box for free; the zoom clamps to 0.5–1.6× and never lets the view exceed the
  map. Touch: a two-finger pinch rides the existing two-finger gesture (spread
  ratio → zoom, anchored on the world point between the fingers; a pinch never
  counts as a two-finger tap). Desktop: ctrl+wheel (which is also how browsers
  report a trackpad pinch) zooms around the cursor. Every screen→world
  conversion in input.js divides by `C.ZOOM * C.VZOOM`; each battle opens at
  1× (`startGame` resets). View zoom is render-only — per-client, excluded
  from the MP checksum, PROTO unaffected. A ZOOM chip (top-left, stacked
  under the objective/SPEED chips via `objChipH`) shows whenever the zoom is
  off 1× and clicking it (`zone: 'zoom-reset'`) snaps back; `+`/`=`/`-`
  zoom the keyboard around the viewport centre and `0` resets (these work
  paused — inspecting a frozen moment is when you lean in); edge/keyboard
  scrolling divides `SCROLL_SPEED` by the zoom so panning keeps a constant
  SCREEN speed.
- **Radio log** (render.js `evaLog`): the last 4 EVA lines linger bottom-left
  for ~11s, oldest fading — the record the transient banner doesn't keep;
  cleared whenever `frame()` sees a new game object so chatter never leaks
  across battles.
- **Superweapon clocks** (`_drawSuperClocks`, RA2-style): every armed
  superweapon on the field shows a countdown chip at the battlefield's top
  right — yours AND the enemy's, bordered and lettered in the owner's color
  ("ORBITAL LANCE 04:32" / "NUCLEAR MISSILE 02:10"); READY blinks white until
  the strike is called. Reads straight from `players[side].super`.

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
  turrets shoot it in the back. While a wave GATHERS, freshly built idle units (all but
  the 2 closest to home, cap 16 ids) JOIN the muster each cadence — the launched wave
  is the whole production run, not the batch that was idle when the timer fired.
  Wave readiness is measured in CREDIT VALUE, not headcount (`needVal`: normal
  `2400+wave*800` capped at `waveCap*650`, elite `2800+wave*1200` capped at
  `max(waveCap*800, 9000)`) — a count bar let the cheap-roster faction launch
  earlier, lighter waves that broke on defenses while the expensive roster
  arrived in real punches. Mission `aiWaveCap` still caps the launched COUNT. All group moves
  (muster, advance, join, escort AND the player's own group orders via input.js)
  route through the shared `formationCells(g, cx, cy, n)` spiral (core.js), with
  input assigning spots row-major-sorted so blocks translate without crossing;
  findPath additionally adds 0-2 per-unit deterministic "lane noise" per step so
  equal-cost open-ground routes fan into clusters instead of one single-file line
  (chokes still funnel: noise never beats a genuinely shorter route).
- **Aircraft doctrine** (all difficulties): strikes pick `_airTarget` — value over
  distance among buildings ≥500 cost + enemy harvesters, never walls/silos — and a
  90-tick sweep sends any idle aircraft loitering >14 cells from home either at a
  worthwhile target within 12 cells or straight home (rearm logic takes over).
- **Crate runs** (all difficulties): every ~10s the nearest fast idle raider
  fetches loose crates — within 14 cells for normal AIs, 26 for elite.
- **Expansion convoy** (elite): the anchor is `_deploySpotNear` — the nearest
  conyard-footprint of clear, crystal-free, unoccupied ground beside the rich
  field (aiming at the field itself parked the MCV on crystal where deploy can
  never succeed) — the MCV travels with up to 3 escorting guns (`_escortTo`),
  and a blocked deploy re-anchors on fresh ground near the MCV with a widening
  search instead of nudging forever.
- **Building repair** (sim, all owners incl. AI): hostile OR unattributed damage
  (superweapon splash passes `attacker=null`) flips `repairing` on any finished
  building whose owner holds >100 credits — the AI patches up after a nuke/ion
  strike instead of bleeding out; a broke AI leaves the wreck alone. The CONYARD
  is exempt from the credits gate (a stalled repair just waits for money), and
  the AI's main cadence re-toggles any damaged unrepairing conyard as a backstop.
- **Base discipline** (ai.js): `_findSpot` scores −3 for any spot whose footprint
  touches another own building (ADJACENCY 1 permits a clear cell between
  footprints) — splash from one superweapon shouldn't gut three structures, and
  a hugged base walls its own traffic in. `_pickUnit` puts a dead economy first
  (0 harvesters + a refinery → 'harv' with no credit bar; the unit-start gate
  drops from 400 to 100 for that purchase) and caps the AIR WING at
  `max(2, min(elite?5:3, ground/4))` — air is a scalpel, not the army.
- **Poverty-trap fix**: the "never save yourself defenseless" army floor (military
  < 9 bypasses savings goals) is DISABLED while the economy itself is the
  casualty (`procs < 2 || harvs < 2`) — a battered AI that spent every trickle
  credit on replacement units could never save for the second refinery and
  starved forever; this loop decided most one-sided AI battles.
- **Faction balance** (measured by AI-vs-AI soaks, scratchpad balance53, both
  map orientations): Serpent builds the Repair Facility too (was udc-gated — the
  Serpent could never field an MCV or heal armor); Serpent DEF_PLAN moves its
  air-only SAMs late; WEIGHTS retuned (srp ltnk 6 / arty 3 / ftnk 3, e1 3 /
  e4 1 — flamers die crossing open ground to rifles; udc mtnk 4 / htnk 1);
  DATA: ltnk 550/330hp (Serpent's cheap-fast identity), nuke strike 850 dmg (the
  warhead must still DELETE what it lands on now that buildings auto-repair
  after superweapon hits — a survivable blast was quietly worth far less than
  the ion's pinpoint kill). Measured result: from UDC 7–0 sweeps to ~parity
  (draw leans split, decisive wins ~even across difficulties).
- **Expansion discipline** (elite): `wantMcv` clears the moment the MCV exists
  (it used to stay set for the whole trek, so the factory turned out MCV after
  MCV); `_richFarField` skips pockets within 25 cells of the current enemy's
  base; the anchor sits ~4 cells on the AWAY side of the field (behind its own
  crystal moat) and `_deploySpotNear` demands ≥60% of the surrounding ring
  buildable (elbow room for the refinery); `_escortTo` pickets 4 cells out on
  the threat side and never assigns a spot within 2 cells of the anchor — an
  escort parked on the pad would block the very unfold it came to guard.
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
- **Hover intel** (fine pointer, render-only): the unit or building under the cursor
  shows its health bar AND a name chip in the owner's color (★/★★ for veteran/elite
  units) — friend-or-foe identification without a click.
- **Bankrupt liquidation** (all difficulties): an AI with <150 credits and no
  harvesters starts SELLING after ~30s — one expendable building per ~10s
  (SALE_ORDER: silos, pads, tech, defense, spare power; never the conyard,
  refineries, factories, or last plant) while a way back to an economy exists.
  When none does (or the sellables run dry), `_finalRush` liquidates EVERYTHING
  and orders the entire army to attack-move on the enemy — no more going docile.
- **Elite AI** (`aiElite: true` — the HARD skirmish preset): crate runs by fast idle
  raiders; a supply-depot engineer (priority slot in the infantry line via
  `st.wantEng`); up to TWO garrisoned village houses (hard-capped: garrison duty
  must not bleed the wave army); MCV base expansion toward a rich far field
  (`st.wantMcv` priority slot, deploys a second conyard the placement planner then
  builds from — `_findSpot` searches every yard); refinery guard turrets
  (`st.defGuardAt` placement hint); bigger massed waves (5 + 2/wave, min 12 cap) and
  no lone-unit trickling (deep survivors regroup at ≥4); sharper economy (8-harvester
  fleet, earlier 3rd/4th refinery); unit MICRO on a 12-tick clock — focus fire on the
  weakest enemy unit in weapon range, wounded armor breaks off to the repair pad
  (or home) and rejoins above 70% hp. The first two base defenses also jump the
  big-ticket savings queue for every AI, so bases never sit gunless.
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
- `AUDIO.setVolume(mult)` / `AUDIO.setVoiceVolume(mult)` / `MUSIC.setVolume(mult)`: 0–2
  multipliers from the pause-menu sliders (see Menu DOM). The voice chain ends in a
  dedicated `voxBus` gain wired straight to the master lowpass (NOT through the SFX
  master), so the three levels are independent; `_applyGains()` is the single place
  every bus level is computed from the enabled flags + sliders.
- `AUDIO.init()` must be called from a user gesture (menu click) to unlock the context.

### Art direction (sprites_*.js) — original pixel art, mid-90s RTS look
- All sprites drawn programmatically on offscreen canvases at 1× with integer `fillRect`
  pixels; NO anti-aliasing, no gradients except tiny dithers; dark outline (#111-ish) around
  readable silhouettes; light source top-left; palettes from `PAL` in core.js.
- Team colors: UDC = desert gold/tan (`PAL.udc*`), Serpent Order = steel grey with red accents
  (`PAL.srp*`). Same shapes, different palette per `side`.
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
- Cameos (`SPRITES.cameo[key]`, authored at 128×96 = 2× the 64×48 layout unit, blitted
  1:1 into the sidebar slot — fine dither, hairline frames, 13px labels; the portrait
  art itself stays chunky pixel art): mini portrait of the thing on dark slate bg with
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
  (no tile seams). Water shades by a SHORE-DISTANCE field (per-cell BFS from the banks,
  capped, 3x3-blurred, bilinear-sampled, hash-dithered at band edges): lakes darken
  toward their middle along their own coastline contours, with foam pinned to the noisy
  waterline. The render-side water pass draws ONLY the animated foam rim — the old flat
  per-cell shallow/deep washes stamped blocky rectangles over the painter's contours.
  Rock cells get varied boulder formations. Tree cells paint their darkened forest
  floor into the static cache, but the CANOPIES render into per-tree sprites
  (`build()` returns `trees: [{kind:'tree', canvas, wx, wy, base}]`) that render.js
  merges into the baseline-sorted entity pass — a building north of a tree sits
  BEHIND its crown, a building south of it covers the trunk; open land gets sparse doodads (tufts, flowers, pebbles, cracks,
  fallen logs, mushroom clusters, pale mineral stains, worn tire ruts — and reed beds
  with cattail heads along every waterline —
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
  and `scroll*` (edge). `SPRITES.logo.udc/srp` ~120×90 emblems for radar-idle and menu.
- `SPRITES.shroudEdge`: 8 directional 24×24 jagged black-edge tiles (N,NE,E,...) with
  alpha.

### Map generation (`map.js`) — water realism
- The river descends the elevation valley column-by-column inside a band scaled to the
  map (28%-69% of H). Ponds are CONTOUR FLOODS (`floodPond`): lowest-first flood of the
  basin around a genuine elevation minimum up to a randomized water level (a deeper,
  larger lake on riverless seeds), so shorelines follow the landform; sub-5-cell
  puddles are discarded. Most ponds drain through a 1-wide downhill `stream` (steepest
  descent, ≤14 cells, stops at water/starts). `smoothShores` then dries orphan
  1-neighbour water specks and floods ≥7-neighbour land pinholes — coasts read as
  coasts, not cell noise. Fords/bridges survive all of it (their gap cells never meet
  the thresholds).

### Map generation (`map.js`)
- 84×84 classic or 100×100 Large (~30% wider and taller than the original 64/88 — room for the mesas, lakes and tributaries to breathe). Discrete feature counts (ponds, tree clumps/singles,
  boulder outcrops, mid-map fields, hamlets, depots, concurrent crates) scale with the
  `area` factor `(W*H)/4096` so a Large map's far country stays busy: ~4-6 midfields
  spread across the WHOLE interior (only the first is pinned near the centre; each
  heart must be open+reachable and is scored by surrounding open ground, or the field
  shrivels to a speck beside a pond), a second blue pocket (`i===3`), 1.2× home fields
  and 1.25× midfields, a second outlying hamlet (houses/civs appended to
  `g.decor.village`), and up to 4 supply depots (extra anchors at the 0.3/0.7
  quadrant marks).
- Deterministic from seed via `mulberry` (features additionally use seeded hash
  noise — NEVER `Math.random`/`game.rng`). Geography grows from a hidden ELEVATION field
  (`buildElevation`: 4-octave fbm + a gentle climb toward the rim) that every feature
  reads, so the landscape is internally consistent:
  - the west→east river FOLLOWS THE VALLEY (per column, step ±1 to the lowest-elevation
    cell ahead; base plateaus repel the channel so the start-safety guard never censors
    it into visible gaps), widens downstream (~1 cell west to ~3 east) and is
    UNBROKEN — no fords, no gaps: bridges are the only way across (2 guaranteed
    when the water allows, sometimes 3, spread ≥12 columns apart and biased
    toward the start↔start axis). On most river seeds a narrow spring-fed
    TRIBUTARY rises mid-map (never at the rim, so its head can be walked
    around) and winds down the grade to join the river — also unbroken.
    River/tributary cells are stamped into a riverMask: their banks stay
    earthen, while SANDY shores belong to the standing water — lakes, ponds
    and the sea. The deepest depression always floods to a proper lake, and
    lakes may run to the MAP EDGE (borderFringe and the hard rim ring skip
    water, extending it to the true boundary — a bay against the world's
    edge). Marsh pools in any low wet ground; scrub fringes every dry flat.
    The always-carved corridors and the escalating connectivity fallback are
    water-SPARING (rock/trees only) — a blocked map first force-places one
    more bridge, and only the cannot-fail last resort may ever cut water. An
    orphan-land stitcher lanes any ≥40-cell sealed pocket to the mainland
    through rock/trees (never water — islands keep their moats). Bridges: TWO
    adjacent deck columns — a single-file deck wedged harvester traffic
    head-to-head; the painter draws rails only on true outer edges so the
    lanes read as one span.
    The deck rectangle runs TWO cells past the water onto each bank so the abutments
    sit on solid ground and the road continues from the deck ends. `placeBridge`
    returns `{ cells, rect, water, under, huts }` (`under` = the pre-deck terrain per
    cell — the painter classifies deck cells by it, so the shoreline runs BENEATH the
    span instead of retreating to the bridge ends); `g.decor.bridges` carries them to
    startGame, which spawns a neutral 'bridge' deck entity per crossing (walkable —
    `deck: true` skips the occupancy stamp; no sprite, the art is baked terrain) plus
    a 'bhut' control room on each bank, recorded in `g.bridges` (hut plots are scrubbed
    LAST in mapgen — trees/crags/crystal cleared, drowned plots re-landed, a doorway
    drained if a lake lapped every side — the repair crew always gets in). The deck is
    a real target but ONLY for deliberate fire: Ctrl+click force-fires on it
    (`bridgeDeckAt` supplements occ-based picking) and a shell AIMED at the deck lands
    (bullet `aimId`), while stray SPLASH from nearby fighting never touches it
    (`_splashDamage` skips decks); at 0 hp `_bridgeCollapse` marks the record down, turns
    the water-span cells to terrain 7 (impassable), kills ground units standing on
    them and leaves the land stubs walkable, with `_drawBrokenBridges` covering the
    baked deck with open water + charred tear lines (radar shows water too). An
    engineer sent into either control room (`orderEnter`; huts are `invuln`) runs
    `_bridgeRepair`: span cells back to 6, a fresh full-hp deck entity, engineer
    consumed — an intact bridge refuses the crew. All of it flows through existing
    'atk'/'ent' orders, so MP/replay/save need no new command plumbing;
  - the high grounds are MESAS (`mesas()`, 2-5 per map scaled by area): rounded,
    gently lobed crag rings around WALKABLE tops, crowned on interior high ground —
    never hugging the map edge (the rim is already a barrier), never on water, away
    from starts and each other. Every mesa gets TWO dirt ramps cut through the ring
    (roughly opposite bearings), each with a carved lane out past the outline through
    any old crag or treeline; a final pass guarantees at least one top cell is
    reachable from the player (extra lane to the nearest mainland cell, never across
    water). Tops are recorded in `g.decor.mesas[].top` and the painter lifts their
    tone (+0.13, bilinear-bled) so they read sunlit. Grass at the foot of rock
    weathers to talus dirt; high, dry (far from water) flats bake to dirt regions
    wrapped in scrub fringes;
  - woods follow moisture (BFS distance-to-water): dense gallery forest on the banks,
    groves in the lowlands gated by a broad meadow mask (no mega-forests), sparse stands
    up high; tree clumps + lone trees for texture; bridge ends and mesa ramp mouths are
    deliberately felled clear (`clearTrees`);
  - ponds pool at genuine local elevation minima but never within 7 cells of a ford or
    the bridge (depressions cluster on the valley floor — an unguarded pond would fuse
    onto the river and seal the crossing); mid-map chrysalite fields pick the
    lowest-lying valid spot (crystal collects in valleys); worn dirt roads run from the
    village to the river crossing and toward the nearest base (`road`, grass-only brush).
  A ragged 1-3 cell rocky rim rings the map (never blocking the two base areas or the
  corridor between them; BFS connectivity check widens the corridor as a last resort).
- Two start zones (fractional anchors, scaled to the map): player SW-ish, AI NE-ish — keep a 12-cell
  radius buildable (grass/dirt only). Chrysalite fields: a rich HOME field beside each
  base (~130-170 cells, offset away from the enemy), a guaranteed EXPANSION pocket
  12-17 cells out from each start (~80-105 cells, sited on the openest reachable
  ground ≥10 from the home field), then 3-4 mid-map fields, each with a blossom tree
  at heart. Fill `game.tib` values 75..300 denser at field center.
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
  (the theater map, ONE accent-highlighted SKIRMISH link row, then the campaign
  ops) → Briefing → game. The skirmish link opens the dedicated `#skirmish`
  window (`_showSkirmish`): a settings sheet with a UDC/Serpent side toggle,
  a DIFFICULTY select (Easy/Normal/Hard — the old three ledger rows), the
  full `#skOpts` option set, `#btnSkLaunch` (Commence Battle) and Back (which
  returns to the theater that opened it, tracked in `skFrom`). The briefing is a full sitrep screen (main.js
  `_showBriefing`): OP title + a per-mission `sector` stamp, a faction-styled
  classification bar, the brief paragraphs TELETYPED (the untyped tail lives in
  `visibility:hidden` spans so `textContent` is always complete — click the body
  to print it all), an OBJECTIVE block, intel bullets derived from the mission's
  own knobs (`_briefIntel`: aiCredits/aiCalm/holdout/objective type), and a
  TACTICAL SURVEY canvas (`_drawBriefMap`): the real mission map regenerated
  from its seed via MAPGEN into a throwaway grid (C.MAP_W flipped to 64 and
  restored synchronously), drawn schematic-style with markers — your force,
  enemy crosshair (or the escort BEACON + dashed route), the holdout ring, the
  blue lode on harvest ops, depot/village dots; pause menu — decluttered to one
  sheet: Resume, a slider group (SFX/Music/Voice/Speed — a slider at 0 IS the
  mute switch, the old ON/OFF toggle buttons are gone along with their
  `td_music`/`hw_voice` persistence), a 2-column grid (Controls, Fullscreen,
  Save Battle, Restart), Abort to Menu, a `#seedLine` "Map seed N" footer;
  score screen (+ Rematch in MP). The main menu shows Resume Battle when a compatible
  `hw_save` exists. Esc toggles.
- **Skirmish setup** (the `#skirmish` window, skirmish only — missions/MP ignore
  it): SIDE toggle (UDC/Serpent), DIFFICULTY (Easy/Normal/Hard presets),
  COMBATANTS (`You vs AI` / `You vs 2 AI` / `You vs 3 AI` free-for-alls, or
  `Watch 2-4 AI` spectator battles), MAP (Classic 84×84 / Large 100×100), starting
  funds 3000/5000/8000/12000 (applies to EVERY war chest, then the EASY/HARD
  preset still overrides the AIs'), crates ON/OFF (`game._noCrates` gates only
  the random-drop roll in `_tickCrates`; pickup/expiry sweeps and mission
  `crates:` events still run), superweapons ON/OFF (`game._noSupers` →
  `Production.prereqOk` refuses any building with `superweapon:`, hiding it from
  the sidebar and the AI's build plan — the AI's defense cap then stays at the
  pre-tech 4), and a numeric seed field (blank = random) for refighting a shared
  battlefield. Choices persist in `hw_sk` (seed excluded, difficulty included);
  all of it rides `opts.sk` into flags + the REPLAY meta so replays/saves reconstruct.
- **Multi-AI combat model**: `SIDE_ORDER = ['udc','srp','ud2','sr2']` (core.js);
  `g.sides` lists the combat sides in play in canonical order and EVERY sim loop over
  players iterates it (production ticks, depot/repair-pad sweeps, checksum) — classic
  1v1 games run the identical old sequence. `baseSide(s)` maps the extra slots to the
  faction whose DATA (build lists, side-locked items, superweapon key, free helipad
  aircraft, crate tank) and sprites they use. Slots 3/4 wear lazily generated
  recolors (`SPRITES.ensureSideArt`, end of sprites_buildings.js): exact team-ramp
  remap (UDC AZURE = steel blue; SERPENT AMETHYST = violet accents — green was
  retired, it read as chrysalite ore) plus, for AMETHYST, a violet tilt on the base
  faction's many auxiliary greys. Combat hostility was
  already owner-inequality — FFA needs no rule changes. `AI` keeps one state per AI
  side (`ST[side]`), initialized in `g.sides` order (deterministic rng), each picking
  ONE current enemy (nearest living side by start position, re-picked on elimination)
  that replaces the old hard-wired `g.human` in threat bearings, wave targets and
  superweapon aim. `MAPGEN` places up to 4 starts at fractional corner anchors
  (SW/NE/NW/SE), gives each a home crystal field offset away from its nearest rival,
  and carves passable + tiberium-free corridors between every pair; `g.startPos` is
  side-keyed with the legacy `.human`/`.ai` aliases intact for missions. Win check:
  FFA is last-force-standing (playing: you must outlive all; spectate: ends when ≤1
  side lives, verdict names the winner via `g._winnerSide`). Missions/MP stay 2-side.
- **Spectator mode** (`g._spectate`): the viewed side is itself an AI army; render
  reuses the replay's `seeAll`, `NET._rec` swallows live orders (look, don't touch),
  `AUDIO.eva` goes quiet, hunt/reveal aids stay off. Spectate battles still record,
  so they can be saved, resumed and replayed like any skirmish.
- **Observer seat** (spectate AND replay, i.e. whenever `seeAll`): the radar minimap
  is always on — `_drawSidebar` shows it on `p.radar || seeAll` and `Render.radarOn()`
  gates the radar-drag jump the same way, no Comm Center required. A tab-bar chip
  (`◀ SIDE NAME ▶` in the side's `OWNER_COLOR`, `hitTest` zone `view-cycle`) and the
  V key (Shift+V backwards; works even paused) cycle which commander's HUD is on
  display: render.js keeps a module-level `viewSide` (+ `viewGame` staleness guard)
  and `_viewP(g)` swaps the player behind the build strips, credits/storage ticker,
  power bar, radar logo and strip scrolling (`Render.viewPlayer()` in input.js).
  Strictly render/input-only: the sim still reads `g.humanSide`/`g.human` (fog,
  harvester auto-seek), so seat-hopping through a replay reproduces the exact live
  checksum — viewtest47 asserts this, plus the chip/radar behavior and that live
  non-spectate games are unchanged (`cycleView` refuses when `seeAll` is off).
- **Spectator fast-forward** (spectate + replay playback): `game._ffSpeed`
  (1/2/4/8/16, default 1) multiplies the main loop's step rate — pure pacing, the
  sim ticks the same sequence, so determinism, recording and saves are untouched.
  Cycled by the top-left `▶ SPEED xN` viewport chip (`hitTest` zone `ff-cycle`)
  or the F key; `Render.cycleSpeed()` refuses in live games, MP and during
  save-resume catch-up (`g._ffTarget`). At ≥4x the tick loop runs with SFX
  muted (`AUDIO.setEnabled` wrap, same pattern as resume fast-forward).
- **Large map**: `C.MAP_W/H` set per game in `startGame` (88 for Large, else 64 —
  missions/MP always classic); `findPath` refits its scratch arrays on size change
  and the terrain cache keys on seed + size. Minimap/camera/fog scale through C.
- **Volume sliders** (`volSfx/volMusic/volVoice`, 0–100, 50 = designed level, persisted
  as `hw_vol_*`): value/50 multiplies `AUDIO` MASTER_GAIN (0.35), the MUSIC master
  (0.15), and a dedicated `voxBus` gain the synthesized voice routes through (it
  bypasses the SFX master so the sliders stay independent; baseline equals MASTER_GAIN
  so the reroute is loudness-neutral).
- **Campaign records**: a genuine win (not a replay watch) on a mission with `n` writes
  `hw_rec_<n>` keeping min time (secs) / max score; the score tally shows "Op record"
  (with NEW BEST) and the ops list appends `BEST mm:ss · score` to completed rows.
- Win check per rules; on end: `Main.endGame(won)` shows score screen; sound
  `missionAccomplished`/`missionFailed` EVA.

### Replays (`replay.js`, global `REPLAY`)
- The sim is deterministic lockstep, so a battle IS `{seed, setup, orders}`. Every
  single-player game auto-records: `Main.startGame` arms `REPLAY.arm({seed, side,
  mission: n|null, skirmish: 'EASY'|'HARD'|null, sk: {credits, crates, supers}|null})`;
  the net.js wrapper layer's `_rec(c)`
  logs each GENUINE player order (passthru path with `!active && !inSim && !applying`)
  as `{t: game.tick, c}` using the same command encoding multiplayer sends. Sim/AI calls
  never record (they run under `NET.inSim`).
- `endGame` → `REPLAY.finish(won)` freezes the recording as "last". Score screen offers
  Watch Replay / Save Replay (JSON download); the main menu's "Watch Replay" loads a
  file. `Main.startReplay(meta)` reconstructs the setup (mission from `MISSIONS[n-1]`,
  skirmish from module-scope `DIFF_PRESETS`) and re-runs `startGame` with the recorded
  seed; REPLAY then disarms the fresh recorder and enters playback.
- Playback: the main loop calls `REPLAY.applyPending()` at the top of each tick
  iteration — while `game.tick` still equals the recorded T (live input always lands
  between frames, i.e. after tick T completed) — feeding commands through
  `NET.execReplay` (`applying` guard). While watching, `_rec` SWALLOWS live player
  orders (look, don't touch — selection and camera stay free) and render shows a
  blinking ▶ REPLAY badge. Multiplayer games are not recorded (v1).
- **Mid-battle save/resume**: a save IS the running recording cut short —
  `REPLAY.exportLive()` = `{meta (+p: NET.PROTO), log, at: game.tick}`, written to
  `localStorage.hw_save` by the pause menu's Save Battle (SP only: needs
  `REPLAY.recording`). `REPLAY.resumeData(json)` validates (v, PROTO — a PROTO bump
  invalidates old saves, by design), reruns `Main.startReplay(meta)`, enters playback
  with `resumeAt = at` and sets `game._ffTarget = at`; the main loop then fast-forwards
  in ~30 ms slices per RAF frame running the EXACT live step body (including per-tick
  `Fog.update` — the sim reads `g.shroud` for harvester auto-seek) with SFX muted for
  the catch-up, while render draws a RESUMING veil + progress bar off `g._ffTarget`.
  When `applyPending` crosses `resumeAt` it flips `playing→recording` KEEPING the log,
  so a resumed battle records on seamlessly — saveable again, and `finish()` still
  yields a full from-tick-0 replay. The savetest suite verifies checksum equality at
  and beyond the save tick.
- **Spectator vision**: while `REPLAY.playing`, render sets a `seeAll` flag that skips
  the shroud fill/edges, un-gates the glow/water/crate draws, shows all radar blips
  (cloaked units shimmer like your own), and drops the minimap masks. STRICTLY
  render-side: `g.shroud`/`g.visible` still evolve exactly as recorded, because the
  sim reads them (`_exploredFor`) — touching them would break the checksum round-trip.
- Determinism contract: identical code + seed + setup + order stream ⇒ identical sim.
  Anything that breaks same-seed determinism breaks replays AND multiplayer — the
  objtest suite verifies a record→playback checksum round-trip.

## Testing hooks (must implement)

- `main.js` exposes `window.game` (live game object) and `Main.startGame` so a headless
  browser can boot straight into a game: `Main.startGame('udc', {seed: 42})`.
- Add URL params: `?side=udc&seed=42&nomenu=1&mission=N` (and `mpbc=name&mphost=1`
  for two-tab multiplayer over BroadcastChannel) → boot directly into game (skip menu),
  `&mute=1` → `AUDIO.setEnabled(false)`.
- Every module must be defensive at boot: no top-level code that throws if DOM absent
  except main.js boot listener.

## Non-goals

FMV, naval, multiplayer beyond 1v1. Keep the door open but do not build. (Campaign
missions, 1v1 multiplayer, walls, veterancy, difficulty levels, mid-mission
save/load, and multi-AI skirmish up to 4 sides have since graduated out of this
list and are specified above.)
