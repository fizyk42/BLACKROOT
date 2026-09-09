# BLACKROOT for Roblox

A Roblox port of BLACKROOT, plus the tooling to publish it: a command-line bot
that talks to Roblox Open Cloud with your own API key, a Studio plugin that
syncs these sources into Studio, and a Robux storefront wired to
`MarketplaceService`.

---

## Read this first: what "publishing to Roblox" actually means

The WebGL build in the parent folder is about ten thousand lines of JavaScript
running on three.js and WebGL2. Roblox runs Luau inside its own engine. There
is **no exporter** — no tool, official or otherwise, that converts one into the
other, and there never will be, because they do not share a renderer, a scene
graph, a physics engine, an input model, or a scripting language.

So this folder is a **port**, written from scratch in Luau: the same systems,
the same numbers, the same feel, rebuilt on Roblox's engine.

### What "1:1" means here, precisely

Every **number** is identical, and that is enforced rather than promised.
`npm run roblox:test` parses both codebases and compares them field by field —
868 checks, of which more than four hundred are direct JavaScript-versus-Luau
comparisons. Change a stalker's health on one side and the suite fails by name:

```
✗ mutant parity: stalker
    health: js 105 vs luau 999
```

What is verified equal: all 9 weapons and 5 ammunition types, all 18 items,
all 14 loot tables, all 21 attachments, all 6 upgrade tracks, all 6 forge
chassis and 5 tiers and 12 traits, all 18 camo families and 18 palettes, all 9
mutants and 5 animals, all 6 bosses with their phases and weak points, all 7
biomes' physics and sky, all 43 sandbox mods, the difficulty ladder, the depth
scaling, and the mulberry32 generator every seed depends on.

| System | Status |
| --- | --- |
| Difficulty ladder (story / normal / harsh / brutal) | identical, verified |
| Health, stamina, hunger, thirst, bleeding, poison, battery | identical, verified |
| Out-of-combat regeneration, post-hit grace, downed-and-revived | ported |
| All 9 weapons — 3 melee, 6 guns — with spread, bloom, recoil, ADS | identical, verified |
| Bolt-action and shell-by-shell reloads | ported |
| All 21 attachments across 7 slots | identical, verified |
| All 6 upgrade tracks and their costs | identical, verified |
| Weapon forge — 6 chassis, 5 tiers, 12 traits, seeded naming | identical, verified |
| Camo generator — 18 families × 18 palettes × 5 rarities | identical, verified |
| All 18 items and 14 loot tables | identical, verified |
| Inventory with stacks, weight and encumbrance, 5 quick slots | ported |
| All 9 mutants with stalk / charge / swarm / call behaviours | identical, verified |
| All 5 animals with skittish / defensive / predator / territorial | identical, verified |
| All 6 bosses — 3 phases, 2 weak points, 13 attacks, telegraphs | identical, verified |
| All 7 biomes — terrain, palette, fog, flora, **physics** | identical, verified |
| Rift progression, seeded biome order, depth scaling | identical, verified |
| 12 landmark kinds with searchable containers and forage | ported |
| Horror director | ported |
| Sandbox — all 43 mods, 7 groups, the 7-step tutorial | identical, verified |
| Guide wisp, compass, shared map marks | ported |
| Save / resume | ported (DataStore instead of localStorage) |
| Robux storefront | new — Roblox only |
| Co-op netcode | **replaced** — Roblox's own replication does this job |
| Runtime-generated audio and music | **not ported** — see below |

### What genuinely cannot come across

Three things, and they are all the same thing: the WebGL build generates its
own assets at runtime, and Roblox does not let a game do that.

- **Audio.** The WebGL build synthesises every sound and the whole score from
  oscillators through the Web Audio API. Roblox plays uploaded audio assets;
  there is no runtime synthesis. Sound needs assets you upload and reference by
  id — the hooks are in place, the sounds are not.
- **Textures.** Camo finishes are drawn into a canvas per weapon in the browser.
  Roblox has no runtime canvas, so `Camo.luau` keeps the whole generator —
  family, palette, rarity, material response, so seed 91442 is the same
  Tigerstripe/Cinder Exotic in both builds — and resolves it to a colour, a
  Roblox material and a reflectance instead of a bitmap. The identity survives;
  the pixels do not.
- **The renderer.** Roblox draws the world with its own engine. The port maps
  every palette, fog density and exposure value onto Lighting and Atmosphere,
  but a three.js scene and a Roblox scene will never look pixel-identical, and
  nothing anyone writes can change that.

