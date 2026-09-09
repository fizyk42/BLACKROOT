/**
 * Bosses — one for each biome, and no two of them fight the same way.
 *
 * A boss is an Entity like anything else, so bullets, blood, audio, the
 * horror director and the save system all keep working. What it adds:
 *
 *  - **weak points**: named spheres attached to the model with their own
 *    damage multipliers. Shooting a Chorister's ring does almost nothing;
 *    shooting the eye it is protecting does eight times as much. A boss is a
 *    puzzle about where to shoot, not a health bar with legs.
 *  - **phases**: thresholds that change the attack set, the speed and the
 *    weak points, announced so the player can read the change.
 *  - **attacks** on their own timers, telegraphed by a wind-up the player can
 *    see and react to. Nothing hits you without showing you first.
 *  - **an arena**: a ring the fight happens in, so the boss cannot be kited
 *    into the next county.
 */
import * as THREE from 'three';
import { Entity, STATE } from './Entity.js';
import { PARTS, bakeStatics } from './CreatureModels.js';
import { Audio } from '../core/AudioManager.js';

const { b, s, seg, cap, spike, jointedLimb, claw, ribcage, eyeCluster, mats } = PARTS;

/* ================================================================== */
/* definitions                                                         */
/* ================================================================== */

export const BOSSES = {

  warden: {
    id: 'warden', biome: 'hollow',
    name: 'THE WARDEN OF THE HOLLOW',
    title: 'what the rangers became, all of them at once',
    health: 2600, radius: 1.5, height: 5.2, headHeight: 4.2,
    speed: 1.9, runSpeed: 5.4, armor: 0.28, mass: 8,
    damage: 44, attackRange: 4.4, attackCooldown: 2.4,
    viewRange: 70, arena: 46,
    phases: [
      { at: 1.00, label: 'It stands up', speed: 1.0, attacks: ['sweep', 'slam'] },
      { at: 0.62, label: 'The bark splits', speed: 1.22, attacks: ['sweep', 'slam', 'summon'] },
      { at: 0.28, label: 'It stops pretending to be a tree', speed: 1.5, attacks: ['slam', 'charge', 'summon'] },
    ],
    weakPoints: [
      { name: 'heart', y: 2.5, z: 0.55, r: 0.55, mul: 4.5, phase: 0 },
      { name: 'crown', y: 4.6, z: 0.0, r: 0.7, mul: 2.4, phase: 1 },
    ],
  },

  chorister: {
    id: 'chorister', biome: 'void',
    name: 'THE FIRST CHORISTER',
    title: 'it was singing before there was anything to hear it',
    health: 2100, radius: 1.3, height: 4.6, headHeight: 3.4,
    speed: 3.4, runSpeed: 7.0, armor: 0.15, mass: 3,
    damage: 30, attackRange: 3.6, attackCooldown: 1.7,
    viewRange: 90, arena: 52, floats: true,
    phases: [
      { at: 1.00, label: 'The ring opens', speed: 1.0, attacks: ['shardvolley', 'lash'] },
      { at: 0.66, label: 'It divides', speed: 1.25, attacks: ['shardvolley', 'lash', 'summon'] },
      { at: 0.30, label: 'The song resolves', speed: 1.55, attacks: ['shardvolley', 'collapse', 'summon'] },
    ],
    weakPoints: [
      { name: 'core', y: 2.2, z: 0.0, r: 0.5, mul: 6.0, phase: 0, hiddenUntilPhase: 1 },
      { name: 'eye', y: 3.5, z: 0.35, r: 0.42, mul: 3.2, phase: 0 },
    ],
  },

  gillfather: {
    id: 'gillfather', biome: 'abyss',
    name: 'THE GILL-FATHER',
    title: 'the light on the end of it is the only kindness down here',
    health: 3000, radius: 1.7, height: 4.4, headHeight: 3.2,
    speed: 2.0, runSpeed: 5.0, armor: 0.34, mass: 9,
    damage: 48, attackRange: 4.8, attackCooldown: 2.6,
    viewRange: 40, arena: 50,
    phases: [
      { at: 1.00, label: 'The lure comes on', speed: 1.0, attacks: ['bite', 'sweep'] },
      { at: 0.60, label: 'It stops waiting', speed: 1.3, attacks: ['bite', 'charge', 'summon'] },
      { at: 0.25, label: 'Everything down here answers it', speed: 1.45, attacks: ['charge', 'bite', 'summon'] },
    ],
    weakPoints: [
      { name: 'lure', y: 4.1, z: 1.2, r: 0.45, mul: 5.0, phase: 0 },
      { name: 'gills', y: 2.6, z: 0.9, r: 0.55, mul: 3.0, phase: 1 },
    ],
  },

  pyreking: {
    id: 'pyreking', biome: 'cinder',
    name: 'THE PYRE-KING',
    title: 'it has been on fire for nine years and it is not finished',
    health: 2400, radius: 1.4, height: 4.8, headHeight: 3.9,
    speed: 2.6, runSpeed: 6.6, armor: 0.20, mass: 5,
    damage: 38, attackRange: 4.0, attackCooldown: 1.9,
    viewRange: 65, arena: 44,
    phases: [
      { at: 1.00, label: 'It turns to face you', speed: 1.0, attacks: ['slam', 'firelash'] },
      { at: 0.64, label: 'The crust cracks open', speed: 1.3, attacks: ['firelash', 'charge', 'summon'] },
      { at: 0.26, label: 'It burns everything left', speed: 1.6, attacks: ['charge', 'firelash', 'nova'] },
    ],
    weakPoints: [
      { name: 'furnace', y: 2.4, z: 0.6, r: 0.6, mul: 4.0, phase: 0 },
      { name: 'crown', y: 4.2, z: 0.2, r: 0.5, mul: 3.0, phase: 1 },
    ],
  },

  hoarmother: {
    id: 'hoarmother', biome: 'permafrost',
    name: 'THE HOAR MOTHER',
    title: 'she has been standing here since before the road',
    health: 3400, radius: 1.6, height: 5.0, headHeight: 4.0,
    speed: 1.4, runSpeed: 4.2, armor: 0.48, mass: 11,
    damage: 52, attackRange: 4.6, attackCooldown: 2.8,
    viewRange: 55, arena: 48,
    phases: [
      { at: 1.00, label: 'The ice moves first', speed: 1.0, attacks: ['slam', 'spikes'] },
      { at: 0.58, label: 'Her shell breaks', speed: 1.25, attacks: ['slam', 'spikes', 'summon'] },
      { at: 0.24, label: 'There is a person inside it', speed: 1.5, attacks: ['charge', 'spikes', 'summon'] },
    ],
    weakPoints: [
      { name: 'shell', y: 2.8, z: 0.7, r: 0.75, mul: 1.6, phase: 0 },
      { name: 'woman', y: 2.8, z: 0.55, r: 0.45, mul: 7.0, phase: 2 },
    ],
  },

  motherstalk: {
    id: 'motherstalk', biome: 'bloom',
    name: 'THE MOTHER STALK',
    title: 'every fungus in this valley is one organism and this is its head',
    health: 2800, radius: 2.0, height: 5.6, headHeight: 4.6,
    speed: 0.9, runSpeed: 2.6, armor: 0.30, mass: 14,
    damage: 34, attackRange: 5.4, attackCooldown: 2.2,
    viewRange: 60, arena: 42, rooted: true,
    phases: [
      { at: 1.00, label: 'The cap opens', speed: 1.0, attacks: ['tendril', 'sporecloud'] },
      { at: 0.66, label: 'It puts up children', speed: 1.15, attacks: ['tendril', 'sporecloud', 'summon'] },
      { at: 0.30, label: 'It pulls itself out of the ground', speed: 1.4, attacks: ['tendril', 'sporecloud', 'summon', 'slam'] },
    ],
    weakPoints: [
      { name: 'gills', y: 4.3, z: 0.0, r: 0.9, mul: 3.5, phase: 0 },
      { name: 'bulb', y: 1.2, z: 0.7, r: 0.7, mul: 5.0, phase: 1 },
    ],
  },
};

