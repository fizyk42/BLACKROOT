# BLACKROOT — Nightfall in the Hollow

*A first-person open-world survival-horror prototype.*
Ninefold Lantern Studios · playable vertical slice

You wake beside a fire that went out hours ago, in a forest that has stopped
behaving like a forest. The road out has slumped into the creek. The emergency
band is carrier tone and nothing else. The deer are running at midday, and
there are things walking upright between the trees that used to be people.

Kill what is keeping the Hollow shut and a rift opens where it fell. Step
through it and you are somewhere else — under a sky that came apart, on a sea
floor with no surface worth reaching, in a burn that never went out. Six
places, the first one fixed and the rest shuffled by your seed, each with its
own ground, sky, weather, physics, flora, creatures and a boss that is nothing
like anything else in it.

Bring friends: host a game, read out the six characters it gives you, and
anyone who types them into the same server wakes beside the same dead fire, in
the same forest, on the same road.

Everything in this build — the terrain, the forests, the creatures, the guns,
the textures, every sound and the score — is generated at runtime. There are
no art or audio assets of any kind. The whole game is about 990 KB of HTML,
and the dedicated server behind co-op has no dependencies at all.

---

## 1. Running it

### Windows desktop installer

Download the installer from [GitHub Releases](https://github.com/fizyk42/BLACKROOT/releases/latest).
Run the Setup `.exe`, then launch **BLACKROOT** from the desktop or Start menu.
The Windows package includes the game and works offline for single-player.
Press **F11** to toggle fullscreen. Saves stay in your local BLACKROOT application data.
The installer is unsigned, so Windows may display an unknown publisher notice.

For development, use `npm ci` then `npm run desktop:start`. On Windows,
`npm run desktop:dist` creates the installer in `release/`. The GitHub **Build
Windows installer** workflow builds, installs, checks gameplay, and publishes a
release automatically when game or desktop packaging code changes on `main`.

The committed browser build is **`docs/index.html`**. Download that file and
open it in a desktop browser, or enable GitHub Pages using [PUBLISH.md](PUBLISH.md).

### The quickest way

Open **`dist/BLACKROOT.html`** in a desktop browser. Double-click it — it is a
single self-contained file and needs no server, no install and no network.

Requires a browser with WebGL2 (Chrome, Edge, Firefox, Safari 15+) and
hardware acceleration enabled. Click **NEW GAME** and the game will ask for
your mouse cursor (pointer lock); press **Esc** to release it.

### From source

```bash
npm install         # three.js + esbuild (+ playwright, only for the test)
npm start           # dev server on http://localhost:8080
```

The dev server serves the unbundled ES modules with an import map, so you can
edit any file under `scripts/` and just reload — no build step.

### Production build

```bash
npm run build       # -> dist/
```

Produces:

| Output | What it is |
|---|---|
| `dist/BLACKROOT.html` | Single file, all JS and CSS inlined. Runs off `file://`. Ship this. |
| `dist/BLACKROOT-hosted.html` | The same game as page *content* — no doctype, `<html>`, `<head>` or `<body>` — for a host that supplies its own document shell. |
| `dist/index.html` + `game.js` + `ui.css` | Conventional split build for hosting on a static server / CDN. |

### Playing it from a link instead of a file

`dist/BLACKROOT.html` is a browser game you have to download first. The hosted
build is the same game as something you click.

Most embedding hosts — Claude Artifacts among them — wrap your page in a
document of their own and expect only the content. Handing them a second
complete document inside theirs makes the browser close the outer `<body>`
early and silently drop everything after it, so `--hosted` strips the shell,
hoists the `<title>` and inlines the stylesheet where a host head would have
put them.

Three things change when the game runs embedded, and each one has broken a
browser game before:

- **The host's reset loads first.** Anything the game does not set explicitly
  is the host's, not the browser's. BLACKROOT paints its own `background` and
  `font-family` on `body`, so it wins — and `hostedtest` asserts it, because a
  survival horror game rendered on a cream background with a system sans is a
  bug you find from a screenshot rather than a stack trace.
- **Pointer lock can be refused outright.** A frame without
  `allow="pointer-lock"` rejects the request, which for a first-person game is
  the difference between "slightly worse" and "unplayable". The cursor-look
  fallback from §2 covers exactly this, and the test denies pointer lock on
  purpose to prove it.
- **Keyboard events go to whoever has focus** — the parent document, until
  something inside the frame is clicked. A player who clicks NEW GAME and then
  presses `W` would get nothing, so the hosted build claims focus on the first
  pointer or key event. It is a no-op outside a frame.

```bash
node tools/hostedtest.mjs     # 30 checks, embedded, pointer lock denied
```

The suite loads the hosted build inside a real iframe with pointer lock
disabled and checks that it boots, builds a world, that the camera turns, that
`W` moves the player, that saving works, and that the game's palette and
typeface beat the host's reset.

`npm run build:debug` skips minification. `npm run watch` rebuilds on change.

### Putting it on the open web

```bash
npm run packweb     # -> dist/web/index.html and dist/BLACKROOT-web.zip
```

Every host that takes a web game wants the same thing — a folder with
`index.html` at its root — so one package covers all of them. The zip is 300 KB
because a megabyte of inlined JavaScript compresses well.

| Host | What to do |
|---|---|
| **itch.io** | New project → Kind: HTML → upload the zip → tick *This file will be played in the browser* → viewport 1280 × 720 |
| **Netlify** | Drag `dist/web` onto [app.netlify.com/drop](https://app.netlify.com/drop) |
| **GitHub Pages** | Commit `index.html`, then Settings → Pages |
| **Cloudflare Pages** | `npx wrangler pages deploy dist/web` |

`assets/icon/icon-512.png` is the cover art. itch.io wants 630 × 500 for the
project banner, so crop or pad it to taste.

Note that itch.io and most embed hosts run the game in an iframe, where the
browser may refuse pointer lock. That is the case §2's cursor-look fallback
exists for, and `npm run hostedtest` verifies it with pointer lock denied.

### Co-op

**On one computer, with no server at all.** Press **CO-OP → HOST A NEW GAME**.
If there is no server to reach, the game runs the room itself and hands you a
code anyway; open the game in a second window, type that code, and you are in
the same world. The status line says `THIS COMPUTER` so it is clear what you
have. That is the whole setup — there isn't one.

It is the same room code either way: same six-character codes, same shared
seed, same rift handling, same downed-and-revived. The only difference is that
a browser message bus does not leave the machine, so it covers two windows on
one desktop and not a friend in another house. For that you need the server.

### Co-op — the dedicated server

```bash
npm run server                  # game + co-op on http://localhost:8787
PORT=9000 npm run server        # somewhere else
HOST=0.0.0.0 npm run server     # reachable from the LAN or the internet
```

One process, no dependencies beyond Node, no database and no accounts. It
serves the game's files *and* runs the co-op hub on `ws://…/net`, so a player
can point a browser straight at the box and play.

Then, in the game: **CO-OP** on the main menu → **HOST A NEW GAME** → read the
six-character code out. Anyone who types the same code into the same server
lands in the same world, on the same seed, walking the same road through the
biomes. Up to eight per code.

The **SERVER** field defaults sensibly: if the page was served by the
dedicated server it points at itself, and otherwise at `localhost:8787`. A
bare hostname works — `coop.example.com` becomes
`ws://coop.example.com/net` — and a page served over https automatically asks
for `wss://`, so put a TLS terminator in front if you host it that way.

Useful endpoints while it is running:

| Endpoint | What it says |
|---|---|
| `/health` | `{ok, rooms, players, up}` — good enough for a container health check |
| `/rooms` | every open room: code, headcount, biome, depth, age |
| `/room/ABC123` | one room |

A room lives as long as somebody is in it, plus two minutes' grace so a player
who crashes can come straight back to the same code.

---

## 2. Controls

| | |
|---|---|
| **W A S D** | Move |
| **Mouse** | Look |
| **Left Mouse** | Fire / attack |
| **Right Mouse** | Aim down sights |
| **R** | Reload |
| **Shift** | Sprint (costs stamina) |
| **Ctrl** or **C** | Crouch |
| **Space** | Jump |
| **E** | Interact / pick up / search / forage |
| **F** | Flashlight |
| **1 – 5** | Quick slots (in the inventory: assign the selected item) |
| **Mouse wheel** | Cycle weapons |
| **Q** | Use the most appropriate medical item |
| **V** | Bare-handed shove |
| **Tab** | Inventory |
| **M** | Distance to the nearest unexplored place |
| **Esc** | Pause |
| **F3** | Performance overlay · **F11** Fullscreen |

Sprint, crouch and aim can each be switched from hold to toggle in
**Settings → Controls**.

### If you cannot look around

Looking around normally uses **pointer lock** — the browser hands the game the
mouse and hides the cursor. Browsers refuse that more often than you would
think: inside an iframe without permission, under some managed-browser
policies, for about a second after you press **Esc**, and on a few
remote-desktop and trackpad driver combinations that grant the lock and then
report no movement at all.

The game now detects every one of those, including the last one, and switches
itself to **cursor look**: move the mouse or trackpad to look, and **push the
pointer into the edge of the screen** to keep turning past it. The edge that
is driving the turn lights up so it is obvious what is happening, and a
message tells you why the game changed. Nothing else about play changes.

If it still feels wrong, **Settings → Controls** has the three levers:

| Setting | What it does |
|---|---|
| **Look mode** | `AUTO` captures the mouse and falls back on its own. `MOUSE CAPTURE` forces the normal path. `CURSOR / TRACKPAD` skips capture entirely and works everywhere. |
| **Trackpad boost** | A trackpad moves the pointer a fraction as far as a mouse for the same gesture. Detected automatically; force it on or off here. |
| **Edge turn speed** | How fast the screen edges keep you turning under cursor look. Set to `OFF` if you would rather they did not. |

The panel at the top of that screen always says which mode is actually
running, so you never have to guess.

### Co-op

| Key | Action |
|---|---|
| **Enter** | Talk to the squad (one line, over the HUD — nothing pauses) |
| **M** | Mark where you are looking; in co-op the whole squad sees the mark |
| **E** | Get a downed teammate back on their feet |
| **N** | Hide/show waypoints, the guide light and squadmates |

### Controller — Xbox or PlayStation

Plug in or pair a controller and **press any button on it**; browsers hide
gamepads until they receive input. Both pads use the standard mapping, so the
layout is identical and only the on-screen glyphs change (✕/○/□/△ on a
DualSense, A/B/X/Y on an Xbox pad).

| | |
|---|---|
| **Left stick** | Move · **click** to sprint |
| **Right stick** | Look · **click** to melee |
| **R2 / RT** | Fire (analog break point, so a light pull does not fire) |
| **L2 / LT** | Aim down sights |
| **○ / B** | Crouch |
| **✕ / A** | Jump |
| **□ / X** | Interact, or reload when there is nothing to interact with |
| **△ / Y** | Swap weapon |
| **L1 / LB** | Flashlight |
| **R1 / RB** | Medical item |
| **D-pad** | Quick slots |
| **Touchpad / View** | Inventory |
| **Options / Menu** | Pause |

The layout presets are the ones Call of Duty ships — **Default**, **Tactical**
(crouch on right stick click) and **Bumper Jumper** — plus **Southpaw** stick
swapping. **Settings → Controller** also has the aim response curve
(standard/linear/dynamic), separate look and ADS sensitivities, independent
per-stick deadzones, rumble, and aim assist strength.

Aim assist is the two-part kind a console shooter actually uses: **reticle
slowdown** near a target so the stick stops overshooting, and **rotational
tracking** scaled by how hard you are already turning, so it helps you track
but will not aim for a player who is not trying. Both are gated on line of
sight, so the reticle never sticks to something through a tree, and both are
off for mouse input.

Menus are fully navigable from the pad, and the game does not pause when it
loses pointer lock while a controller is connected.

---

## 3. Project structure

```
blackroot/
├── index.html               boot sequence, menus, HUD markup (all UI is DOM)
├── styles/ui.css            complete UI theme
├── assets/icon/             app icon: SVG masters, PNGs 16–1024, favicon.ico
├── build.mjs                esbuild bundler -> dist/
├── serve.mjs                zero-dependency static dev server
├── server.mjs               dedicated co-op server: files + the hub on /net
├── server/
│   ├── wsock.js             a small RFC 6455 server, so there is no ws dependency
│   ├── rooms.js             rooms, codes, player limits, what the server arbitrates
│   └── protocol.js          what a room does with a message — shared with the browser
├── scripts/
│   ├── main.js              entry point
│   ├── core/
│   │   ├── GameManager.js   renderer, two render passes, state machine, frame loop
│   │   ├── Settings.js      persisted options, quality presets, difficulty tables
│   │   ├── Input.js         keyboard/mouse, pointer lock, action mapping
│   │   ├── AudioManager.js  the entire procedural audio engine
│   │   ├── Music.js         the score: seven palettes, five layers, lookahead scheduling
│   │   ├── Gamepad.js       Xbox / DualSense mapping, deadzones, aim assist
│   │   └── RNG.js           seeded PRNG + value noise / fBm / ridged noise
│   ├── world/
│   │   ├── Biomes.js        the six place descriptors + the seeded route
│   │   ├── Flora.js         recursive tree grower + every species' geometry
│   │   ├── Terrain.js       heightfield, creek + lake carving, surface materials
│   │   ├── Vegetation.js    instanced forest, chunk streaming, collider hash, wind
│   │   ├── Landmarks.js     the 12 set pieces, their loot themes and the notes
│   │   ├── Textures.js      every texture, plus normal/roughness derived from them
│   │   ├── Bake.js          collapses static props to one mesh per material
│   │   └── WorldManager.js  sky, lighting, raycast, line of sight, interactables
│   ├── player/
│   │   ├── PlayerController.js  grounded FPS movement, collision, head bob, recoil
│   │   ├── PlayerStats.js       health, stamina, hunger, thirst, bleeding, effects
│   │   └── Flashlight.js        hand-held spotlight, battery, cone queries
│   ├── systems/
│   │   ├── Armoury.js       loadout hub: preview scene, all five tabs
│   │   ├── WeaponForge.js   4.29 billion procedurally generated weapons
│   │   ├── Attachments.js   7 slots, stat folding, attachment geometry
│   │   ├── CamoGenerator.js 4.29 billion finishes, drawn from their seed
│   │   ├── GunDress.js      the one place a weapon gets its build put on it
│   │   ├── Upgrades.js      per-weapon tuning tracks and armoury points
│   │   ├── ItemDatabase.js      every item, weapon and loot table
│   │   ├── InventorySystem.js   stacked slots, weight budget, quick slots
│   │   ├── WeaponSystem.js      ADS, spread, recoil, reloads, melee arcs, hitscan
│   │   ├── ViewModels.js        procedural first-person weapon meshes
│   │   ├── DamageSystem.js      the single damage pipeline
│   │   ├── InteractionSystem.js the reusable "look at it and press E" pipeline
│   │   ├── LootSystem.js        pickups, foraging nodes, containers, corpses
│   │   ├── HorrorDirector.js    dynamic pacing and encounter budget
│   │   ├── Waypoints.js         objective picking, world beacon, HUD markers
│   │   ├── Sandbox.js           40 mods across 6 groups, and the tutorial script
│   │   ├── FX.js               pooled tracers, sparks, blood, muzzle flash, motes
│   │   └── SaveManager.js      single localStorage slot
│   ├── entities/
│   │   ├── Bosses.js        six bosses: models, phases, weak points, attacks
│   │   ├── OperatorModel.js the player character, for the armoury preview
│   │   ├── Entity.js            base: movement, avoidance, animation, perception
│   │   ├── MutantAI.js          nine archetypes, four behaviours, biome rosters
│   │   ├── AnimalAI.js          rabbit / deer / boar / wolf / bear
│   │   ├── EntityManager.js     population, LOD ticking, alerts, bullet hit tests
│   │   └── CreatureModels.js    procedural creatures with named joints
│   ├── net/
│   │   ├── NetClient.js     the co-op session: protocol, retries, world sync
│   │   ├── LocalHub.js      the same rooms, run between browser windows, no server
│   │   └── RemotePlayer.js  another player's avatar, interpolated ~110 ms behind
│   └── ui/
│       ├── UIManager.js     HUD, menus, settings, inventory, notes, death screen
│       ├── ModMenu.js       the sandbox menu, generated from the mod table
│       └── CoopMenu.js      the lobby, the squad readout and in-game chat
└── tools/
    ├── smoketest.mjs        automated headless playtest — 60 assertions
    ├── nettest.mjs          real server + two real browsers — 45 assertions
    ├── looktest.mjs         every way the mouse can fail to look — 46 assertions
    ├── ghostguntest.mjs     nothing leaks into the view scene between runs — 12 assertions
    ├── guidetest.mjs        the morning grade and the guide light — 22 assertions
    ├── localcooptest.mjs    co-op with no server running anywhere — 22 assertions
    ├── perftest.mjs         the numbers that decide how a frame feels — 15 assertions
    ├── difficultytest.mjs   whether the game is survivable — 17 assertions
    ├── weapontest.mjs       weapons, optics, attachments — 36 assertions
    ├── padtest.mjs          controller mapping and aim assist — 25 assertions
    ├── biometest.mjs        every biome, flora and boss — 50 assertions
    ├── audiotest.mjs        measured audio output — 23 assertions
    ├── sandboxtest.mjs      every mod and the tutorial — 30 assertions
    ├── armourytest.mjs      the loadout hub end to end — 42 assertions
    ├── biomeshots.mjs       reference captures of every biome, boss and mutant
    ├── netshots.mjs         reference captures of the co-op surfaces
    ├── rendermusic.mjs      renders the score to a wav for listening to
    ├── profile.mjs          per-system frame cost breakdown
    ├── make-icon.mjs        generates the icon SVGs (the tree is grown, not drawn)
    ├── render-icon.mjs      rasterises every icon PNG, the .ico and a contact sheet
    ├── screens.mjs          full-resolution screenshot capture
    ├── probe.mjs            render/viewmodel state inspection
    └── filetest.mjs         verifies dist/BLACKROOT.html runs off file://
```

---

## 4. Systems implemented

### World
- **Seeded procedural terrain**, 1024 × 1024 m with a ~430 m playable radius
  ringed by impassable cliffs. A 513² heightfield is authoritative: the render
  mesh, collision, foliage scatter, AI navigation and bullets all sample the
  same array, so nothing can disagree about where the ground is.
- A **carved creek** that meanders the length of the map and a **lake** with a
  proper basin; both have real water surfaces you can wade into and drink from.
- **~7,600 trees, 4,600 bushes, 6,200 ferns, 21,000 grass tufts, 1,500 rocks**
  and fallen logs, placed by moisture and slope, uploaded as `InstancedMesh`
  per 128 m chunk and streamed by distance. Trunks double as collision
  cylinders in a flat spatial hash that the player, creatures and bullets all
  query. Canopy, bushes, ferns and grass all sway in a shared wind shader.
- **12 landmark types**, each with a purpose: abandoned campsite (the spawn),
  ranger station (medical cabinet, working field radio, district map), hunting
  cabin (food and shotgun shells), ruined cabin, crashed van with a road stub,
  military checkpoint (best weapons, worst neighbours), cave (a genuinely dark
  tunnel with a cache at the end), radio tower (a 38 m lattice with a turning
  beacon visible across the map — the run's compass), grave site, mutant nest,
  lakeside dock, collapsed bridge. Placement is seeded but constrained:
  minimum separation, walkable ground, the tower always on the highest ground.
- **Night sky**: gradient dome, 1,400 stars, a moon that casts real shadows
  from a frustum that follows the player, exponential-squared fog, and a
  dynamic point-light budget that keeps only the nearest few landmark lights
  alive.

### Player
Separate acceleration and friction, gravity, jump, crouch with stance
blending, sprint tied to stamina, air control, step-up onto 0.55 m ledges,
walking on cabin floors and station decks, wading, fall damage above 6 m,
landing camera compression, head bob, view roll on strafe, exhaustion
breathing, a recoil spring, and footsteps that query the terrain for the
surface material underfoot.

### Difficulty

The old NORMAL was, in practice, a hard mode: full incoming damage, no health
recovery of any kind, and a forest full of things faster than you. The ladder
moved down a rung — what used to be NORMAL is now **HARSH**, what used to be
HARSH is **BRUTAL**, both unchanged for anyone who wants them.

| | Damage taken | Damage dealt | Enemies | Loot | Recovery |
|---|---|---|---|---|---|
| **STORY** | ×0.28 | ×1.70 | ×0.45 | ×1.80 | 7 hp/s after 2.5 s, to full |
| **NORMAL** *(default)* | ×0.58 | ×1.32 | ×0.72 | ×1.40 | 4.2 hp/s after 4.5 s, to 85% |
| **HARSH** *(the old normal)* | ×1.00 | ×1.00 | ×1.00 | ×1.00 | 1.6 hp/s after 9 s, to 50% |
| **BRUTAL** | ×1.60 | ×0.85 | ×1.45 | ×0.72 | none |

Two things matter more than the multipliers. **Out-of-combat healing**: thirty
seconds of quiet takes you from 30 hp to about 89, so a run is no longer
decided by the first bad thirty seconds. It stops the moment anything hits you
and does not run at all while you are bleeding, so a bandage is still worth
carrying. And a **recovery window after each hit** — 0.6 s on NORMAL — because
two creatures reaching you at the same time used to take turns removing a third
of your health with nothing you could do about it, and dying to that reads as
the game cheating rather than as a mistake you made.

You also wake up with more: 64 rounds instead of 30, five bandages instead of
two, and a trauma kit.

### Survival
Health, stamina, hunger, thirst, bleeding stacks, poison, and timed effects
(regeneration, painkiller resistance, stamina boost). Hunger throttles stamina
regeneration; thirst and starvation eventually kill. Three difficulty presets
scale damage, drain rates, mutant density and loot.

### Combat
Seven firearms (9 mm sidearm, .357 revolver, 12-gauge pump, .308 bolt rifle,
9 mm SMG, 5.56 carbine) and three melee weapons, each with its own damage,
magazine, fire rate, reload style (magazine, shell-at-a-time, bolt), recoil,
spread, ADS time, sway and effective range. Spread reacts to movement, stance,
airtime, stamina and injury. Shotguns fire eight independent pellets.
Magazines are tracked per weapon; reserve ammunition lives in the inventory.
Hitscan resolves against creature head and body capsules (headshot
multipliers), structure boxes, tree cylinders and the terrain, whichever is
closest — so trees really do stop bullets.

### AI
Eight-state machine (`IDLE PATROL INVESTIGATE STALK CHASE ATTACK FLEE DEAD`)
shared by four mutant archetypes that read it very differently:

- **Stalker** — keeps trunks between itself and you, holds still and watches,
  closes only when you look away, commits permanently once it knows it has
  been seen.
- **Brute** — 340 HP, armoured, slow, charges in straight lines, shoves you
  off your feet.
- **Crawler** — low in the undergrowth, fast, weaves, ambushes.
- **Screamer** — avoids melee; its call drags every mutant within 95 m to your
  position.

Wildlife behaves like wildlife rather than slower mutants: rabbits bolt, deer
graze and flee in arcs, boar ignore you until crowded then charge and
disengage, wolves circle in packs of 2–4 and howl to gather, bears are rare
and catastrophic. Everything reacts to gunshots (130 m), footsteps, and being
caught in your flashlight beam. AI is ticked at 1/1, 1/2, 1/6 or 1/120 rate by
distance band.

### Places to go

Each world is built from its own set pieces, not from a recoloured copy of the
Hollow's. Between eighteen and twenty-six landmarks per world, and every world
owns shapes the others do not have:

| World | Its own places |
|---|---|
| **The Hollow** | Logging deck — a stack of logs you can climb, a skidder, and a field of stumps that stops halfway through a row |
| **The Long Dark** | The Orrery, stone rings still turning on a tilted plinth (the one landmark in the game that moves); the Standing Slabs, some of them hanging off the ground because gravity here is a suggestion |
| **The Drowned Shelf** | A trawler hulk on its side with a deck you can climb onto; the Ribs — the arched ribcage of something far too large, which you walk down the middle of |
| **Cinder Reach** | The Burning Tower, a fire lookout that burned and is still burning; slag fields of hexagonal basalt columns around a glowing fissure |
| **The Still White** | The Frozen Fall, a waterfall caught mid-fall with a hollow behind it; an expedition camp with a line of marker poles spaced further and further apart until whoever was planting them stopped |
| **The Bloom** | The Cap Grove — mushrooms the size of trees, one cap low enough to climb, lit from underneath by their own gills; the Spore Hive |

The generic ruins — camps, graves, wrecks, caves, nests — are shared, because
those would plausibly have been dragged anywhere. A timber hunting cabin has
no business on a sea floor, and no longer turns up on one.

**All six are reachable from the sandbox mod menu**, under **WORLDS**: pick
one and press *Go there* and it is built for real — its terrain, sky, flora,
creatures and its own landmarks — with every mod you have set still on. *Take
me to a landmark* drops you at one of them; *What is out here?* names the
nearest six and how far away they are.

### Biomes and the rift

Six places. The first is always the Hollow; the rest are shuffled by the run
seed, so two players on the same seed take the same road and no two seeds take
the same one. A biome is a **descriptor**, not a second world generator —
terrain shaping, ground palette, sky gradient, star count and tint, nebula,
fog colour and density, tone-mapping exposure, moon colour and size, ambient
light, flora species, foliage densities, weather, physics, creature roster and
boss all read their numbers from one object. That is why the collision hash,
the wind shader, chunk streaming, AI cover queries and the save system all
keep working in places they were never specifically written for.

| Biome | What is different about being in it |
|---|---|
| **The Hollow** | Black pine and wet leaf litter. A creek, a lake, and the rules you learn everything else against. |
| **The Long Dark** | 42% gravity, jumps half again as high, five thousand stars over a procedural nebula, obsidian and crystal instead of trees. |
| **The Drowned Shelf** | The whole map is under one water surface. Neutral buoyancy, heavy drag, free swimming in three dimensions, kelp and coral, bubbles rising past you. |
| **The Cinder Reach** | A burn that never went out. Charred spars, ember undergrowth, orange fog, embers lifting on their own heat. |
| **The Still White** | Frozen conifers and ice crowns, snow falling, the brightest moon in the game and the least to see by it. |
| **The Bloom** | Fungal overgrowth, glowing gills, spore fall thick enough to cut the view distance in half. |

Killing a biome's boss tears a **rift** where it fell — a turning ring of light
you walk into. Everything you are carrying comes with you; everything you left
on the ground does not. Difficulty scales with **depth**, not with which place
you happened to draw, so the shuffle never makes a run unwinnable.

### Bosses

One per biome, and no two fight the same way.

- **The Warden of the Hollow** — what the rangers became, all of them at once.
- **The First Chorister** — three counter-rotating rings of shards around
  something that is only a voice.
- **The Gill-Father** — an anglerfish the size of a bus, walking on its fins.
- **The Pyre-King** — nine years on fire and not finished.
- **The Hoar Mother** — a woman inside the glacier that grew out of her.
- **The Mother Stalk** — the fruiting body of every fungus in the valley.

Each has **three phases** with their own speed, move set and announcements;
**named weak points** with their own damage multipliers, some hidden until a
later phase (armour plate takes about 47 damage from a shot that does 324 to
the Warden's heart); **telegraphed attacks** with a visible wind-up so nothing
hits you without showing you first; and an **arena** it will not be kited out
of. A boss that summons pulls from its own biome's roster.

### Creatures

Nine mutant archetypes, designed **silhouette first** — every one has to be
identifiable as a dark shape at forty metres, because that is usually all the
information the player gets. The test suite proves it: it rasterises each
creature's front elevation into a 12×20 occupancy grid and asserts that the
closest pair still differ in at least 24 of 240 cells.

| | |
|---|---|
| **Stalker** | Tall, thin, backward knees, no head shape at all — a smooth bulb that splits vertically into a maw. |
| **Brute** | A wide asymmetric wedge: one fused bone club for an arm, ribs splayed open like a cage door, skull sunk into the shoulders. |
| **Crawler** | A torso hauled face-up by six spider arms, head hanging backwards so it can watch you while the body runs the other way. |
| **Screamer** | A walking horn — the ribcage hinged open into a bell around a throat sac, jaw unhinged to the sternum. |
| **Choir** *(Long Dark)* | No legs. A hovering cruciform inside a ring of turning shards, lit from inside its own cracks. |
| **Drowned** *(Drowned Shelf)* | Bloated and half-transparent, with a lure on a stalk that is the only part you see until it is far too close. |
| **Ashwalker** *(Cinder Reach)* | A cracked crust with light leaking out of it, leaning, one arm burnt back to the bone and far longer for it. |
| **Rimewretch** *(Still White)* | Caged inside its own ice, under a fan of spines wide enough to read as a shape of its own. |
| **Sporebearer** *(Bloom)* | Stooped under the cap that replaced its head. Its death is its most dangerous moment. |

Behaviour is declared separately from appearance — `stalk`, `charge`, `swarm`
and `call` — so a biome can introduce a creature that looks like nothing you
have seen and still moves like something you have learnt to read.

### The armoury

A create-a-class hub reachable from the main menu and the pause screen, with a
live 3D turntable drawn by the **main renderer** into a scene of its own — not
a second WebGL context, because a second context costs an entire extra GL
state machine and, on integrated graphics, frequently costs you the first one.
The preview is assembled by exactly the same code that dresses the gun in your
hands, so the two can never drift apart.

- **Weapons** — seven hand-authored weapons plus **4,294,967,296 forged
  variants**. Each forged weapon is a pure function of a 32-bit seed: chassis,
  tier (Field → Marked → Issued → Relic → Blackroot), stat rolls, up to three
  trade-off traits, manufacturer name and a factory-fitted build all fall out
  of the same number. They are real items — equippable, saveable, and
  recoverable from eight hex digits. Clicking one swaps the model on the
  stand.
- **Attachments** — all seven slots, with each option's stat changes shown as
  green and red deltas before you fit it.
- **Finishes** — **4,294,967,296 camo patterns**, 18 families × 18 palettes ×
  2³² seeds, with rarity tiers. Nothing is stored; the code *is* the camo, so
  typing a code recovers any of them exactly.
- **Upgrades** — six permanent tuning tracks per weapon, bought with armoury
  points earned by surviving (two a kill, four a landmark, one every two
  minutes on your feet), with an exact refund if you change your mind.
- **Operator** — the player character at 1.80 m and roughly 7.5 heads, built
  from capsule limbs and spherical joints rather than stacked boxes, with 28
  options across headgear, face covering, torso, legs, complexion and
  colourway.

### Horror director
Tracks time since the last encounter, health, ammunition, location, distance
walked and noise, and spends a budget on tension: a branch snapping behind
you, a scream two ridges over, wolves gathering, a silhouette at the treeline
that fades once you have looked at it for a second and a half, or a real
mutant moved in from out of sight to start stalking. Hard rules: nothing
spawns in your forward arc, nothing within 26 m, nothing in line of sight,
and never while you are already fighting. Its dread value also drives the
score and thins the insect ambience as things get worse.

### Audio
A complete procedural engine — noise buffers, oscillators, biquad filters, a
generated convolution impulse for the outdoor tail, HRTF panners, and a
compressor. Gunshots are built per weapon profile from a crack, a body thump
and a forest tail; footsteps are filtered noise shaped by surface; the wind
bed, canopy hiss and insect layer are looping filtered noise with LFOs. Every
cue is replaceable with a real sample through
`Audio.replaceWithSample(name, buffer)`.

The **score** is generated rather than looped. A director schedules two
seconds ahead of the audio clock — the only way to get music that does not
stutter behind a frame spike — across five layers (pad, bass, motif,
percussion, shimmer) over one of seven palettes, one per biome plus the menu.
Dread moves the arrangement rather than only the volume: layers enter and
leave, the mode darkens, the pulse tightens. `node tools/rendermusic.mjs`
renders a stretch of it to a wav if you want to listen to it on its own.

### Co-op
Up to eight players per six-character code, on a dedicated server you run
yourself (`npm run server`). The server is one dependency-free Node process
holding rooms in memory — the WebSocket protocol is implemented in
`server/wsock.mjs` rather than pulled in, because a co-op server that a player
can clone and start without a build step is worth two hundred lines.

The split of authority follows from the fact that this is co-op against the
world, not a competitive game. The server never simulates the forest — it
could not, without shipping the world generator twice. Instead it owns exactly
what everybody has to agree on: the run seed and the road through the biomes,
which biome the party is in, the shared clock, the boss's health and phase
(credited across everyone shooting it), and who is down. Everything else —
terrain, wildlife, your own footing — each client generates locally from the
shared seed, which is why two people on the same code walk an identical map
without the server ever sending a single tree.

Movement is client-authoritative, because latency compensation for eight-player
PvE costs more in input lag than it buys. The server still caps impossible
movement, and it *clamps* rather than discards it: holding the old position
would leave the server permanently behind the real player and get them kicked
a few seconds later for continuing to exist.

Everyone else in the world is drawn ~110 ms in the past, interpolated between
the two snapshots bracketing that moment, so nobody teleports. They wear their
own operator build, walk with a stride that lengthens with their speed, carry
a torch you can see across a valley, appear on your waypoint HUD and in a
squad readout with their health, and lie down where they fell so you can go
and pick them up with **E**. Losing the server drops you into single-player and
reconnects in the background; nothing in the game loop depends on a message
having arrived.

### UI
Studio splash → content advisory → title → main menu. Minimal HUD (four
condition bars, weapon, magazine/reserve, five quick slots, interaction
prompt, compass with discovered landmarks, toasts, subtitles, objective line).
Full inventory screen with icons, descriptions, per-item stats, weight budget,
use/equip/drop and quick-slot assignment. Pause, four-tab settings, credits, a
note reader for the environmental story, and a death screen with a run summary.

### Save
One localStorage slot. The world is regenerated from its seed rather than
serialised, so a save is only the mutable state — position, condition,
inventory, magazines, which pickups are gone, which containers are open, which
notes are read, which landmarks are found. Autosaves every two minutes.

---

## 5. Testing

```bash
npm test                      # headless playtest — 60 assertions
node tools/weapontest.mjs     # weapons, attachments, optics, camo — 36
node tools/padtest.mjs        # controller, aim assist, menus — 25
node tools/armourytest.mjs    # loadout, forge, finishes, upgrades, operator — 42
node tools/biometest.mjs      # biomes, bosses, monsters, the rift — 50
node tools/audiotest.mjs      # measured output of every cue and the score — 23
node tools/sandboxtest.mjs    # all 40 mods and the tutorial — 30
npm run looktest              # every way the mouse can fail to look — 46
npm run ghosttest             # no viewmodel survives into the next run — 12
npm run guidetest             # the morning grade and the guide light — 22
npm run localtest             # co-op with no server running at all — 22
npm run perftest              # draw calls, static scene, shader hitches — 15
npm run difftest              # is it actually survivable — 17
npm run nettest               # a real server and two real browsers — 45
npm run hostedtest            # the hosted build, embedded, no pointer lock — 30
npm run roblox:test           # the Roblox port + parity vs the JS — 868
npm run verify                # confirms dist/BLACKROOT.html runs off file://
node tools/profile.mjs        # per-system frame cost breakdown
node tools/biomeshots.mjs     # reference captures of every biome and creature
node tools/netshots.mjs       # reference captures of the co-op surfaces
```

**503 assertions across fifteen suites**, all passing, plus **868
checks** over the Roblox port (§11). Every one of the fourteen drives the real
game in a real browser — there are no mocks anywhere. `nettest` goes
further and starts the actual `server.mjs` as its own process, then opens two
independent headless clients against it: one hosts, the other joins with the
code it was handed, and the suite checks that they generated byte-identical
terrain, that each can see the other walk, shoot, mark a spot, talk, go down
and be picked back up, that the host taking the rift brings the party, and
that killing the socket drops the survivor into single-player instead of
taking the game down with it.

`npm test` launches the game in headless Chromium, drives it through the boot
sequence into gameplay and then actually plays it: walks, sprints, crouches,
jumps, gets pushed out of a tree, toggles the lamp, fires and reloads every
weapon in the game, shoots a mutant to death, gets attacked, watches a deer
flee and a wolf close in, picks up loot, forages a plant, eats a tin, uses a
trauma kit, opens the inventory, pauses, changes a setting, saves, dies,
restarts, and checks for console errors and runaway spawning. Add `--shots` to
write screenshots to `tools/shots/`.

Two notes on the harness. First, it runs on SwiftShader, a CPU rasteriser that
manages 1–3 fps on this scene, so its raw frame rate says nothing about real
hardware; the test therefore asserts the hardware-independent number — the CPU
frame budget (simulation plus the cost of submitting both render passes),
which comes in around 6–8 ms/frame with 108 live creatures, leaving the rest
of a 60 fps frame to the GPU. Second, because of that frame rate every wait in
the test is expressed in *simulated* seconds rather than wall clock, so the
results do not change when the machine is loaded.

The tests have already earned their keep. They caught a movement bug where
friction and acceleration fought each other (the player topped out at 1.8 m/s
instead of 3.5), creatures that orbited just outside melee range because
obstacle avoidance never relaxed on the final approach, a bundler bug where
`$` sequences in the minified output silently corrupted the single-file build,
and — from `nettest` — two networking faults that no amount of reading would
have found: a refused connection whose stale `onclose` fired *after* the
connection that replaced it and quietly left that session able to receive but
never send, and an interpolation buffer stamped from the simulation clock,
which on a slow machine gave every packet in a frame the same timestamp and
threw all but one of them away as duplicates.

`looktest` is the same idea applied to the mouse. It patches
`requestPointerLock` before the game loads so the browser genuinely behaves
like a broken one — throwing, resolving and never locking, firing
`pointerlockerror`, or granting the lock and reporting `movementX === 0`
forever — and then asserts the only thing that matters: *did the view actually
turn*. It caught an ordering bug where abandoning a dead lock fired
`pointerlockchange` before the fallback was up, so the game paused itself at
the exact moment it was trying to rescue the player's ability to look.

---

## 6. Performance notes

What the engine does before you touch a setting:

- **Static props are baked.** A landmark is authored as dozens of small meshes
  and drawn as a handful — 273 meshes across eighteen landmarks became 46,
  merged by material, with interactables, lights and anything that moves
  deliberately left out of the merge.
- **Nothing static recomputes its transform.** Scattered loot and built
  landmarks — a few thousand objects — are marked as never moving, so three.js
  stops rebuilding a world matrix for each of them sixty times a second.
- **Every shader is compiled before play starts**, including the depth
  variants used by the shadow map, warmed through a 64×64 target so it costs
  nothing. A program compiled the first time a material is *seen* is a visible
  hitch at the exact moment something walks out of the trees.

That comes to under 800 draw calls at the highest settings and 165 m of view
distance, with no mid-game shader compilation.

The levers, in order of impact: **render scale**, **view distance**,
**shadows**, **foliage density**. The ULTRA preset targets a modern discrete
GPU; LOW is aimed at integrated graphics.

For 4K output, set render scale to 1.00 in a 3840×2160 window; render scale
2.00 supersamples for downsampled anti-aliasing and is very expensive.
Foliage density applies on the next new game (it changes what gets scattered);
everything else applies immediately.

Techniques used: per-chunk `InstancedMesh` with distance culling, a separate
much shorter grass radius, a single-draw-call terrain mesh, distance-banded AI
ticking, preallocated particle and tracer pools, a capped dynamic light
budget, a moon shadow frustum that follows the player, analytic ray tests
against primitives instead of mesh raycasting, and a spatial hash for both
collision and interaction lookups.

---

## 7. Known limitations

- **The graphics are stylised, not photoreal.** Every surface in the game is
  generated at runtime from about a megabyte of code — there are no scanned
  materials, no photogrammetry, no authored meshes, and no texture budget to
  spend. Surfaces do carry proper PBR relief now (normal and roughness maps
  derived from each texture's own luminance, so bark, steel, plank and rock
  break light the way those materials do), and that is the difference between
  a coloured box and a material. It is not, and cannot be, the difference
  between this and a production with a hundred gigabytes of scanned assets
  behind it.
- **No skeletal animation.** Creatures and weapons are procedurally posed
  block-outs animated in code. Silhouettes and timing read correctly, but
  there is no motion capture, no blending and no inverse kinematics.
- **No crafting, base building or day/night cycle.** The game is a single
  fixed night by design; these were Priority 3 in the brief and are out of
  scope for the slice.
- **Cave interiors are short.** Each cave is one tunnel and one chamber rather
  than a network.
- **No enterable multi-storey buildings.** Structures are single-storey; the
  ranger station has a deck but no interior stair.
- **One save slot**, and no manual seed entry in the UI (the console accepts
  `BLACKROOT.startNewGame(0xDEADBEEF)`).
- **Anti-aliasing changes need a page reload**, because the WebGL context is
  created with it.
- **No navmesh.** Creatures steer locally: they avoid obstacles, detect when
  they have stopped making progress and commit to a tangential detour, and
  drop avoidance entirely over the last couple of metres so an attack actually
  lands. What they cannot do is *plan* a route, so a creature outside a cabin
  will circle the walls looking for the doorway rather than walking straight to
  it. Standing inside a building is therefore genuinely safer than it should
  be — the honest fix is a navigation mesh, which is out of scope here.
- **No mobile support.** Touch controls are not implemented; the input layer
  has the seam for them (`Input.setVirtualMouse`) but nothing is wired to it.
- **The armoury issues weapons.** Picking a weapon in the loadout menu gives
  it to you with ammunition, which sits oddly beside a scavenging survival
  loop. It is a deliberate concession to the create-a-class request; a
  stricter run should ignore the armoury and take what the forest gives it.
- **Forged weapons reuse the chassis models.** All 4.29 billion of them are
  real, distinct stat blocks with real names, traits and finishes, but a
  forged carbine is built on the carbine viewmodel. The variety is in the
  numbers and the paint, not in newly-modelled receivers.
- **Poisonous plants are not implemented** as a foraging risk — there is no
  identification system to make guessing fair, so all forage is safe. Drinking
  from the creek and the lake *can* poison you, which is the one place the
  risk is signposted by a note.
- Corpses sink away after 90 seconds to keep the world from filling with
  bodies.
- **Co-op across machines needs a server you run.** There is no hosted
  matchmaking service behind the code — `npm run server` on a machine everyone
  can reach *is* the service. On a LAN that is one command; over the internet
  it is a VPS, a tunnel, or a port forward, and https means putting a TLS
  terminator in front of it. Co-op *on one computer* needs none of that: the
  browser runs the room itself between windows.
- **Creatures are not replicated.** Each client populates and simulates its
  own mutants from the shared seed, so the party starts with an identical
  roster in identical places but drifts apart once anyone starts fighting: you
  and your friend can both be killing "the same" stalker independently. The
  boss is the exception — its health is arbitrated by the server, so it dies
  once, for everybody. Full creature replication is the honest next step and
  is a much larger job than the rest of the netcode put together.
- **Loot is not replicated either.** Two players can each pick up the same tin
  of food. Same cause, same fix.
- **No voice chat**, and text chat is a single line with no history panel in
  game (the lobby keeps a log).

---

## 8. The icon

`assets/icon/` holds the app icon: a bare tree whose root system mirrors its
branches, standing in a cone of lamp light. It carries the title, the core
mechanic (the flashlight is the only thing out there that reliably works) and
the line from the ration box in the caves — *the roots are wrong first*.

There are two masters rather than one. `icon.svg` is the full-detail mark, used
from 128 px up; its tree is **grown recursively from a fixed seed** rather than
drawn by hand, so the branching stays organic and retuning it means changing
numbers instead of redrawing bezier paths. `icon-small.svg` is a deliberately
cruder mark — one trunk, four branches, five roots, all thick enough to survive
a 16 px downsample — because the grown tree collapses into a featureless bar at
small sizes. PNGs at 16–64 come from the small master, 128 and up from the full
one, and `favicon.ico` carries seven resolutions.

| Target | Use |
|---|---|
| Web | `favicon.ico`, or the 32 px PNG (already inlined in the game's `<head>`) |
| macOS | `icon-1024.png` → `.icns` via `iconutil` |
| Windows | `favicon.ico` or `icon-256.png` |
| Linux | `icon-256.png` / `icon-512.png` |
| Electron / Tauri | point the bundler at `icon-1024.png` and `favicon.ico` |
| PWA / Android | `icon-192.png` and `icon-512.png` |

```bash
node tools/make-icon.mjs      # rebuild both SVG masters
node tools/render-icon.mjs    # rasterise every PNG, the .ico and a contact sheet
```

Only the 32 px favicon is inlined as a data URI, to keep the single-file build
self-contained without adding 40 KB of icon to it; everything larger ships as a
file for whoever packages the game.

---

## 9. Dependencies

- **three.js 0.169.0** (MIT) — the only runtime dependency, bundled into the
  build.
- **esbuild 0.24.0** — build-time only.
- **playwright 1.49.0** — test-only.

The dedicated co-op server has **no dependencies at all** — not even a
WebSocket library. `server/wsock.mjs` implements the handshake, framing,
fragmentation and ping/pong itself so that `npm run server` works on a bare
Node install, on any machine, with no build step and no native modules.

No network access at runtime *except* co-op, which talks only to the server
address you type in. No telemetry. No external fonts (the UI falls back
through system display and monospace stacks).

---

## 10. Replacing the placeholder assets

The project was structured so that art can be dropped in without touching
gameplay code.

**Creatures.** `entities/CreatureModels.js` exposes one factory per creature
in `CREATURE_FACTORIES`. Each returns a `THREE.Group` whose origin is at the
feet and whose `userData.parts` names the joints (`torso`, `head`, `neck`,
`jaw`, `arms[]`, `legs[]`, `eyes[]`). Replace a factory with a glTF loader and
keep those names, and `Entity.animate()` keeps working. To move to real
skeletal animation, swap `Entity.animate()` for an `AnimationMixer` and drive
clips from `this.state` — the state machine already emits everything you need
(`IDLE/PATROL/CHASE/ATTACK/FLEE`, plus `flinch`, `lungeTimer` and
`_fallAmount` for hits and death).

**Weapons.** `systems/ViewModels.js` builds each first-person weapon and tags
it with `userData.muzzle` and `userData.sight`. Load a real mesh, set those two
anchors, and ADS alignment, muzzle flash placement and tracer origin all
follow automatically. `HIP_POSE` holds the resting transform per weapon.

**Textures.** `world/Textures.js` is a set of pure functions returning
`THREE.Texture`. Replace any one with a `TextureLoader` call — the callers only
care that they get a texture back, and quality tiers are already plumbed
through.

**Audio.** Call `Audio.replaceWithSample('gun.rifle', decodedBuffer)` for any
cue; the synth path stays as the fallback. The `_panner()` helper already
handles 3D placement, distance rolloff and the reverb send.

**Terrain.** `Terrain.rawHeight()` is the one function to swap for a
heightmap-image sampler; the mesh, collision, foliage and AI all derive from
it, so a real heightmap flows through the whole game for free.

For a production pass I would add: skeletal creature animation with hit
reaction layers, hand-modelled weapons with proper reload animations,
photo-scanned bark/ground/rock materials with roughness and AO maps, alpha-
tested canopy cards instead of solid cones, a GPU-driven grass system,
cascaded shadow maps, SSAO, temporal anti-aliasing, and recorded foley for
footsteps, weapons and creature vocalisations.

---

## 11. Roblox

`roblox/` is a separate, self-contained port of BLACKROOT to Roblox, together
with the tooling to publish it. It has its own README — read
[`roblox/README.md`](roblox/README.md) before touching anything in there.

The short version: **the WebGL build cannot be exported to Roblox.** There is
no converter and there cannot be one — three.js and Roblox share no renderer,
scene graph, physics engine, input model or scripting language. So the port is
written from scratch in Luau, reusing the design rather than the code — but
every *number* is transcribed rather than re-invented, and a test suite
compares the two codebases field by field so they cannot drift apart.

**Getting it into Studio needs nothing installed.** `roblox/build/` already
holds two built files: open **`BLACKROOT.rbxlx`** with File → Open from File…
for the whole game as its own place, or insert **`BLACKROOT-scripts.rbxmx`**
into a place you already have (right-click a service → Insert from File…) and
drag its three labelled folders where their names say.

The tooling is for working on it and shipping it:

```bash
npm run roblox:place      # rebuild both files from the Luau sources
npm run roblox:test       # 868 checks, incl. full JS-vs-Luau parity
npm run roblox:sync       # serve the sources to Studio (leave running)
npm run roblox:plugin     # install the Studio plugin
npm run roblox:bot -- whoami     # check your Open Cloud key
npm run roblox:bot -- publish    # upload it, live
```

**The bot** (`roblox/tools/bot.mjs`) publishes places, pushes live messages to
running servers, reads and writes DataStores, and patches product ids into the
Luau catalogue. It authenticates with a Roblox Open Cloud API key that you
create, read from `ROBLOX_API_KEY` in your environment — never from a file in
this repository, never from a command-line argument, and scrubbed from the
bot's own error output. It never asks for an account password or cookie.

**The Studio plugin** (`roblox/plugin/`) is how the bot reaches Studio. Studio
cannot read your disk and has no remote-control API, so the plugin fetches the
source tree over HTTP from `127.0.0.1` and rebuilds the instances — the same
mechanism Rojo uses, and `default.project.json` is a valid Rojo project if you
would rather use that.

**Parity is enforced, not promised.** `npm run roblox:test` parses both
codebases and compares them field by field: all 9 weapons, 18 items, 14 loot
tables, 21 attachments, 6 upgrade tracks, the forge and camo generators, 9
mutants, 5 animals, 6 bosses with their phases and weak points, 7 biomes'
physics and sky, 43 sandbox mods and the mulberry32 generator. Change one
number on one side and the suite fails by name and value.

Three things genuinely cannot cross: runtime-synthesised **audio** (Roblox
plays uploaded assets, it has no Web Audio), runtime-drawn **camo textures**
(no canvas — the generator survives and resolves to materials instead of
pixels), and the **renderer** itself. Everything else is here.

**The store** sells six consumables (R$ 20–99) and four permanent passes
(R$ 79–199). Every product id in the repository is `0`: only you can create
products for your own experience, so the shop greys those entries out and says
"not configured" until you fill them in. Nothing sold is purchase-only —
every consumable also drops in the world — and there are no random rewards.
`roblox/README.md` has the full catalogue, the pricing reasoning, and how
receipts are made safe against double-granting.

---

*All characters, creatures, locations, organisations, brands and events in this
work are fictional and original. This prototype is unrated and is not
affiliated with, endorsed by, or reviewed by the ESRB, PEGI, USK or any other
ratings authority; the in-game advisory notice is not an official rating.*