Everything else — every rule, every number, every behaviour — is here.

---

## Getting it into Studio

There are three ways in, and the first one needs nothing installed — no Node,
no npm, no plugin, no terminal. Two files in `build/` are already built.

**1. Open it as a whole place** — the fastest way to play it.

> Double-click **`BLACKROOT.rbxlx`**, or in Studio: **File → Open from File…**
> → pick it → press **Play**.

That is the entire installation. It opens as its own place with every script
already where it belongs. Use this unless you already have a place you care
about, because opening it does not touch anything else you have.

**2. Insert the scripts into a place you already have.**

> In Studio's Explorer, right-click **Workspace** → **Insert from File…** →
> pick **`BLACKROOT-scripts.rbxmx`**.

A `BLACKROOT` folder appears holding three folders named for where they go —
`1_DRAG_INTO_ServerScriptService`, `2_DRAG_INTO_ReplicatedStorage`,
`3_DRAG_INTO_StarterPlayerScripts`. Drag the contents of each into the service
its name gives (each one also carries a `WHERE_THIS_GOES` note), then delete
the now-empty `BLACKROOT` folder. Three drags.

**3. Live sync from these source files** — for actually working on it, so an
edit on disk shows up in Studio a second later. That is the plugin, below.

```bash
npm run roblox:place      # rebuild both files in build/ from these sources
npm run roblox:test       # 868 checks — over four hundred of them direct JS-vs-Luau comparisons
npm run roblox:sync       # start the source server for Studio (leave it running)
npm run roblox:plugin     # install the Studio plugin
```

To put it online, either **File → Publish to Roblox As…** inside Studio, or use
the bot below.

---

## Publishing from the command line

Then, once per experience:

1. **Create the experience.** create.roblox.com → Create → New Experience.
   Note the **universe id** (in the URL of the experience page) and the
   **place id** (in the URL of the place, and of `roblox.com/games/<id>`).
2. Put both numbers in `blackroot.config.json`.
3. **Create an API key.** create.roblox.com → Open Cloud → API Keys. Add the
   `universe-places` permission with **Write** on your experience — that is
   what the publish endpoint checks. Add `universe-messaging-service:publish`
   and the `universe-datastores` permissions if you want `announce` and the
   `ds-*` commands. Restrict it to your IP if you can.
4. Put the key in your environment, and nowhere else:
   ```bash
   export ROBLOX_API_KEY='…'        # macOS / Linux
   $env:ROBLOX_API_KEY='…'          # Windows PowerShell
   ```
5. ```bash
   npm run roblox:bot -- whoami     # confirms the key reaches your universe
   npm run roblox:bot -- publish    # uploads build/BLACKROOT.rbxlx, live
   ```

`blackroot.config.json` is committed and holds only the two ids, which are
public. The API key is never written to a file in this repository, never passed
as a command-line argument, and is scrubbed out of the bot's own error output.

---

## The bot

`roblox/tools/bot.mjs`, wrapped as `npm run roblox:bot -- <command>`.

| Command | What it does | Key permission it needs |
| --- | --- | --- |
| `whoami` | Check the key, print the universe it reaches | universe read |
| `publish` | Upload the place file as a **live** version | `universe-places` write |
| `save` | Upload it as a saved (not live) version | `universe-places` write |
| `watch` | Re-publish every time the place file changes | `universe-places` write |
| `announce <topic> <msg>` | Push a message to every running server | `universe-messaging-service:publish` |
| `ds-get <store> <key>` | Read a DataStore entry | `universe-datastores.objects:read` |
| `ds-set <store> <key> <json>` | Write one | `universe-datastores.objects:create`/`:update` |
| `ids` | Show which catalogue entries still have placeholder ids | — |
| `products --set k=id …` | Paste product ids into `Products.luau` | — |
| `passes --set k=id …` | Same, for game passes | — |

### What the bot deliberately cannot do

It authenticates with an Open Cloud API key and only does what that key is
permitted to do. It does not touch your account cookie, cannot log in as you,
cannot post to your profile, cannot join servers, and cannot create products —
Roblox does not expose product creation to API keys, and that is the right call.
If any guide tells you to paste a `.ROBLOSECURITY` cookie into a script, that
script can do everything your account can do, forever, from anywhere. Don't.

---

## The Studio plugin