export function bossForBiome(biomeId) {
  return Object.values(BOSSES).find((x) => x.biome === biomeId) || BOSSES.warden;
}

/* ================================================================== */
/* models                                                              */
/* ================================================================== */

/** THE WARDEN — a ranger's body grown into, and through, a dead tree. */
function buildWarden() {
  const g = new THREE.Group();
  const M = mats;
  const torso = new THREE.Group(); torso.position.y = 3.0; g.add(torso);

  const trunkBody = cap(0.62, 1.5, M.fleshDark(), 10);
  trunkBody.scale.set(1.15, 1, 0.85);
  torso.add(trunkBody);
  // the cage is a person's ribs, three times the size they should be
  torso.add(ribcage({ top: 0.85, height: 1.7, radius: 0.82, count: 8, open: 0.42, thick: 0.075, mat: M.boneOld() }));
  const heart = s(0.42, M.fleshWet(), 0, 0.05, 0.52, 1);
  torso.add(heart);
  // bark plates over the shoulders
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const plate = b(0.34, 0.9, 0.16, M.fleshDark(), Math.cos(a) * 0.72, 0.5 - (i % 3) * 0.4, Math.sin(a) * 0.62);
    plate.rotation.y = -a;
    plate.rotation.z = Math.cos(a) * 0.3;
    torso.add(plate);
  }

  const head = new THREE.Group();
  head.position.set(0, 1.30, 0.10);
  torso.add(head);
  const skull = s(0.44, M.fleshPale(), 0, 0, 0, 1);
  skull.scale.set(0.8, 1.25, 0.9);
  head.add(skull);
  // a crown of antlers, which is not what a person has
  const crown = new THREE.Group();
  crown.position.y = 0.42;
  head.add(crown);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const horn = spike(0.07, 0.85 + (i % 3) * 0.42, M.boneOld(), 5);
    horn.position.set(Math.cos(a) * 0.26, 0.3, Math.sin(a) * 0.26);
    horn.rotation.z = -Math.cos(a) * 0.85;
    horn.rotation.x = Math.sin(a) * 0.85;
    crown.add(horn);
  }
  const eyes = eyeCluster(5, 0.40, 0.055, M.eyeMat());
  head.add(eyes);

  const arms = [];
  for (const sgn of [-1, 1]) {
    const arm = jointedLimb({ r: 0.20, upper: 1.35, lower: 1.45, mat: M.fleshDark(), jointMat: M.boneOld(), bend: 0.35, segs: 7 });
    arm.position.set(sgn * 0.78, 0.66, 0);
    arm.rotation.z = sgn * 0.12;
    torso.add(arm);
    arm.userData.end.add(claw(5, 0.9, M.boneOld(), 0.9));
    arms.push(arm);
  }
  const legs = [];
  for (const sgn of [-1, 1]) {
    const leg = jointedLimb({ r: 0.28, upper: 1.35, lower: 1.40, mat: M.fleshDark(), jointMat: M.boneOld(), bend: -0.55, segs: 7 });
    leg.position.set(sgn * 0.38, -0.78, 0);
    torso.add(leg);
    leg.userData.end.add(b(0.42, 0.16, 0.95, M.fleshDark(), 0, -0.06, 0.24));
    leg.userData.end.rotation.x = 0.5;
    legs.push(leg);
  }

  g.userData.parts = { torso, head, arms, legs, eyes: eyes.userData.eyes, heart, crown };
  g.userData.tick = (t, amp, state) => {
    heart.scale.setScalar(1 + Math.sin(t * 2.4) * 0.12);
    crown.rotation.y = Math.sin(t * 0.3) * 0.12;
  };
  return bakeStatics(g);
}

