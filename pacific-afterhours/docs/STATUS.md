# Status

**Publication update (2026-09-10, v0.3.1):** The Windows installer now builds, installs and renders the city in an automated GitHub Actions test. A vehicle geometry startup crash was fixed and all seven vehicle models are checked. The actual gameplay image is in `website/gameplay.jpg`; the test report is in `desktop/game-test-report.json`. The original assessment below is historical; its unimplemented-feature limitations still apply. Manual gameplay and performance testing remain outstanding.

Last updated with the build in this repository.

The single most important thing to know: **this was built on a machine with no GPU.**
There is no graphics card in the container where the code was written, which means
**no part of the rendering has ever been seen running.** Everything below is sorted by
how strong the evidence for it actually is.

---

## 1. Verified by automated tests that really ran

These are covered by `npm test`, which runs two suites. The output is reproducible on
your machine.

### `tools/verify.js` — 38 checks, all passing

| Area | What is actually proven |
|---|---|
| Import graph | All 85 relative imports resolve to real files, and every named import exists as a real export in its source module. |
| Vendored assets | three.js r169 build + GLTFLoader + SkeletonUtils + BufferGeometryUtils are present. The character glTF, its binary buffer and its CC0 licence are present, the buffer URI is correctly rewritten, and the file contains 46 animations. |
| Road graph | 144 intersections, every one with 2–4 exits, every road drivable in both directions. |
| Lane geometry | Opposing lanes are on opposite sides of the centreline and inside the carriageway. |
| Pathfinding | A\* finds a shortest Manhattan route corner-to-corner and between every district pair. Waypoint conversion produces finite world coordinates. |
| Traffic lights | Never green on both axes simultaneously, across three full cycles, and adjacent junctions run opposite phases. |
| Road vs pavement | The two tests are mutually exclusive across 400 random points. *(This test found and fixed a real bug: pavement detection used to return true for points that were in the road.)* |
| Points of interest | All 16 are off the carriageway, with unique ids and names. |
| Collectibles | 20 placed, all on pavements, all >80 m apart, and placement is deterministic across runs. |
| **Economy anti-duplication** | A reward id pays exactly once. Reloading an older save and redoing a mission does **not** re-bank the reward. The ledger survives a full serialise/deserialise round trip. A vehicle id cannot enter the garage twice, including across a save round trip. Overspending is refused, fines never go negative, business income accrues but must be collected in person. |
| Mission data | 20 missions, unique ids, sequential numbering, valid prerequisite chain with no forward references, and every step in the three implemented missions uses a known step type. |

### `tools/net-test.js` — 43 checks, all passing

This one is not a mock. It spawns `server/server.js` as a real child process and
connects **two independent WebSocket clients** to it.

| Area | What is actually proven |
|---|---|
| Server boot | Starts, listens, answers `/healthz`. |
| Static serving | Serves `index.html`, client modules with a JavaScript MIME type, the vendored three.js, and the character asset. Returns 404 for unknown paths and refuses directory traversal. |
| Room codes | The host is issued a six-digit code. That exact code resolves through the lobby lookup; an unallocated code and a malformed code both fail. A second client joins **using the code the first client was given**. |
| Roster | Both players appear, the host flag is set on the host only, and the remaining player is notified when someone leaves. |
| Movement sync | One client sends 12 position updates; the other client receives those positions, the vehicle type, and the animation state, relayed by the server. |
| Tick rate | Snapshots measured arriving at 14–26 per second against a 20 Hz target. |
| Chat | Text sent by one client arrives at the other. |
| **Authoritative money** | A first claim pays. An identical replayed claim is refused with `already-claimed` and the balance does not move. A payout inflated to 999,999 is clamped to the server's maximum for that job type. An unknown reward kind is refused. Vehicle purchase debits the server wallet, the same vehicle id cannot be granted twice, and a purchase beyond the balance is refused. |
| **Reconnection** | A client disconnects, reconnects with its saved token, and gets the same profile and the same balance back — then tries to re-claim a reward it banked before the disconnect and is refused. |
| Cleanup | The room code is released when the room empties; the server reports zero live rooms. |
| Robustness | Non-JSON input, garbage payloads and unknown message types do not crash the server. |

---

## 2. Written and syntax-checked, but never seen running

Everything visual is in this category. Every file passes `node --check`, and the import
graph is verified, so there are no missing files or misspelled imports. That is a very
different thing from "it looks right".

- **All rendering.** The city geometry, materials, procedural textures, sky shader,
  day/night colour grading, weather, rain, water, shadows and post-processing settings.
- **Vehicle appearance.** The bevelled body extrusion, greenhouse, glass, wheels, lights,
  and the crash-denting vertex displacement.
- **Character animation.** Clip selection, crossfades and the driving pose. The rig's
  forward axis was verified *numerically* from the inverse bind matrices (the toes sit at
  z = +0.113 against the ankle at z = −0.036, so the model faces +Z, matching the engine
  convention) — but nobody has watched it walk.
- **Camera feel.** Spring arm, collision shortening, over-the-shoulder aim, speed FOV.
- **Driving feel.** The arcade physics runs deterministic maths that was reasoned about
  carefully, but tuning numbers only mean something once a human drives them.
- **All audio.** The procedural WebAudio engine tone, tyre screech, siren, gunfire and
  footsteps have never been heard.
- **Performance.** No frame rate has ever been measured. The graphics presets are
  educated guesses, not measurements.

**Expect to find bugs here.** The most likely failure modes, in order: a material or
geometry merge error that throws during city build; the character animating incorrectly;
draw-call counts being higher than intended on Low.

---

## 3. Designed but not built

| Item | State |
|---|---|
| Missions 4–20 | Titles, premises, rewards and prerequisite order are written and appear in the in-game journal explicitly labelled "Planned — not implemented". No steps exist. |
| World size | The detailed grid is roughly 970 × 970 m (12 × 12 intersections) plus beach, ocean, pier and hills. The brief's 8 × 8 km target is **not** met. |
| Interiors | Two are walkable (the auto shop and the starter apartment). Other buildings open a menu at the door rather than a room. |
| Character models | One CC0 mannequin, recoloured for clothing. Not individually modelled faces or bodies. |
| Vehicle interiors | Not modelled. The camera does not go inside the cabin. |
| Weapons | Fists, pistol and SMG. No weapon shop is wired up yet. |
| Aircraft, boats, motorcycles | Not implemented. |
| Dedicated hosting | The server runs locally. Playing with people outside your network needs port forwarding or a tunnel — see the README. |
| Controller UI navigation | Gamepad works in-game; the menus are mouse and keyboard. |

---

## 4. Known issues and rough edges

- Interiors are placed 500 m below the city and reached by a fade teleport. This is a
  standard technique but it means the interior and exterior are never visible together.
- Traffic cars use circle-based separation, so at high closing speeds a glancing
  collision can look soft.
- Pedestrians do not use pavement pathfinding proper; they walk between generated
  pavement waypoints and will occasionally cut a corner across a road.
- The police pursuit repaths every 1.6 s, so units can briefly drive past a turn.
- Save data lives in `localStorage`. Clearing site data clears your game. If storage is
  blocked entirely the game still runs, but saving is disabled and says so.
- Online progress is deliberately **not** saved locally — the server holds it in memory,
  so restarting the server clears online profiles.

---

## 5. How to check any of this yourself

```bash
npm test            # both suites
npm run test:logic  # the 38 offline checks
npm run test:net    # the 43 live client/server checks
npm start           # then open http://localhost:8080
```

If a claim in this document does not match what you see, the document is wrong and
should be corrected — not the other way round.
