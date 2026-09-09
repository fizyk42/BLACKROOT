/**
 * HorrorDirector — a light-touch pacing system.
 *
 * It watches how the run is going (time since the last encounter, health,
 * ammunition, where the player is, how far they have walked, how much noise
 * they are making) and spends a budget on tension: a snapped branch behind
 * them, a howl on the ridge, a silhouette that is gone when you look again,
 * or an actual stalker moved in from out of sight.
 *
 * Rules it will not break: nothing spawns inside the player's view, nothing
 * spawns closer than 26 m, and a real threat never appears while the player is
 * already fighting for their life.
 */
import * as THREE from 'three';
import { Audio } from '../core/AudioManager.js';
import { Settings } from '../core/Settings.js';

const MIN_SPAWN_DIST = 26;
const MAX_SPAWN_DIST = 62;

export class HorrorDirector {
  constructor(game) {
    this.game = game;
    this.dread = 0.15;
    this.timeSinceEncounter = 0;
    this.timeSinceEvent = 0;
    this.timeSinceSpawn = 0;
    this.eventCooldown = 22;
    this.spawnCooldown = 80;
    this.quietBudget = 0;
    this.encountersRun = 0;
    this.calmPeriod = 55;      // grace period at the start of a run
  }

  onKill() {
    this.timeSinceEncounter = 0;
    this.dread = Math.max(0.1, this.dread - 0.18);
  }

  onScream() {
    this.dread = Math.min(1, this.dread + 0.3);
    this.timeSinceEvent = 0;
  }

  onDiscovery(lm) {
    // arriving somewhere new resets the pacing clock a little
    this.dread = Math.min(1, this.dread + lm.threat * 0.25);
    this.timeSinceEvent = Math.max(0, this.timeSinceEvent - 8);
  }

  /* ---------------- evaluation ---------------- */

  update(dt) {
    if (!Settings.get('directorEnabled')) { Audio.setDread(0.1); return; }
    const G = this.game;
    const S = G.stats;
    const E = G.entities;

    this.calmPeriod = Math.max(0, this.calmPeriod - dt);
    this.timeSinceEvent += dt;
    this.timeSinceSpawn += dt;

    const inCombat = E.nearestHostile < 30;
    if (inCombat) this.timeSinceEncounter = 0;
    else this.timeSinceEncounter += dt;

    /* --- dread: what the score and ambience react to --- */
    let target = 0.08;
    if (E.nearestMutant < 70) target += (1 - E.nearestMutant / 70) * 0.55;
    if (E.nearestHostile < 45) target += (1 - E.nearestHostile / 45) * 0.5;
    if (S.healthPct < 0.5) target += (0.5 - S.healthPct) * 0.6;
    if (!G.flashlight.on) target += 0.12;
    if (G.flashlight.battery < 20) target += 0.1;
    target += Math.min(0.22, this.timeSinceEncounter / 260);
    target = Math.min(1, target);
    this.dread += (target - this.dread) * Math.min(1, dt * (target > this.dread ? 1.4 : 0.28));
    Audio.setDread(this.dread);

    if (this.calmPeriod > 0) return;

    /* --- ambient tension events --- */
    const wantEvent = this.timeSinceEvent > this.eventCooldown &&
      this.timeSinceEncounter > 16 && !inCombat;
    if (wantEvent && Math.random() < dt * 0.5) {
      this.fireAmbientEvent();
      this.timeSinceEvent = 0;
      this.eventCooldown = 16 + Math.random() * 26;
    }

    /* --- real encounters --- */
    const lowPressure = E.threatCount === 0 && this.timeSinceEncounter > 55;
    const canSpawn = this.timeSinceSpawn > this.spawnCooldown && lowPressure &&
      S.healthPct > 0.35 && E.countAlive('mutant') < E.mutantCap + 6;
    if (canSpawn && Math.random() < dt * 0.35) {
      this.spawnStalkingEncounter();
      this.timeSinceSpawn = 0;
      this.spawnCooldown = 70 + Math.random() * 90;
    }
  }

  /* ---------------- events ---------------- */

  fireAmbientEvent() {
    const G = this.game;
    const p = G.player.position;
    const pick = Math.random();
    const behind = this.pointBehind(9 + Math.random() * 8);

    if (pick < 0.24) {
      // a branch goes somewhere behind you
      Audio.animal('branch', behind);
      G.fx.debris(new THREE.Vector3(behind.x, behind.y + 1.2, behind.z), new THREE.Vector3(0, 1, 0), 5, [0.15, 0.13, 0.09], 1.5);
      G.entities.onNoise(behind, 0.15);
    } else if (pick < 0.42) {
      Audio.animal('rustle', this.pointBehind(6 + Math.random() * 6));
    } else if (pick < 0.56) {
      const far = this.pointAt(80 + Math.random() * 120, Math.random() * Math.PI * 2);
      Audio.animal('distantScream', far);
      G.ui.subtitle('Something screams, a long way off. It does not sound like an animal.');
    } else if (pick < 0.70) {
      const far = this.pointAt(60 + Math.random() * 100, Math.random() * Math.PI * 2);
      Audio.animal('wolfHowl', far);
      setTimeout(() => Audio.animal('wolfHowl', this.pointAt(70 + Math.random() * 90, Math.random() * 6.28)), 1400);
      G.ui.subtitle('Wolves, somewhere on the ridge. More than one.');
    } else if (pick < 0.82) {
      Audio.animal(Math.random() < 0.5 ? 'owl' : 'crow', this.pointAt(18 + Math.random() * 30, Math.random() * 6.28));
    } else if (pick < 0.92) {
      // a silhouette at the edge of the light, gone if you look away
      this.spawnSilhouette();
    } else {
      Audio.animal('branch', this.pointBehind(4 + Math.random() * 3));
      G.ui.subtitle('That was close.');
      G.entities.onNoise(behind, 0.25);
    }
  }