/** THE FIRST CHORISTER — a ring of shards around something that is only a voice. */
function buildChorister() {
  const g = new THREE.Group();
  const M = mats;
  const torso = new THREE.Group(); torso.position.y = 2.4; g.add(torso);

  const body = cap(0.36, 1.1, M.voidSkin(), 10);
  body.scale.set(1, 1, 0.7);
  torso.add(body);
  const core = s(0.34, M.voidGlow(), 0, -0.2, 0, 0);
  torso.add(core);
  for (let i = 0; i < 8; i++) {
    torso.add(b(0.05, 0.30, 0.05, M.voidGlow(), Math.sin(i) * 0.16, 0.52 - i * 0.15, 0.26));
  }

  const head = new THREE.Group();
  head.position.set(0, 1.0, 0);
  torso.add(head);
  const skull = s(0.34, M.voidSkin(), 0, 0, 0, 1);
  skull.scale.set(0.86, 1.2, 0.86);
  head.add(skull);
  const eye = s(0.22, M.voidGlow(), 0, 0.04, 0.28, 0);
  head.add(eye);

  const arms = [];
  for (const sgn of [-1, 1]) {
    const arm = jointedLimb({ r: 0.09, upper: 1.1, lower: 1.2, mat: M.voidSkin(), jointMat: M.voidGlow(), bend: 0.5 });
    arm.position.set(sgn * 0.40, 0.5, 0);
    arm.rotation.z = sgn * 0.55;
    torso.add(arm);
    arm.userData.end.add(claw(5, 0.62, M.voidSkin(), 1.0));
    arms.push(arm);
  }
  // the trailing ribbons where legs would be
  const legs = [];
  for (const sgn of [-1, 1]) {
    const trail = new THREE.Group();
    trail.position.set(sgn * 0.16, -0.7, 0);
    for (let i = 0; i < 5; i++) trail.add(cap(0.07 - i * 0.011, 0.34, M.voidSkin(), 6).translateY(-0.22 - i * 0.36));
    torso.add(trail);
    legs.push(trail);
  }

  // three counter-rotating rings
  const rings = [];
  for (let ri = 0; ri < 3; ri++) {
    const ring = new THREE.Group();
    ring.position.y = 2.4;
    g.add(ring);
    const radius = 1.6 + ri * 0.55;
    for (let i = 0; i < 10 + ri * 3; i++) {
      const a = (i / (10 + ri * 3)) * Math.PI * 2;
      const sh = new THREE.Mesh(new THREE.OctahedronGeometry(0.14 + (i % 3) * 0.06, 0), M.voidGlow());
      sh.position.set(Math.cos(a) * radius, Math.sin(a * 3 + ri) * 0.35, Math.sin(a) * radius);
      ring.add(sh);
    }
    ring.userData.speed = (ri % 2 ? -1 : 1) * (0.35 + ri * 0.22);
    rings.push(ring);
  }

  g.userData.parts = { torso, head, arms, legs, eyes: [eye], core, rings };
  g.userData.tick = (t, amp, state) => {
    for (const r of rings) {
      r.rotation.y = t * r.userData.speed * (state === 'CHASE' ? 2.4 : 1);
      r.rotation.x = Math.sin(t * 0.25 + r.userData.speed) * 0.35;
    }
    torso.position.y = 2.4 + Math.sin(t * 0.7) * 0.22;
    core.scale.setScalar(1 + Math.sin(t * 3.1) * 0.14);
    for (const l of legs) l.rotation.x = Math.sin(t * 1.1 + l.position.x * 4) * 0.3;
  };
  return bakeStatics(g);
}

