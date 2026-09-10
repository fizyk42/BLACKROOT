# Pacific Afterhours

An original third-person open-world sandbox game set in **San Aurelio**, a fictional
Southern Californian coastal city. Drive, walk, work, race, get chased, buy property.

It runs in a browser on WebGL 2, with a small Node server for static files and
multiplayer. There is no build step and nothing to compile.

---

## Read this first

This was written on a machine **with no graphics card**. That has two consequences and
they are both important:

1. **The gameplay logic and the multiplayer are genuinely tested.** 81 automated checks
   run against real code, including a live server with two real clients. You can run
   them yourself in about twenty seconds.
2. **Nothing visual has ever been seen running.** Not one frame. The rendering code is
   written carefully and its imports are verified, but the first person to see this game
   will be you. Expect bugs in the parts that draw things.

`docs/STATUS.md` sorts every feature into *tested*, *written but unseen*, and *planned*.
It is the honest inventory. Please read it before judging what is here.

---

## Running it

You need [Node.js](https://nodejs.org) 18 or newer. Nothing else.

```bash
npm install     # installs one dependency: ws
npm start       # starts the server
```

Then open **http://localhost:8080**.

If the city fails to build, the loading screen will say so and print the error. Open the
browser console (F12) for the full stack — that is the most useful thing you can send back.

### Running the tests

```bash
npm test            # both suites, ~20 seconds
npm run test:logic  # 38 checks: import graph, road network, economy, missions
npm run test:net    # 43 checks: real server, two real clients
```

---

## Playing with other people

Two to eight players share one city.

1. Everyone needs to reach the same server.
2. One player picks **Online → Host a room**. The server generates a **six-digit code**
   and shows it.
3. Everyone else types that code into **Online → Join room**.
4. Press **Enter the city**.

The code is a real lookup, not decoration: the server keeps a registry of live rooms,
rejects codes that were never issued, and frees the code when the last player leaves.

**Money and ownership are decided by the server, not your browser.** When you finish a
job, the client asks the server to bank it; the server checks the reward id against that
profile's ledger, clamps the amount to the band allowed for that job type, and pays. A
replayed claim, a reconnect, or an edited client cannot mint money. This is covered by
the network tests.

Player-versus-player is **off** unless the host turns it on.

### Playing over the internet

Out of the box the server binds to your machine only. Others on the same Wi-Fi can use
your local IP (`http://192.168.x.x:8080`). To play with people elsewhere you need one of:

- a tunnel such as `ngrok http 8080` or `cloudflared tunnel --url http://localhost:8080`
- port forwarding 8080 on your router
- deploying `server/` to any host that supports Node and WebSockets

**This has not been tested beyond localhost.** The two-client test runs on loopback. LAN
and public hosting should work — the server binds `0.0.0.0` and the client derives the
WebSocket URL from `location.host` — but nobody has confirmed it yet.

---

## What is in the game

**City.** A 12 × 12 intersection grid, roughly 970 m square, with six districts: the
coast strip, downtown towers, Verdugo Row, Palm Hollow, the Kestrel Docks and the
Heights. Beach, ocean and a pier to the west, hills to the east. Roads have lane
markings, kerbs, pavements, parking bays, zebra crossings and working traffic lights.
Buildings are generated per block with facades, shopfronts, awnings, roof clutter and
lit signage. All textures are drawn at runtime on a canvas — nothing is downloaded.

**Movement and driving.** Walk, jog, sprint, crouch, jump, aim, punch, shoot. Seven
vehicle classes with distinct handling, arcade physics with handbrake drifting, and
visible crash damage that dents the bodywork where you hit something.

**The city is alive.** Traffic follows lanes, obeys lights, brakes for what is in front
and honks. Pedestrians walk the pavements and scatter from gunfire and cars. A full
day-night cycle with clear, overcast, rain and fog, wet roads that change reflectivity,
and street lights and windows that come on at dusk.

**Making money.** Courier runs, taxi fares, four street race circuits, vehicle
repossession, 20 hidden film reels. Buy vehicles, upgrade engine, tyres, brakes and
armour, respray, buy property for garage space, buy four businesses that accrue income
you have to collect in person.

**Police.** Five wanted levels. Crimes raise heat, units pursue using road-network
pathfinding, losing them starts a search, surviving the search clears it. Getting busted
costs a fine; getting wasted costs a medical bill.

**Story.** Alex Vega comes home to find the family garage two months from closing.
Twenty missions are designed. **Three are playable** — Homecoming, Late Delivery and
Under the Lights. The in-game journal marks the other seventeen "Planned — not
implemented" rather than pretending otherwise.

---

## How it is put together

```
client/
  index.html            import map, HUD and menu markup
  css/ui.css            interface skin
  vendor/three/         three.js r169, vendored so it works offline
  assets/characters/    CC0 rigged mannequin + 46 animations
  src/
    core/               util, settings, input, audio, save
    world/              citymap (pure data), geo, textures, world, sky
    entities/           character, player, vehicle, traffic, peds
    game/               game (orchestrator), economy, jobs, missions, police
    ui/                 hud, menu, overlay, shop
    net/                net
server/
  server.js             static files + WebSocket relay at 20 Hz
  lobby.js              room-code registry, profiles, authoritative wallet
tools/
  verify.js             offline logic tests
  net-test.js           live client/server tests
docs/
  STATUS.md             what is tested, what is not, what is planned
  CONTROLS.md           full control reference
```

Two deliberate choices worth knowing:

- **`client/src/world/citymap.js` imports nothing.** The entire city layout, road graph,
  pathfinder and points of interest are pure data and pure functions, which is why they
  can be unit-tested in Node without a GPU.
- **The economy is a ledger, not a number.** Every payout carries a unique id and an id
  can only ever be banked once per profile. This is what makes save-scumming and
  reconnect exploits inert, and it is tested on both the client and the server.

---

## Performance

Start on **Low** if you are unsure, then work upwards. The presets change shadows, draw
distance, streaming radius, traffic and pedestrian counts. **Resolution scale** in the
settings is the single biggest lever — dropping it to 0.75 costs little visually and
gains a lot.

No frame rate has ever been measured on real hardware. If it runs badly, that is
information worth sending back.

---

## Credits and licences

- **Code** — original, MIT licensed. See `LICENSE`.
- **three.js** r169 — MIT. `client/vendor/three/LICENSE-three.txt`.
- **Character model and animations** — the Quaternius mannequin from the glTF Universal
  Animation Library, **CC0 / public domain**.
  `client/assets/characters/LICENSE-quaternius-CC0.txt`.
- **Everything else** — vehicles, buildings, props, all textures and all audio are
  generated in code. No third-party art or sound is used.

No real brands, real people or existing games are referenced. San Aurelio, its
characters and its businesses are invented.

---

## Putting this on GitHub

From inside the project folder:

```bash
git init
git add .
git commit -m "Pacific Afterhours: playable prototype"
git branch -M main
```

Create an empty repository on GitHub (no README, no .gitignore — this project already
has both), then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/pacific-afterhours.git
git push -u origin main
```

Replace `YOUR-USERNAME`. If GitHub asks for a password, it wants a
[personal access token](https://github.com/settings/tokens), not your account password.

The repository is about 5 MB, most of which is the vendored three.js build and the
character model. Both are committed on purpose so that a fresh `git clone` plus
`npm install` is everything anyone needs.

### Letting people play it from GitHub

Single-player works on GitHub Pages, because it is all static files. Push the repo, then
in **Settings → Pages** serve from `main` and the `/client` folder. Multiplayer will not
work there — Pages cannot run the Node server, so you would need a host such as Render,
Railway or Fly.io for that.