Roblox Studio cannot read your disk, and there is no remote-control API for it.
What Studio *can* do is make an HTTP request to your own machine — which is how
every Roblox source-sync tool works, this one included.

```bash
npm run roblox:plugin     # copies the plugin into Studio's plugins folder
npm run roblox:sync       # serves roblox/src on 127.0.0.1:34872
```

Restart Studio. A **BLACKROOT** toolbar appears with four buttons:

- **SYNC** — pull the sources once and rebuild the instance tree
- **WATCH** — poll every second, rebuild on change
- **STOP** — stop watching
- **WIPE** — remove only what the plugin created (it tags everything it makes,
  so nothing you built by hand is touched)

If Studio refuses the request: Home → Game Settings → Security → Allow HTTP
Requests. The sync server binds to `127.0.0.1` only and serves nothing but
`.luau` files under `roblox/src`.

Already using [Rojo](https://rojo.space)? `default.project.json` is a valid
Rojo project and follows the same file-naming convention, so `rojo serve` works
instead. The plugin exists so the project has no hard dependency on it.

---

## The store

`src/ReplicatedStorage/Shared/Products.luau` is the whole catalogue.

**Every id in it is `0`.** That is deliberate: Roblox only lets you create
products for your own experience, so nothing in a repository can fill them in.
Entries with a `0` render greyed out in the shop and say "not configured", and
the server refuses to grant anything for an id it does not recognise. Nothing
breaks; you simply cannot sell yet.

### Consumables — Developer Products

| Item | Price | What it does |
| --- | --- | --- |
| Field Trauma Kit ×3 | R$ 25 | Three kits; each stops a bleed and restores 55 health |
| Ammunition Drop | R$ 25 | Full magazine plus 120 in reserve |
| Adrenaline Shot | R$ 20 | 90 s of +35% speed and +25% damage, then a slow minute |
| Extraction Flare | R$ 35 | Brings extraction to you; once per run |
| Second Wind | R$ 49 | Get up once at 40 health with ten seconds of grace |
| Full Resupply | R$ 99 | All of the above, about a third off buying them apart |

### Passes — one purchase, every run after

| Pass | Price | What it does |
| --- | --- | --- |
| Scavenger's Eye | R$ 99 | Loot within 90 studs outlines through the fog |
| Cartographer | R$ 79 | The guide wisp never goes out; range always on the HUD |
| Veteran's Cache | R$ 199 | Start kitted instead of scavenging for a rifle |
| Double Salvage | R$ 149 | Double the salvage you carry out, forever |

### Why these prices

Roughly 80 Robux is about a dollar at the usual retail rate, so this catalogue
runs from about a quarter to about two-fifty. That is deliberately at the low
end of what Roblox experiences charge. Two rules held the design:

1. **Nothing here is only purchasable.** Kits, ammunition and salvage all drop
   in the world; `lootMul` on the easier tiers already gives you more of them
   than the shop sells. The consumables shorten a run that is going badly —
   they do not gate one.
2. **No random rewards.** There are no crates, no rolls, no odds. You see what
   you are buying before you spend anything. Roblox's policy on paid random
   items is strict and players see through the alternative immediately.

Prices in the table are display text read from `Products.luau`. **The dashboard
is the only place a price is really set** — keep the two in step by hand, or
players will see one number and be charged another.

### Setting it up

1. create.roblox.com → your experience → **Monetization → Developer Products**.
   Create each consumable with the name, description and price above. The
   product id is the number at the end of the dashboard URL.
2. **Monetization → Passes** for the four passes.
3. Paste the ids in:
   ```bash
   npm run roblox:bot -- products --set medkit=123 ammo=456 adrenaline=789 \
       flare=101 secondwind=112 resupply=131
   npm run roblox:bot -- passes --set scavenger=415 cartographer=161 \
       veteran=718 salvage=192
   npm run roblox:bot -- ids        # confirm 10/10
   ```
4. Re-sync Studio, or `npm run roblox:place && npm run roblox:bot -- publish`.

---

## How purchases are handled

Three things go wrong with Roblox monetization, and `MonetizationService.luau`
is built around all three:

**Double-granting.** `ProcessReceipt` is called again on the player's next join
for any purchase that did not return `PurchaseGranted`, and can be called twice
for one purchase if a server dies at the wrong moment. Every `PurchaseId` is
recorded in a DataStore *before* the service answers `PurchaseGranted`. If the
DataStore is unreachable, the answer is `NotProcessedYet` — granting late beats
granting twice.

**Granting when the grant failed.** If the player's character is still loading,
an inventory grant lands nowhere. `PowerupService.grant` returns false, the
service answers `NotProcessedYet`, and Roblox retries — which is only safe
because of the ledger above.

**Trusting the client.** The shop client can only send a *key*. The server looks
it up and asks Roblox to show its own purchase dialog. No client message ever
grants anything, and no product id is actionable from the client.

In Studio the ledger falls back to memory (Studio has no live DataStore access
by default) and says so in the output. That is fine for testing and would be
reckless in production, which is why it is gated on `RunService:IsStudio()`.

---

## Layout

```
roblox/
  default.project.json           Rojo project (also documents the tree)
  blackroot.config.json          universeId / placeId — public, committed
  build/BLACKROOT.rbxlx          generated; a whole place, publishable
  build/BLACKROOT-scripts.rbxmx  generated; just the scripts, to drag in
  plugin/
    BlackrootSync.server.luau    the Studio plugin
  src/
    ReplicatedStorage/Shared/    ← the data tables, transcribed from the JS
      Config.luau                difficulty ladder, run shape, player constants
      Biomes.luau                all 7 biomes: terrain, sky, flora, physics
      Items.luau                 9 weapons, 5 ammo, 18 items, 14 loot tables
      Attachments.luau           21 attachments across 7 slots
      Upgrades.luau              6 tracks, costs, point formula
      Forge.luau                 6 chassis, 5 tiers, 12 traits, seeded naming
      Camo.luau                  18 families × 18 palettes × 5 rarities
      Creatures.luau             9 mutants, 5 animals, every AI constant
      Bosses.luau                6 bosses, phases, weak points, 13 attacks
      Mods.luau                  43 sandbox mods, 7 groups, the tutorial
      Rng.luau                   mulberry32 — the same seeds as the browser
      Products.luau              the Robux catalogue
      Net.luau                   the entire remote surface, one file
    ServerScriptService/Blackroot/
      init.server.luau           boot order and the heartbeat loop
      StatsService.luau          health, stamina, needs, bleed, grace, downed
      InventoryService.luau      stacks, weight, quick slots, per-weapon state
      WeaponService.luau         ballistics, spread bloom, ADS, melee arcs
      EnemyService.luau          9 mutants + 5 animals, alert, 8 behaviours
      BossService.luau           phases, weak points, telegraphs, summons
      WorldBuilder.luau          seeded terrain, per-biome flora and physics
      LootService.luau           12 landmark kinds, containers, forage
      ProgressionService.luau    the rift, biome order, depth scaling
      ObjectiveService.luau      the guide wisp and shared marks
      HorrorDirector.luau        dread, and when it gets bad
      SandboxService.luau        applies all 43 mods
      SaveService.luau           DataStore save and resume
      PowerupService.luau        what a purchase does (knows nothing of Robux)
      MonetizationService.luau   receipts, passes, prompts
    StarterPlayer/StarterPlayerScripts/
      Hud.client.luau            vitals, guide, boss bar, squad, toasts
      Combat.client.luau         input — mouse, touch and gamepad
      Inventory.client.luau      bag, armoury, upgrade tracks (Tab)
      ModMenu.client.luau        the sandbox menu and tutorial (backtick)
      Shop.client.luau           the storefront (B)
  tools/
    bot.mjs                      Open Cloud CLI
    syncserver.mjs               serves src/ to the Studio plugin
    buildplace.mjs               src/ → .rbxlx and .rbxmx, no Studio required
    installplugin.mjs            copies the plugin into Studio
```

---

## Before you make it public

- **Age and content.** BLACKROOT is a survival horror game with weapons. Fill
  in Roblox's own questionnaire honestly (create.roblox.com → your experience →
  Settings) and let it assign the age guidance. Do not claim a rating from any
  other body — this game has not been submitted to one, and stating otherwise
  would be a false claim about a real certification.
- **Assets.** Everything here is built from Roblox primitives and code in this
  repository. No copyrighted characters, maps, logos, creatures, interfaces,
  music or dialogue from any existing game were used, and none should be added.
- **Test the purchase flow in a real server**, not Studio. Studio's memory
  ledger will not catch a duplicate-grant bug; a published test place will.
- **Then publish.** `npm run roblox:place && npm run roblox:bot -- publish`.