/** THE GILL-FATHER — an anglerfish the size of a bus, walking on its fins. */
function buildGillfather() {
  const g = new THREE.Group();
  const M = mats;
  const torso = new THREE.Group(); torso.position.y = 2.1; g.add(torso);

  const belly = s(1.05, M.drowned(), 0, -0.15, 0, 1);
  belly.scale.set(1.0, 1.05, 1.35);
  torso.add(belly);
  torso.add(ribcage({ top: 0.6, height: 1.5, radius: 0.82, count: 7, open: 0.16, thick: 0.06, mat: M.boneOld() }));
  const gut = s(0.4, M.lure(), 0, -0.25, 0.1, 0);
  torso.add(gut);
  // gill rakes down both flanks
  const gills = new THREE.Group();
  torso.add(gills);
  for (const sgn of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const slit = b(0.08, 0.42, 0.2, M.sinew(), sgn * 0.86, 0.35 - i * 0.26, 0.55);
      slit.rotation.z = sgn * 0.35;
      gills.add(slit);
    }
  }

  const head = new THREE.Group();
  head.position.set(0, 0.9, 0.5);
  torso.add(head);
  const skull = s(0.62, M.drowned(), 0, 0, 0, 1);
  skull.scale.set(1.15, 0.8, 1.2);
  head.add(skull);
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.34, 0.24);
  head.add(jaw);
  jaw.add(b(0.9, 0.26, 0.9, M.fleshWet(), 0, -0.1, 0));
  for (let i = 0; i < 14; i++) {
    const th = spike(0.05, 0.42, M.toothMat(), 4);
    const col = i % 7, row = Math.floor(i / 7);
    th.position.set(-0.36 + col * 0.12, 0.08, 0.42 - row * 0.26);
    jaw.add(th);
  }
  for (let i = 0; i < 7; i++) {
    const th = spike(0.05, 0.36, M.toothMat(), 4);
    th.rotation.x = Math.PI;
    th.position.set(-0.36 + i * 0.12, -0.22, 0.5);
    head.add(th);
  }
  const eyes = [s(0.14, M.lure(), -0.34, 0.16, 0.44, 0), s(0.14, M.lure(), 0.34, 0.16, 0.44, 0)];
  head.add(...eyes);

  // the lure, on a long jointed stalk out over the mouth
  const stalkA = new THREE.Group();
  stalkA.position.set(0, 0.5, 0.1);
  head.add(stalkA);
  const sa = seg(0.07, 0.05, 1.1, M.drowned(), 6); sa.position.y = 0.55; stalkA.add(sa);
  const stalkB = new THREE.Group(); stalkB.position.y = 1.1; stalkA.add(stalkB);
  const sb = seg(0.05, 0.03, 0.9, M.drowned(), 6); sb.position.y = -0.45; stalkB.add(sb);
  const lureBulb = s(0.24, M.lure(), 0, -0.95, 0, 0);
  stalkB.add(lureBulb);

  const arms = [];
  const legs = [];
  for (const sgn of [-1, 1]) {
    const fin = jointedLimb({ r: 0.24, upper: 1.1, lower: 1.15, mat: M.drowned(), jointMat: M.boneOld(), bend: 0.5, segs: 6 });
    fin.position.set(sgn * 0.9, 0.15, 0.25);
    torso.add(fin);
    fin.userData.end.add(claw(6, 0.7, M.drowned(), 1.4));
    arms.push(fin);

    const leg = jointedLimb({ r: 0.28, upper: 0.95, lower: 1.0, mat: M.drowned(), jointMat: M.boneOld(), bend: 0.4, segs: 6 });
    leg.position.set(sgn * 0.55, -0.95, -0.3);
    torso.add(leg);
    leg.userData.end.add(b(0.52, 0.14, 0.9, M.drowned(), 0, -0.05, 0.2));
    legs.push(leg);
  }

  g.userData.parts = { torso, head, jaw, arms, legs, eyes, lure: lureBulb, gills };
  g.userData.tick = (t, amp, state) => {
    stalkA.rotation.x = 0.55 + Math.sin(t * 0.6) * 0.14;
    stalkB.rotation.x = -0.95 + Math.sin(t * 0.9 + 1) * 0.18;
    lureBulb.scale.setScalar(1 + Math.sin(t * 2.0) * 0.2);
    jaw.rotation.x = (state === 'ATTACK' ? 0.75 : 0.12) + Math.sin(t * 0.9) * 0.06;
    belly.scale.y = 1.05 + Math.sin(t * 0.8) * 0.05;
  };
  return bakeStatics(g);
}