  /** A shape at the treeline that fades once observed for a moment. */
  spawnSilhouette() {
    const G = this.game;
    if (this._silhouette) return;
    const angle = G.player.yaw + Math.PI + (Math.random() - 0.5) * 2.4;
    const dist = 30 + Math.random() * 26;
    const x = G.player.position.x - Math.sin(angle) * dist;
    const z = G.player.position.z - Math.cos(angle) * dist;
    if (Math.hypot(x, z) > 445) return;
    const y = G.world.terrain.heightAt(x, z);

    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x05060a, transparent: true, opacity: 0.94, fog: true });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 1.35, 3, 6), mat);
    body.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 6, 5), mat);
    head.position.y = 2.05;
    g.add(body, head);
    g.position.set(x, y, z);
    g.lookAt(G.player.position.x, y + 1.5, G.player.position.z);
    G.scene.add(g);
    this._silhouette = { group: g, mat, life: 0, seenFor: 0, x, z };
    G.ui.subtitle('There is something standing between the trees.');
  }

  updateSilhouette(dt) {
    const s = this._silhouette;
    if (!s) return;
    s.life += dt;
    const G = this.game;
    const dx = s.x - G.player.position.x, dz = s.z - G.player.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const f = G.player.forward;
    const looking = (dx / d * f.x + dz / d * f.z) > 0.72;
    if (looking) s.seenFor += dt; else s.seenFor = Math.max(0, s.seenFor - dt * 0.6);

    if (s.seenFor > 1.6 || s.life > 22 || d < 14) {
      s.mat.opacity -= dt * 2.2;
      if (s.mat.opacity <= 0) {
        G.scene.remove(s.group);
        s.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
        s.mat.dispose();
        this._silhouette = null;
        if (Math.random() < 0.4) Audio.animal('rustle', { x: s.x, y: G.player.position.y, z: s.z });
      }
    }
  }

  /** Move a real mutant in from out of sight and let it stalk. */
  spawnStalkingEncounter() {
    const G = this.game;
    const p = G.player.position;
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const dist = MIN_SPAWN_DIST + Math.random() * (MAX_SPAWN_DIST - MIN_SPAWN_DIST);
      const x = p.x + Math.cos(a) * dist;
      const z = p.z + Math.sin(a) * dist;
      if (Math.hypot(x, z) > 440) continue;
      if (G.world.terrain.isWater(x, z) || G.world.terrain.slopeAt(x, z) > 0.5) continue;
      // never in the player's forward arc
      const dx = x - p.x, dz = z - p.z;
      const f = G.player.forward;
      const dot = (dx * f.x + dz * f.z) / dist;
      if (dot > 0.15) continue;
      // and never in line of sight
      const eye = new THREE.Vector3(x, G.world.terrain.heightAt(x, z) + 1.6, z);
      if (G.world.hasLineOfSight(eye, G.player.eyePosition, dist)) continue;

      const type = this.pickEncounterType();
      const m = G.entities.spawnMutant(type, x, z);
      if (m) {
        m.alertLevel = 0.55;
        m.lastKnownPos.copy(p);
        m.state = 'STALK';
        this.encountersRun++;
        if (Math.random() < 0.6) Audio.mutantGrowl(type, { x, y: eye.y, z });
      }
      return;
    }
  }

  pickEncounterType() {
    const S = this.game.stats;
    const strong = S.healthPct > 0.75 && this.game.weapons.reserve > 15;
    const r = Math.random();
    if (strong && r < 0.18) return 'brute';
    if (r < 0.5) return 'stalker';
    if (r < 0.78) return 'crawler';
    return 'screamer';
  }

  /* ---------------- helpers ---------------- */

  pointBehind(dist) {
    const p = this.game.player;
    const a = p.yaw + Math.PI + (Math.random() - 0.5) * 1.6;
    const x = p.position.x - Math.sin(a) * dist;
    const z = p.position.z - Math.cos(a) * dist;
    return { x, y: this.game.world.terrain.heightAt(x, z) + 0.7, z };
  }

  pointAt(dist, angle) {
    const p = this.game.player.position;
    const x = p.x + Math.cos(angle) * dist;
    const z = p.z + Math.sin(angle) * dist;
    return { x, y: this.game.world.terrain.heightAt(x, z) + 2.0, z };
  }
}