/** THE PYRE-KING — a burning giant wearing a crown of its own bones. */
function buildPyreking() {
  const g = new THREE.Group();
  const M = mats;
  const torso = new THREE.Group(); torso.position.y = 2.7; g.add(torso);

  const trunk = cap(0.55, 1.3, M.charred(), 10);
  trunk.scale.set(1.15, 1, 0.82);
  torso.add(trunk);
  const furnace = s(0.5, M.ember(), 0, 0.0, 0.35, 0);
  torso.add(furnace);
  torso.add(ribcage({ top: 0.7, height: 1.5, radius: 0.72, count: 6, open: 0.6, thick: 0.07, mat: M.charred() }));
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const cr = b(0.09, 0.42 + (i % 4) * 0.2, 0.07, M.ember(), Math.cos(a) * 0.56, 0.5 - (i % 5) * 0.3, Math.sin(a) * 0.46);
    cr.rotation.y = -a;
    torso.add(cr);
  }

  const head = new THREE.Group();
  head.position.set(0, 1.15, 0.05);
  torso.add(head);
  const skull = s(0.40, M.charred(), 0, 0, 0, 1);
  skull.scale.set(0.9, 1.15, 1.0);
  head.add(skull);
  const mouth = s(0.24, M.ember(), 0, -0.06, 0.26, 0);
  mouth.scale.set(1.3, 0.8, 0.5);
  head.add(mouth);
  const crown = new THREE.Group();
  crown.position.y = 0.30;
  head.add(crown);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const horn = spike(0.055, 0.55 + (i % 3) * 0.35, M.boneOld(), 4);
    horn.position.set(Math.cos(a) * 0.32, 0.2, Math.sin(a) * 0.32);
    horn.rotation.z = -Math.cos(a) * 0.5;
    horn.rotation.x = Math.sin(a) * 0.5;
    crown.add(horn);
  }
  const eyes = [s(0.08, M.ember(), -0.16, 0.10, 0.34, 0), s(0.08, M.ember(), 0.16, 0.10, 0.34, 0)];
  head.add(...eyes);

  const arms = [];
  for (const sgn of [-1, 1]) {
    const arm = jointedLimb({ r: 0.22, upper: 1.2, lower: 1.3, mat: M.charred(), jointMat: M.ember(), bend: 0.42, segs: 7 });
    arm.position.set(sgn * 0.72, 0.55, 0);
    torso.add(arm);
    arm.userData.end.add(claw(4, 0.8, M.charred(), 0.9));
    arms.push(arm);
  }
  const legs = [];
  for (const sgn of [-1, 1]) {
    const leg = jointedLimb({ r: 0.30, upper: 1.15, lower: 1.2, mat: M.charred(), jointMat: M.ember(), bend: 0.35, segs: 7 });
    leg.position.set(sgn * 0.4, -0.72, 0);
    torso.add(leg);
    leg.userData.end.add(b(0.44, 0.16, 0.86, M.charred(), 0, -0.06, 0.18));
    legs.push(leg);
  }

  g.userData.parts = { torso, head, arms, legs, eyes, furnace, crown };
  g.userData.tick = (t, amp, state) => {
    const flick = 2.4 + Math.sin(t * 8.3) * 0.9 + Math.sin(t * 2.7) * 0.6;
    M.ember().emissiveIntensity = 1.8 + flick;
    furnace.scale.setScalar(1 + Math.sin(t * 3.4) * 0.10);
    crown.rotation.y = Math.sin(t * 0.4) * 0.10;
  };
  return bakeStatics(g);
}

/** THE HOAR MOTHER — a woman inside a glacier that grew out of her. */
function buildHoarmother() {
  const g = new THREE.Group();
  const M = mats;
  const torso = new THREE.Group(); torso.position.y = 2.9; g.add(torso);

  // the woman, small and still, at the centre
  const woman = new THREE.Group();
  woman.position.set(0, -0.1, 0.15);
  torso.add(woman);
  woman.add(cap(0.24, 0.6, M.fleshGrey(), 9));
  const wHead = s(0.19, M.fleshGrey(), 0, 0.52, 0.02, 1);
  woman.add(wHead);
  woman.add(b(0.16, 0.26, 0.14, M.fleshRaw(), 0, 0.36, 0.10));   // mouth, still open
  const wEyes = [s(0.030, M.eyeCold(), -0.07, 0.56, 0.15, 0), s(0.030, M.eyeCold(), 0.07, 0.56, 0.15, 0)];
  woman.add(...wEyes);

  // and the ice around her
  const shell = s(0.95, M.iceMat(), 0, 0.05, 0.1, 1);
  shell.scale.set(1.1, 1.25, 1.0);
  torso.add(shell);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const t2 = (i % 5) / 5;
    const sp = spike(0.14 + t2 * 0.06, 0.9 + t2 * 1.3, M.iceMat(), 5);
    sp.position.set(Math.cos(a) * 0.75, 0.3 - t2 * 0.7, Math.sin(a) * 0.62);
    sp.rotation.z = -Math.cos(a) * 1.0;
    sp.rotation.x = Math.sin(a) * 1.0;
    torso.add(sp);
  }

  const head = new THREE.Group();
  head.position.set(0, 1.15, 0.05);
  torso.add(head);
  const iceHead = s(0.5, M.iceMat(), 0, 0, 0, 1);
  iceHead.scale.set(0.9, 1.2, 0.9);
  head.add(iceHead);
  const eyes = [s(0.07, M.eyeCold(), -0.18, 0.08, 0.35, 0), s(0.07, M.eyeCold(), 0.18, 0.08, 0.35, 0)];
  head.add(...eyes);
  for (let i = 0; i < 7; i++) {
    const horn = spike(0.06, 0.7 + (i % 3) * 0.4, M.iceMat(), 4);
    horn.position.set(-0.28 + i * 0.093, 0.36, -0.06);
    horn.rotation.z = (i - 3) * 0.22;
    horn.rotation.x = -0.5;
    head.add(horn);
  }

  const arms = [];
  for (const sgn of [-1, 1]) {
    const arm = jointedLimb({ r: 0.24, upper: 1.25, lower: 1.35, mat: M.iceMat(), jointMat: M.fleshGrey(), bend: 0.4, segs: 6 });
    arm.position.set(sgn * 0.85, 0.5, 0);
    torso.add(arm);
    const hand = new THREE.Group();
    hand.add(claw(4, 0.7, M.iceMat(), 0.9));
    for (let i = 0; i < 3; i++) {
      const ic = spike(0.09, 0.85, M.iceMat(), 4);
      ic.position.set((i - 1) * 0.16, -0.4, 0.06);
      ic.rotation.x = Math.PI * 0.92;
      hand.add(ic);
    }
    arm.userData.end.add(hand);
    arms.push(arm);
  }
  const legs = [];
  for (const sgn of [-1, 1]) {
    const leg = jointedLimb({ r: 0.32, upper: 1.2, lower: 1.25, mat: M.iceMat(), jointMat: M.fleshGrey(), bend: 0.3, segs: 6 });
    leg.position.set(sgn * 0.42, -0.85, 0);
    torso.add(leg);
    leg.userData.end.add(b(0.48, 0.16, 0.88, M.iceMat(), 0, -0.06, 0.18));
    legs.push(leg);
  }

  g.userData.parts = { torso, head, arms, legs, eyes, shell, woman };
  g.userData.tick = (t, amp, state) => {
    iceHead.rotation.y = Math.sin(t * 0.25) * 0.08;
    // in the last phase the shell is gone and she is finally visible
    shell.visible = !g.userData.shellBroken;
  };
  return bakeStatics(g);
}

/** THE MOTHER STALK — the fruiting body of the whole valley. */
function buildMotherstalk() {
  const g = new THREE.Group();
  const M = mats;
  const torso = new THREE.Group(); torso.position.y = 2.4; g.add(torso);

  const stalk = seg(0.95, 0.55, 2.6, M.fungal(), 12);
  stalk.position.y = -0.3;
  torso.add(stalk);
  const bulb = s(0.75, M.capMat(), 0, -1.4, 0.35, 1);
  bulb.scale.set(1.1, 0.85, 1.1);
  torso.add(bulb);

  // the cap
  const head = new THREE.Group();
  head.position.set(0, 1.6, 0);
  torso.add(head);
  const capMesh = new THREE.Mesh(new THREE.SphereGeometry(2.1, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), M.capMat());
  capMesh.scale.set(1, 0.55, 1);
  capMesh.castShadow = true;
  head.add(capMesh);
  const gills = new THREE.Mesh(new THREE.ConeGeometry(2.0, 0.6, 24, 1, true), M.sporeGlow());
  gills.rotation.x = Math.PI;
  gills.position.y = -0.05;
  head.add(gills);
  // a ring of eyes around the underside of the cap
  const eyes = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const e = s(0.10, M.sporeGlow(), Math.cos(a) * 1.5, -0.2, Math.sin(a) * 1.5, 0);
    head.add(e); eyes.push(e);
  }

  // tendrils instead of arms
  const arms = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const arm = jointedLimb({ r: 0.16, upper: 1.4, lower: 1.5, mat: M.fungal(), jointMat: M.capMat(), bend: 0.9, segs: 6 });
    arm.position.set(Math.cos(a) * 0.75, 0.3, Math.sin(a) * 0.65);
    arm.rotation.z = Math.cos(a) * 0.7;
    arm.rotation.x = -Math.sin(a) * 0.7;
    torso.add(arm);
    arm.userData.end.add(s(0.2, M.capMat(), 0, -0.1, 0, 0));
    arms.push(arm);
  }
  // roots instead of legs
  const legs = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const root = jointedLimb({ r: 0.2, upper: 0.9, lower: 1.0, mat: M.fungal(), jointMat: M.fungal(), bend: 0.9, segs: 5 });
    root.position.set(Math.cos(a) * 0.65, -1.5, Math.sin(a) * 0.65);
    root.rotation.z = Math.cos(a) * 0.9;
    root.rotation.x = -Math.sin(a) * 0.9;
    torso.add(root);
    legs.push(root);
  }

  g.userData.parts = { torso, head, arms, legs, eyes, gills, bulb };
  g.userData.tick = (t, amp, state) => {
    capMesh.rotation.y = Math.sin(t * 0.2) * 0.08;
    head.position.y = 1.6 + Math.sin(t * 0.5) * 0.12;
    gills.material.emissiveIntensity = 1.8 + Math.sin(t * 1.4) * 1.0;
    bulb.scale.setScalar(1 + Math.sin(t * 1.1) * 0.07);
    for (let i = 0; i < arms.length; i++) {
      arms[i].rotation.y = Math.sin(t * 0.8 + i) * 0.3;
    }
  };
  return bakeStatics(g);
}

export const BOSS_FACTORIES = {
  warden: buildWarden,
  chorister: buildChorister,
  gillfather: buildGillfather,
  pyreking: buildPyreking,
  hoarmother: buildHoarmother,
  motherstalk: buildMotherstalk,
};

/* ================================================================== */
/* the boss entity                                                     */
/* ================================================================== */

const _v = new THREE.Vector3();

export class Boss extends Entity {
  constructor(game, id, depthScale = 1) {
    const def = BOSSES[id];
    super(game, id, {
      faction: 'mutant', model: null,
      health: Math.round(def.health * depthScale),
      radius: def.radius, height: def.height, headHeight: def.headHeight,
      speed: def.speed, runSpeed: def.runSpeed, damage: def.damage,
      attackRange: def.attackRange, attackCooldown: def.attackCooldown,
      viewRange: def.viewRange, fov: 3.14, hearRange: 200,
      armor: def.armor, mass: def.mass, scale: 1, lootTable: 'nest', noise: 1.2,
    });
    this.def = def;
    this.isBoss = true;
    this.phase = 0;
    this.arena = new THREE.Vector3();
    this.arenaR = def.arena;
    this.attackTimerB = 2.0;
    this.windup = 0;
    this.pendingAttack = null;
    this.summonCooldown = 12;
    this.chargeTimer = 0;
    this.telegraph = 0;
    this.awake = false;

    // the model comes from the boss factory, not the creature table
    const factory = BOSS_FACTORIES[id];
    this.model = factory ? factory() : new THREE.Group();
    this.parts = this.model.userData.parts || { legs: [], arms: [] };
    this.model.visible = false;

    this.weakPoints = def.weakPoints.map((w) => ({ ...w, revealed: !w.hiddenUntilPhase }));
  }

  /** Damage multiplier for a shot that landed on `part`. */
  partMultiplier(part) {
    if (part === 'head') return 1.5;
    const wp = this.weakPoints.find((w) => w.name === part);
    if (!wp) return 0.65;                       // armour plate everywhere else
    if (!wp.revealed) return 0.65;
    return wp.mul;
  }

  spawnAt(x, z, scene) {
    this.spawn(x, z, scene);
    this.arena.set(x, 0, z);
    this.state = STATE.IDLE;
    this.awake = false;
  }

  wake() {
    if (this.awake) return;
    this.awake = true;
    this.state = STATE.CHASE;
    this.stateTime = 0;
    Audio.mutantScream(this.position);
    this.game.ui.bossBar(this);
    this.game.ui.subtitle(this.def.title);
    this.game.director?.onScream?.(this.position);
  }

  onDamaged(dmg, dir, point, part) {
    this.wake();
    this.alertLevel = 1;
    this.lastKnownPos.copy(this.game.player.position);
    const frac = this.health / this.maxHealth;
    const next = this.def.phases.findIndex((p, i) => i > this.phase && frac <= p.at);
    if (next > 0) this.enterPhase(next);
  }

  enterPhase(i) {
    this.phase = i;
    const p = this.def.phases[i];
    this.game.ui.toast(p.label.toUpperCase(), 'bad');
    this.game.ui.subtitle(p.label);
    Audio.mutantScream(this.position);
    for (const w of this.weakPoints) {
      if (w.hiddenUntilPhase !== undefined && i >= w.hiddenUntilPhase) w.revealed = true;
    }
    if (this.def.id === 'hoarmother' && i >= 2) this.model.userData.shellBroken = true;
    // a phase change knocks the arena's minions loose as well
    this.game.entities.alertNear(this.position, 90, this, 1.0, this.game.player.position);
  }

  onDeath() {
    Audio.mutantDeath(this.type, this.position);
    this.game.fx?.blood(this.eyePos, new THREE.Vector3(0, 1, 0), 90);
    this.game.ui.hideBossBar();
    this.game.onBossDefeated?.(this);
  }

  /* ---------------- attacks ---------------- */

  chooseAttack(dist) {
    const set = this.def.phases[this.phase].attacks;
    const usable = set.filter((a) => {
      if (a === 'summon') return this.summonCooldown <= 0;
      if (a === 'charge') return dist > 8 && dist < 34;
      if (a === 'shardvolley' || a === 'firelash' || a === 'spikes' || a === 'sporecloud' || a === 'tendril') return dist < 30;
      return dist <= this.attackRange + 1.5;
    });
    if (!usable.length) return null;
    return usable[Math.floor(Math.random() * usable.length)];
  }

  startAttack(name) {
    this.pendingAttack = name;
    this.windup = WINDUP[name] ?? 0.7;
    this.telegraph = this.windup;
    Audio.mutantGrowl(this.type, this.position);
  }

  executeAttack(name) {
    const P = this.game.player;
    const d = this.distanceToPlayer();
    const dir = _v.set(P.position.x - this.position.x, 0, P.position.z - this.position.z).normalize();
    const hit = (dmg, range, opts) => {
      if (d <= range) this.game.damage.applyToPlayer(dmg * this.game.difficulty.dmgTaken, this.def.name, { dir, ...opts });
    };

    switch (name) {
      case 'sweep':
        Audio.mutantAttack(this.position);
        hit(this.damage * 0.8, this.attackRange + 1.4, { bleed: 0.5 });
        break;
      case 'slam':
        Audio.mutantAttack(this.position);
        this.game.fx?.impact(this.position.clone().addScaledVector(dir, 2), new THREE.Vector3(0, 1, 0), 'dirt');
        hit(this.damage * 1.25, this.attackRange + 0.8, { bleed: 0.7 });
        if (d < this.attackRange + 3) { P.velocity.y += 4.5; P.velocity.x += dir.x * 6; P.velocity.z += dir.z * 6; }
        break;
      case 'bite':
        Audio.mutantAttack(this.position);
        hit(this.damage * 1.4, this.attackRange, { bleed: 1.0 });
        break;
      case 'lash':
        // two fast swipes rather than one heavy one: cheap to dodge, brutal
        // if you were already committed to standing still
        Audio.mutantAttack(this.position);
        hit(this.damage * 0.55, this.attackRange + 0.6, { bleed: 0.3 });
        setTimeout(() => {
          if (!this.alive) return;
          Audio.mutantAttack(this.position);
          const d2 = this.distanceToPlayer();
          if (d2 <= this.attackRange + 0.6) {
            this.game.damage.applyToPlayer(this.damage * 0.55 * this.game.difficulty.dmgTaken,
              this.def.name, { dir, bleed: 0.3 });
          }
        }, 260);
        break;
      case 'charge':
        this.chargeTimer = 1.8;
        Audio.mutantGrowl(this.type, this.position);
        break;
      case 'shardvolley':
      case 'firelash':
      case 'spikes':
      case 'tendril': {
        // A reach attack: it hits at range, but only along the line it was
        // telegraphed on, so sidestepping works.
        const toP = _v.set(P.position.x - this.position.x, 0, P.position.z - this.position.z);
        const dist = toP.length() || 1;
        toP.divideScalar(dist);
        const facing = Math.cos(this.yaw) * -toP.z + Math.sin(this.yaw) * -toP.x;
        Audio.mutantAttack(this.position);
        if (dist < 30 && facing > 0.72) {
          this.game.damage.applyToPlayer(this.damage * 0.7 * this.game.difficulty.dmgTaken, this.def.name,
            { dir: toP, bleed: name === 'spikes' ? 0.8 : 0.3 });
        }
        break;
      }
      case 'sporecloud':
      case 'nova':
      case 'collapse': {
        Audio.mutantScream(this.position);
        const r = name === 'nova' ? 14 : name === 'collapse' ? 11 : 9;
        if (d < r) {
          this.game.damage.applyToPlayer(this.damage * (1.1 - d / r) * this.game.difficulty.dmgTaken,
            this.def.name, { dir, bleed: 0.4 });
        }
        this.game.ui.damageFlash(0.5);
        break;
      }
      case 'summon': {
        this.summonCooldown = 22;
        const roster = this.game.biome?.creatures?.mutants || ['stalker'];
        const n = 2 + this.phase;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, rr = 9 + Math.random() * 12;
          const x = this.position.x + Math.cos(a) * rr;
          const z = this.position.z + Math.sin(a) * rr;
          const m = this.game.entities.spawnMutant(roster[i % roster.length], x, z);
          if (m) { m.hasBeenSeen = true; m.state = STATE.CHASE; m.alertLevel = 1; }
        }
        this.game.ui.toast('It called for help', 'bad');
        break;
      }
      default: break;
    }
  }

  /* ---------------- brain ---------------- */

  update(dt, dist, lod) {
    if (!this.alive) return;
    this.stateTime += dt;
    this.summonCooldown = Math.max(0, this.summonCooldown - dt);
    this.telegraph = Math.max(0, this.telegraph - dt);

    if (!this.awake) {
      // dormant until you come to it, or shoot it
      if (dist < this.arenaR * 0.55) this.wake();
      this.animate(dt, 0);
      return;
    }

    const P = this.game.player;
    const speedMul = this.def.phases[this.phase].speed;

    // wind-up: it is committed, and you can see that it is committed
    if (this.windup > 0) {
      this.windup -= dt;
      this.targetYaw = Math.atan2(-(P.position.x - this.position.x), -(P.position.z - this.position.z));
      if (this.windup <= 0 && this.pendingAttack) {
        const a = this.pendingAttack;
        this.pendingAttack = null;
        this.executeAttack(a);
        this.attackTimerB = this.attackCooldown / speedMul;
      }
      this.applyPhysics(dt);
      this.animate(dt, 0.2);
      this.poseBoss(dt, true);
      return;
    }

    // stay in the arena; a boss that can be walked away from is a chore
    const fromArena = Math.hypot(this.position.x - this.arena.x, this.position.z - this.arena.z);
    const chasing = dist < this.arenaR * 1.5;

    if (this.def.rooted) {
      // it does not walk: it turns, and everything else comes to it
      this.targetYaw = Math.atan2(-(P.position.x - this.position.x), -(P.position.z - this.position.z));
    } else if (this.chargeTimer > 0) {
      this.chargeTimer -= dt;
      this.steerTo(dt, P.position.x, P.position.z, this.runSpeed * 1.7 * speedMul);
    } else if (fromArena > this.arenaR && !chasing) {
      this.steerTo(dt, this.arena.x, this.arena.z, this.speed * speedMul);
    } else if (dist > this.attackRange * 0.8) {
      this.steerTo(dt, P.position.x, P.position.z, this.runSpeed * speedMul);
    } else {
      this.targetYaw = Math.atan2(-(P.position.x - this.position.x), -(P.position.z - this.position.z));
    }

    this.attackTimerB -= dt;
    if (this.attackTimerB <= 0) {
      const a = this.chooseAttack(dist);
      if (a) this.startAttack(a);
      else this.attackTimerB = 0.5;
    }

    this.applyPhysics(dt);
    this.animate(dt, this.chargeTimer > 0 ? 1 : 0.7);
    this.poseBoss(dt, false);
    if (this.def.floats) {
      this.model.position.y = this.position.y + 0.8 + Math.sin(this.game.time * 0.6) * 0.2;
    }
  }

  /** A visible tell: it rears back before everything it does. */
  poseBoss(dt, windingUp) {
    const t = this.telegraph > 0 ? Math.min(1, this.telegraph / 0.7) : 0;
    if (this.parts.torso) this.parts.torso.rotation.x = -t * 0.35;
    if (this.parts.arms) {
      for (const a of this.parts.arms) a.rotation.x = -t * 1.5;
    }
  }
}

const WINDUP = {
  sweep: 0.65, slam: 0.9, bite: 0.55, charge: 0.8, lash: 0.45,
  shardvolley: 1.0, firelash: 0.85, spikes: 1.0, tendril: 0.9,
  sporecloud: 1.2, nova: 1.4, collapse: 1.3, summon: 1.1,
};
