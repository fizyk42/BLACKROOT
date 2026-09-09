/**
 * CreatureModels — procedural creatures with named joints so the AI can
 * animate them in code (no skeletal data, no external assets).
 *
 * Design rule for the mutants: **silhouette first**. Every one of them has to
 * be identifiable from a single dark shape at forty metres, before you can see
 * any detail, because that is the only information the player usually gets.
 * So no two share a body plan:
 *
 *   Stalker    tall, thin, backward knees, no head shape at all — just a
 *              smooth bulb that splits open vertically
 *   Brute      wide asymmetric wedge; one fused bone club for an arm, ribs
 *              splayed open like a cage door, skull sunk into the shoulders
 *   Crawler    low and flat; a human torso dragged face-up by six spider arms
 *              with the head hanging backwards, watching you
 *   Screamer   a walking horn: the ribcage hinged open into a bell around a
 *              throat sac, tiny head thrown back, jaw unhinged to the sternum
 *   Choir      no legs at all — a hovering cruciform inside a ring of shards
 *   Drowned    bloated pear with a drooping bioluminescent lure
 *   Ashwalker  a cracked crust with light leaking out of it, one arm burnt
 *              back to bone
 *   Rimewretch humanoid caged inside its own ice, spines down the spine
 *   Sporebearer hunched, with a fungal cap where a head should be
 *
 * Each factory returns a Group with userData.parts = { torso, head, legs[], ... }
 * and the group origin at the creature's feet. An optional userData.tick(t, amp)
 * runs per frame for anything the shared animator cannot express.
 */
import * as THREE from 'three';
import { mergeGeometries } from '../world/Flora.js';

const mats = {};
function M(key, opts) {
  if (!mats[key]) mats[key] = new THREE.MeshStandardMaterial(opts);
  return mats[key];
}
function MP(key, opts) {
  if (!mats[key]) mats[key] = new THREE.MeshPhysicalMaterial(opts);
  return mats[key];
}

/* ---------------- palette ---------------- */

const fleshPale = () => M('fleshPale', { color: 0x8e8073, roughness: 0.92, metalness: 0, flatShading: true });
const fleshGrey = () => M('fleshGrey', { color: 0x6f6a63, roughness: 0.95, metalness: 0, flatShading: true });
const fleshDark = () => M('fleshDark', { color: 0x5d5145, roughness: 0.95, metalness: 0, flatShading: true });
const fleshRaw = () => M('fleshRaw', { color: 0x6e3a34, roughness: 0.85, metalness: 0, flatShading: true });
const fleshWet = () => M('fleshWet', { color: 0x7d3f3a, roughness: 0.42, metalness: 0.05, flatShading: true });
const bone = () => M('bone', { color: 0xbdb49c, roughness: 0.72, metalness: 0, flatShading: true });
const boneOld = () => M('boneOld', { color: 0x8d8571, roughness: 0.85, metalness: 0, flatShading: true });
const sinew = () => M('sinew', { color: 0x54322e, roughness: 0.6, metalness: 0, flatShading: true });
const charred = () => M('charred', { color: 0x1b1815, roughness: 1, metalness: 0, flatShading: true });
const ember = () => M('ember', { color: 0xff5a20, emissive: 0xff3a08, emissiveIntensity: 3.4, roughness: 1 });
const iceMat = () => MP('ice', {
  color: 0xa8d8e8, roughness: 0.12, metalness: 0, transmission: 0.55,
  thickness: 0.4, transparent: true, opacity: 0.72, flatShading: true,
});
const drowned = () => MP('drownedFlesh', {
  color: 0x7d9a92, roughness: 0.35, metalness: 0.02, transmission: 0.25,
  thickness: 0.6, transparent: true, opacity: 0.88, flatShading: true,
});
const lure = () => M('lure', { color: 0x9ffff0, emissive: 0x40ffe0, emissiveIntensity: 4.2, roughness: 1 });
const voidSkin = () => M('voidSkin', { color: 0x0d0b16, roughness: 0.55, metalness: 0.25, flatShading: true });
const voidGlow = () => M('voidGlow', { color: 0xb18cff, emissive: 0x7a44ff, emissiveIntensity: 3.6, roughness: 1 });
const fungal = () => M('fungal', { color: 0x6a5e43, roughness: 1, metalness: 0, flatShading: true });
const capMat = () => M('cap', { color: 0x7d4a63, roughness: 0.88, metalness: 0, flatShading: true });
const sporeGlow = () => M('sporeGlow', { color: 0xc9ff8a, emissive: 0x8fe04a, emissiveIntensity: 2.4, roughness: 1 });

const furBrown = () => M('furBrown', { color: 0x4a3a28, roughness: 1, metalness: 0, flatShading: true });
const furGrey = () => M('furGrey', { color: 0x54524d, roughness: 1, metalness: 0, flatShading: true });
const furDark = () => M('furDark', { color: 0x2f2a25, roughness: 1, metalness: 0, flatShading: true });
const furLight = () => M('furLight', { color: 0x8d7f6a, roughness: 1, metalness: 0, flatShading: true });

const eyeMat = () => M('eye', { color: 0xffe9c0, emissive: 0xffcf80, emissiveIntensity: 2.6, roughness: 1 });
const eyeRed = () => M('eyeRed', { color: 0xff6a4a, emissive: 0xff2a10, emissiveIntensity: 3.0, roughness: 1 });
const eyeCold = () => M('eyeCold', { color: 0xbfe6ff, emissive: 0x6fd0ff, emissiveIntensity: 3.2, roughness: 1 });
const toothMat = () => M('tooth', { color: 0xd8d0b8, roughness: 0.5, flatShading: true });

/* ---------------- primitives ---------------- */

function b(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function s(r, mat, x = 0, y = 0, z = 0, detail = 0) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
/** A tapered limb segment that hangs from its own top end. */
function seg(rTop, rBot, len, mat, segs = 6) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rBot, rTop, len, segs, 1), mat);
  m.position.y = -len / 2;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function cap(r, len, mat, segs = 8) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, segs), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function spike(r, len, mat, segs = 5) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, len, segs), mat);
  m.castShadow = true;
  return m;
}
/** A limb pivoting from its top end (kept for the wildlife). */
function limb(w, len, d, mat) {
  const pivot = new THREE.Group();
  pivot.add(b(w, len, d, mat, 0, -len / 2, 0));
  return pivot;
}

/**
 * A two-segment limb that hangs from a shoulder/hip group.
 * `knee` is the sign of the mid-joint bend, so a negative value gives the
 * backward-jointed leg that makes the Stalker read as wrong from a distance.
 */
function jointedLimb(opt) {
  const root = new THREE.Group();
  const upper = seg(opt.r, opt.r * 0.82, opt.upper, opt.mat, opt.segs || 6);
  root.add(upper);
  const mid = new THREE.Group();
  mid.position.y = -opt.upper;
  mid.rotation.x = opt.bend || 0;
  root.add(mid);
  if (opt.joint !== false) mid.add(s(opt.r * 1.15, opt.jointMat || opt.mat, 0, 0, 0, 0));
  const lower = seg(opt.r * 0.82, opt.r * 0.6, opt.lower, opt.mat, opt.segs || 6);
  mid.add(lower);
  const end = new THREE.Group();
  end.position.y = -opt.lower;
  mid.add(end);
  root.userData.mid = mid;
  root.userData.end = end;
  return root;
}

/**
 * Long grasping fingers, used everywhere a hand would be too kind.
 * The fingers are direct mesh children of one group with their rotation baked
 * into the geometry, so the draw-call baker can fold a whole hand into one
 * mesh instead of leaving five.
 */
function claw(count, len, mat, spread = 0.5) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = count > 1 ? (i / (count - 1) - 0.5) * spread : 0;
    const m = seg(0.028, 0.008, len, mat, 4);
    m.rotation.z = a;
    m.rotation.x = 0.2 + Math.abs(a) * 0.6;
    g.add(m);
  }
  return g;
}

/**
 * A splayed ribcage. `open` swings each rib outward from the spine, which is
 * what turns a chest into a cage (Brute) or a bell (Screamer).
 *
 * Nested groups rather than stacked Euler angles: a rib needs a side, a hinge
 * and a lie-flat, and doing all three on one object depends on rotation order
 * in a way that is very easy to get subtly wrong.
 */
function ribcage(opt) {
  const g = new THREE.Group();
  const n = opt.count || 6;
  const mat = opt.mat || bone();
  // Each rib's side/hinge/lie-flat is composed on a scratch object and baked
  // into the geometry, so the whole cage ends up as sibling meshes sharing one
  // material — which the draw-call baker folds into a single mesh.
  const scratch = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const y = opt.top - t * opt.height;
    const r = opt.radius * (0.7 + Math.sin(t * Math.PI) * 0.55);
    for (const sgn of [-1, 1]) {
      const geo = new THREE.TorusGeometry(r, opt.thick || 0.026, 4, 12, Math.PI * 0.72);
      geo.rotateX(-Math.PI / 2);                            // lay the arc flat
      scratch.position.set(0, 0, 0);
      scratch.rotation.set(0, sgn > 0 ? 0 : Math.PI, 0);
      scratch.updateMatrix();
      geo.applyMatrix4(scratch.matrix);                     // put it on a side
      scratch.rotation.set(0, 0, -sgn * (opt.open || 0) * (0.4 + t * 0.6));
      scratch.updateMatrix();
      geo.applyMatrix4(scratch.matrix);                     // swing it open
      geo.translate(0, y, -opt.radius * 0.45);
      const rib = new THREE.Mesh(geo, mat);
      rib.castShadow = true;
      g.add(rib);
    }
  }
  if (opt.spine !== false) {
    g.add(b(opt.radius * 0.28, opt.height * 1.06, opt.radius * 0.3, mat,
      0, opt.top - opt.height * 0.5, -opt.radius * 0.55));
  }
  return g;
}

/** A vertical maw that splits a smooth surface open. */
function verticalMaw(h, w, mat) {
  const g = new THREE.Group();
  const left = new THREE.Group();
  const right = new THREE.Group();
  for (const [side, sgn] of [[left, -1], [right, 1]]) {
    const lip = b(w * 0.22, h, w * 0.5, mat, sgn * w * 0.14, 0, 0);
    side.add(lip);
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const th = spike(0.016, 0.05 + Math.sin(t * Math.PI) * 0.055, toothMat(), 4);
      th.rotation.z = sgn * (Math.PI / 2 - 0.25);
      th.position.set(sgn * w * 0.05, h * (0.42 - t * 0.84), w * 0.16);
      side.add(th);
    }
    g.add(side);
  }
  g.userData.left = left;
  g.userData.right = right;
  return g;
}

/** A cluster of small eyes where a face should not have them. */
function eyeCluster(n, radius, size, mat, rng = Math.random) {
  const g = new THREE.Group();
  const eyes = [];
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2, u = rng() * 0.8 - 0.1;
    const r = Math.sqrt(1 - u * u) * radius;
    const e = s(size * (0.6 + rng() * 0.7), mat, Math.cos(a) * r, u * radius, Math.abs(Math.sin(a)) * r * 0.5 + radius * 0.5, 0);
    g.add(e); eyes.push(e);
  }
  g.userData.eyes = eyes;
  return g;
}

/* ------------------------------------------------------------------ */
/* draw-call baking                                                    */
/* ------------------------------------------------------------------ */

/**
 * Merge the static sibling meshes of every group into one mesh per material.
 *
 * A creature built out of forty little meshes costs forty draw calls every
 * frame it is on screen, and a horde of them costs a thousand. The parts that
 * actually move are named in `userData.parts` and are left alone; everything
 * else — ribs, teeth, horns, plates, seams — is decoration rigidly attached to
 * a parent that does move, so it can be baked into that parent as one mesh
 * with no visible difference at all.
 */
export function bakeStatics(root, keep) {
  const protect = new Set(keep || []);
  // Only the named object itself is protected, not its whole subtree: merging
  // happens *within* a group, so a static mesh under an animated group still
  // moves with it after being baked into its siblings.
  const collect = (v) => {
    if (!v) return;
    if (Array.isArray(v)) { v.forEach(collect); return; }
    if (v.isObject3D) protect.add(v);
  };
  // Everything named in `parts` is assumed to move — except the eyes, which
  // are only ever lit, never animated, and are numerous enough to be worth
  // folding in.
  const parts = root.userData.parts || {};
  for (const [k, v] of Object.entries(parts)) if (k !== 'eyes') collect(v);

  const groups = [];
  root.traverse((o) => { if (o.isGroup || o === root) groups.push(o); });

  for (const g of groups) {
    const byMat = new Map();
    for (const child of g.children) {
      if (!child.isMesh || child.children.length || protect.has(child)) continue;
      if (!child.geometry || !child.geometry.attributes.position) continue;
      const key = child.material.uuid;
      let arr = byMat.get(key);
      if (!arr) { arr = { mat: child.material, list: [] }; byMat.set(key, arr); }
      arr.list.push(child);
    }
    for (const { mat, list } of byMat.values()) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        const gg = m.geometry.clone();
        gg.applyMatrix4(m.matrix);
        if (!gg.attributes.uv) {
          gg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2));
        }
        return gg;
      });
      const merged = new THREE.Mesh(mergeGeometries(geos), mat);
      merged.castShadow = true;
      merged.receiveShadow = true;
      for (const m of list) g.remove(m);
      g.add(merged);
    }
  }
  return root;
}

/* ================================================================== */
/* mutants                                                             */
/* ================================================================== */

/**
 * STALKER — "the long quiet". 2.4 m, narrow enough to hide behind a trunk,
 * with knees that bend the wrong way and no head to speak of.
 */
export function buildStalker() {
  const g = new THREE.Group();
  const torso = new THREE.Group(); torso.position.y = 1.62; g.add(torso);

  // a long, shallow chest — closer to a greyhound's than a man's
  const chest = cap(0.17, 0.62, fleshPale(), 8);
  chest.scale.set(1.0, 1, 0.62);
  torso.add(chest);
  torso.add(ribcage({ top: 0.30, height: 0.62, radius: 0.20, count: 7, open: 0.05, thick: 0.018, mat: boneOld() }));
  // hips, far too narrow
  torso.add(cap(0.115, 0.14, fleshDark(), 8).translateY(-0.44));
  // shoulder blades that stand proud of the back like folded wings
  for (const sgn of [-1, 1]) {
    const blade = b(0.055, 0.34, 0.16, fleshDark(), sgn * 0.16, 0.16, -0.13);
    blade.rotation.z = sgn * 0.22;
    torso.add(blade);
  }

  // neck: three vertebrae, too many, holding the head forward of the body
  const neck = new THREE.Group();
  neck.position.set(0, 0.34, 0.02);
  torso.add(neck);
  for (let i = 0; i < 3; i++) neck.add(s(0.055 - i * 0.006, fleshGrey(), 0, 0.07 + i * 0.075, 0.012 * i, 0));

  // head: a featureless bulb. The horror is the absence.
  const head = new THREE.Group();
  head.position.set(0, 0.30, 0.03);
  neck.add(head);
  const bulb = s(0.135, fleshPale(), 0, 0, 0, 1);
  bulb.scale.set(0.78, 1.28, 0.92);
  head.add(bulb);
  const maw = verticalMaw(0.20, 0.13, fleshRaw());
  maw.position.set(0, -0.01, 0.085);
  head.add(maw);

  // arms longer than the legs, ending in hands that reach the ankles
  const arms = [];
  for (const sgn of [-1, 1]) {
    const arm = jointedLimb({ r: 0.052, upper: 0.52, lower: 0.56, mat: fleshPale(), jointMat: fleshRaw(), bend: 0.34 });
    arm.position.set(sgn * 0.20, 0.24, 0);
    arm.rotation.z = sgn * 0.10;
    torso.add(arm);
    const hand = claw(4, 0.30, fleshPale(), 0.7);
    arm.userData.end.add(hand);
    arms.push(arm);
  }

  // backward-jointed legs
  const legs = [];
  for (const sgn of [-1, 1]) {
    const leg = jointedLimb({ r: 0.072, upper: 0.60, lower: 0.62, mat: fleshDark(), jointMat: boneOld(), bend: -0.62 });
    leg.position.set(sgn * 0.10, -0.48, 0);
    torso.add(leg);
    const foot = b(0.10, 0.05, 0.26, fleshDark(), 0, -0.02, 0.07);
    leg.userData.end.add(foot);
    leg.userData.end.rotation.x = 0.55;
    legs.push(leg);
  }

  g.userData.parts = { torso, head, neck, arms, legs, eyes: [], maw };
  g.userData.tick = (t, amp, state) => {
    // the maw opens as it commits, and the head tracks a half-beat late
    const open = state === 'ATTACK' || state === 'CHASE' ? 0.55 : 0.06 + Math.sin(t * 0.7) * 0.05;
    maw.userData.left.rotation.y = open;
    maw.userData.right.rotation.y = -open;
    head.rotation.x = Math.sin(t * 0.9) * 0.06 - amp * 0.25;
  };
  return bakeStatics(g);
}

/**
 * BRUTE — "the anvil". Wide, asymmetric, and built around one fused arm that
 * weighs more than the rest of it.
 */
export function buildBrute() {
  const g = new THREE.Group();
  const torso = new THREE.Group(); torso.position.y = 1.42; g.add(torso);

  // mass sits high and forward: a wedge, widest at the shoulders
  const trunk = cap(0.44, 0.52, fleshDark(), 10);
  trunk.scale.set(1.25, 1, 0.82);
  torso.add(trunk);
  torso.add(s(0.40, fleshDark(), 0, 0.30, -0.22, 1));         // fused shoulder mass
  // the ribs are open — the cage stands away from the body on the left side
  const cage = ribcage({ top: 0.26, height: 0.66, radius: 0.34, count: 6, open: 0.55, thick: 0.038, mat: bone() });
  cage.position.z = 0.06;
  torso.add(cage);
  torso.add(s(0.22, fleshWet(), 0.02, -0.06, 0.20, 1));       // what the cage is holding

  // no neck: the skull is sunk between the shoulders, tilted back
  const head = new THREE.Group();
  head.position.set(-0.06, 0.30, 0.16);
  head.rotation.x = -0.45;
  torso.add(head);
  const skull = s(0.24, fleshDark(), 0, 0, 0, 1);
  skull.scale.set(1.0, 0.82, 1.15);
  head.add(skull);
  const jaw = b(0.30, 0.14, 0.30, fleshRaw(), 0, -0.16, 0.10);
  head.add(jaw);
  for (let i = 0; i < 5; i++) {
    const th = spike(0.022, 0.09, toothMat(), 4);
    th.rotation.x = Math.PI;
    th.position.set(-0.10 + i * 0.05, -0.09, 0.19);
    head.add(th);
  }
  const eyeL = s(0.030, eyeRed(), -0.10, 0.06, 0.20);
  const eyeR = s(0.026, eyeRed(), 0.11, 0.03, 0.19);
  head.add(eyeL, eyeR);

  // asymmetric arms: the left is a club of fused bone
  const arms = [];
  const big = jointedLimb({ r: 0.20, upper: 0.62, lower: 0.66, mat: fleshDark(), jointMat: bone(), bend: 0.30, segs: 8 });
  big.position.set(-0.56, 0.24, 0);
  torso.add(big);
  const club = s(0.32, bone(), 0, -0.14, 0.02, 1);
  club.scale.set(1.0, 1.35, 1.0);
  big.userData.end.add(club);
  for (let i = 0; i < 6; i++) {
    const sp = spike(0.05, 0.20, boneOld(), 5);
    const a = (i / 6) * Math.PI * 2;
    sp.position.set(Math.cos(a) * 0.26, -0.16, Math.sin(a) * 0.26);
    sp.rotation.z = -Math.cos(a) * 1.2;
    sp.rotation.x = Math.sin(a) * 1.2;
    big.userData.end.add(sp);
  }
  arms.push(big);

  const small = jointedLimb({ r: 0.085, upper: 0.42, lower: 0.40, mat: fleshRaw(), jointMat: bone(), bend: 0.7 });
  small.position.set(0.50, 0.26, 0.04);
  small.rotation.z = -0.35;
  torso.add(small);
  small.userData.end.add(claw(3, 0.16, fleshRaw(), 0.6));
  arms.push(small);

  // short, heavy, plantigrade legs
  const legs = [];
  for (const sgn of [-1, 1]) {
    const leg = jointedLimb({ r: 0.17, upper: 0.40, lower: 0.42, mat: fleshDark(), jointMat: bone(), bend: 0.3, segs: 7 });
    leg.position.set(sgn * 0.24, -0.36, 0);
    torso.add(leg);
    leg.userData.end.add(b(0.30, 0.12, 0.42, fleshDark(), 0, -0.04, 0.08));
    legs.push(leg);
  }

  g.userData.parts = { torso, head, arms, legs, eyes: [eyeL, eyeR], jaw };
  g.userData.tick = (t, amp, state) => {
    jaw.rotation.x = (state === 'ATTACK' ? 0.5 : 0.08) + Math.sin(t * 1.7) * 0.05;
    cage.rotation.x = Math.sin(t * 1.1) * 0.04;      // it breathes through the opening
  };
  return bakeStatics(g);
}

/**
 * CRAWLER — "the dragging". A torso hauled face-up by six spider arms, with
 * the head hanging backwards over the shoulders so it can watch you while the
 * body runs the other way.
 */
export function buildCrawler() {
  const g = new THREE.Group();
  const torso = new THREE.Group(); torso.position.y = 0.52; g.add(torso);

  // the body is horizontal, chest to the sky
  const body = cap(0.20, 0.62, fleshRaw(), 9);
  body.rotation.x = Math.PI / 2;
  body.scale.set(1.15, 1, 0.7);
  torso.add(body);
  const cage = ribcage({ top: 0.30, height: 0.62, radius: 0.21, count: 6, open: 0.30, thick: 0.02, mat: boneOld(), spine: false });
  cage.rotation.x = -Math.PI / 2;
  cage.position.z = 0.02;
  torso.add(cage);
  torso.add(b(0.28, 0.10, 0.66, sinew(), 0, -0.12, 0));       // the dragging underside

  // head hangs backwards off the neck, upside down
  const neck = new THREE.Group();
  neck.position.set(0, 0.02, -0.36);
  torso.add(neck);
  neck.add(cap(0.055, 0.16, fleshWet(), 7).rotateX(1.1));
  const head = new THREE.Group();
  head.position.set(0, -0.14, -0.16);
  head.rotation.x = Math.PI * 0.92;
  neck.add(head);
  const skull = s(0.155, fleshPale(), 0, 0, 0, 1);
  skull.scale.set(0.86, 1.1, 0.94);
  head.add(skull);
  head.add(b(0.16, 0.09, 0.14, fleshRaw(), 0, -0.11, 0.09));
  const eyes = [
    s(0.026, eyeRed(), -0.06, 0.02, 0.13),
    s(0.026, eyeRed(), 0.06, 0.02, 0.13),
  ];
  head.add(...eyes);

  // six long arms, three a side, sprouting from between the ribs
  const legs = [];
  for (let i = 0; i < 6; i++) {
    const sgn = i % 2 ? 1 : -1;
    const row = Math.floor(i / 2);           // 0 front, 1 middle, 2 rear
    const arm = jointedLimb({
      r: 0.045, upper: 0.34 + row * 0.03, lower: 0.40 + row * 0.04,
      mat: fleshPale(), jointMat: boneOld(), bend: 1.15, segs: 5,
    });
    arm.position.set(sgn * 0.17, 0.06, 0.26 - row * 0.26);
    arm.rotation.z = sgn * (1.05 + row * 0.06);
    arm.rotation.y = sgn * (0.5 - row * 0.5);
    torso.add(arm);
    arm.userData.end.add(claw(3, 0.13, fleshPale(), 0.8));
    legs.push(arm);
  }

  g.userData.parts = { torso, head, neck, legs, arms: [], eyes };
  g.userData.tick = (t, amp) => {
    // the head lolls; it is not attached the way it should be
    head.rotation.z = Math.sin(t * 1.4) * 0.22;
    neck.rotation.x = Math.sin(t * 0.8) * 0.10 - amp * 0.15;
  };
  return bakeStatics(g);
}

/**
 * SCREAMER — "the bell". The ribcage has hinged open into a horn around a
 * throat sac; everything about it is built to move air.
 */
export function buildScreamer() {
  const g = new THREE.Group();
  const torso = new THREE.Group(); torso.position.y = 1.18; g.add(torso);

  torso.add(cap(0.115, 0.30, fleshPale(), 8).translateY(-0.18));   // narrow belly
  // the bell: ribs swung almost fully open and skinned between
  const bell = new THREE.Group();
  bell.position.y = 0.10;
  torso.add(bell);
  bell.add(ribcage({ top: 0.26, height: 0.52, radius: 0.40, count: 7, open: 1.35, thick: 0.024, mat: bone() }));
  const membrane = new THREE.Mesh(
    new THREE.ConeGeometry(0.52, 0.50, 14, 1, true),
    M('membrane', { color: 0x93585a, roughness: 0.55, side: THREE.DoubleSide, transparent: true, opacity: 0.92, flatShading: true })
  );
  membrane.rotation.x = -Math.PI / 2 + 0.25;
  membrane.position.set(0, 0.02, 0.16);
  bell.add(membrane);
  // the sac inside it
  const sac = s(0.16, fleshWet(), 0, 0.0, 0.06, 1);
  sac.scale.set(1, 0.85, 1.1);
  bell.add(sac);

  // tiny head thrown back on a long throat
  const neck = new THREE.Group();
  neck.position.set(0, 0.34, -0.04);
  torso.add(neck);
  neck.add(cap(0.05, 0.22, fleshPale(), 7).translateY(0.11));
  const head = new THREE.Group();
  head.position.set(0, 0.26, 0);
  head.rotation.x = -0.85;
  neck.add(head);
  head.add(s(0.105, fleshPale(), 0, 0, 0, 1));
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.05, 0.03);
  head.add(jaw);
  jaw.add(b(0.13, 0.30, 0.10, fleshRaw(), 0, -0.15, 0.03));       // unhinged to the sternum
  for (let i = 0; i < 6; i++) {
    const th = spike(0.012, 0.04, toothMat(), 4);
    th.rotation.x = Math.PI;
    th.position.set(-0.045 + (i % 3) * 0.045, -0.02, 0.06 - Math.floor(i / 3) * 0.02);
    jaw.add(th);
  }
  const eyes = [s(0.020, eyeMat(), -0.045, 0.05, 0.08), s(0.020, eyeMat(), 0.045, 0.05, 0.08)];
  head.add(...eyes);

  // limp arms, stilt legs
  const arms = [];
  for (const sgn of [-1, 1]) {
    const arm = jointedLimb({ r: 0.036, upper: 0.44, lower: 0.46, mat: fleshPale(), jointMat: fleshRaw(), bend: 0.15 });
    arm.position.set(sgn * 0.17, 0.16, -0.04);
    torso.add(arm);
    arm.userData.end.add(claw(4, 0.16, fleshPale(), 0.5));
    arms.push(arm);
  }
  const legs = [];
  for (const sgn of [-1, 1]) {
    const leg = jointedLimb({ r: 0.056, upper: 0.50, lower: 0.52, mat: fleshDark(), jointMat: boneOld(), bend: -0.35 });
    leg.position.set(sgn * 0.085, -0.36, 0);
    torso.add(leg);
    leg.userData.end.add(b(0.075, 0.04, 0.20, fleshDark(), 0, -0.02, 0.05));
    legs.push(leg);
  }

  g.userData.parts = { torso, head, neck, jaw, arms, legs, eyes, sac };
  g.userData.tick = (t, amp, state) => {
    const calling = state === 'ATTACK' || state === 'CHASE';
    const pump = calling ? 1 : 0.25 + Math.sin(t * 2.1) * 0.2;
    sac.scale.set(1 + pump * 0.35, 0.85 + pump * 0.3, 1.1 + pump * 0.35);
    jaw.rotation.x = pump * 0.75;
    membrane.scale.setScalar(1 + pump * 0.10);
  };
  return bakeStatics(g);
}

/* ---------------- biome mutants ---------------- */

/**
 * CHOIR (Void) — no legs. A cruciform torso hanging in the air inside a ring
 * of slowly turning shards, lit from inside its own cracks.
 */
export function buildChoir() {
  const g = new THREE.Group();
  const torso = new THREE.Group(); torso.position.y = 1.45; g.add(torso);

  const body = cap(0.19, 0.58, voidSkin(), 9);
  body.scale.set(1, 1, 0.7);
  torso.add(body);
  // light escapes from seams down the sternum
  for (let i = 0; i < 5; i++) {
    const seam = b(0.02, 0.10, 0.02, voidGlow(), 0, 0.24 - i * 0.11, 0.13);
    torso.add(seam);
  }
  torso.add(s(0.10, voidGlow(), 0, -0.34, 0.02, 0));     // the core, where the hips ended

  const head = new THREE.Group();
  head.position.set(0, 0.42, 0);
  torso.add(head);
  const skull = s(0.13, voidSkin(), 0, 0, 0, 1);
  skull.scale.set(0.9, 1.15, 0.9);
  head.add(skull);
  const cluster = eyeCluster(7, 0.115, 0.020, voidGlow());
  head.add(cluster);
  const eyes = cluster.userData.eyes;

  // arms trail rather than hang
  const arms = [];
  for (const sgn of [-1, 1]) {
    const arm = jointedLimb({ r: 0.042, upper: 0.46, lower: 0.50, mat: voidSkin(), jointMat: voidGlow(), bend: 0.5 });
    arm.position.set(sgn * 0.19, 0.22, 0);
    arm.rotation.z = sgn * 0.5;
    torso.add(arm);
    arm.userData.end.add(claw(4, 0.24, voidSkin(), 0.8));
    arms.push(arm);
  }
  // and the legs are only the memory of legs: two trailing ribbons
  const legs = [];
  for (const sgn of [-1, 1]) {
    const trail = new THREE.Group();
    trail.position.set(sgn * 0.07, -0.34, 0);
    for (let i = 0; i < 4; i++) {
      trail.add(cap(0.032 - i * 0.006, 0.16, voidSkin(), 6).translateY(-0.10 - i * 0.17));
    }
    torso.add(trail);
    legs.push(trail);
  }

  // the ring
  const ring = new THREE.Group();
  ring.position.y = 1.35;
  g.add(ring);
  const shards = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const sh = new THREE.Mesh(new THREE.OctahedronGeometry(0.07 + (i % 3) * 0.03, 0), voidGlow());
    sh.position.set(Math.cos(a) * 0.72, Math.sin(a * 2) * 0.16, Math.sin(a) * 0.72);
    ring.add(sh);
    shards.push(sh);
  }

  g.userData.parts = { torso, head, arms, legs, eyes };
  g.userData.tick = (t, amp, state) => {
    ring.rotation.y = t * (state === 'CHASE' ? 1.4 : 0.4);
    ring.rotation.z = Math.sin(t * 0.3) * 0.25;
    torso.position.y = 1.45 + Math.sin(t * 0.9) * 0.09;
    for (let i = 0; i < shards.length; i++) {
      shards[i].rotation.set(t * 1.2 + i, t * 0.8, 0);
    }
    for (const l of legs) l.rotation.x = Math.sin(t * 1.3 + l.position.x * 6) * 0.22 - amp * 0.4;
  };
  return bakeStatics(g);
}

/**
 * DROWNED (Abyss) — bloated, half-transparent, with a lure on a stalk that is
 * the only thing about it you can see until it is far too close.
 */
export function buildDrowned() {
  const g = new THREE.Group();
  const torso = new THREE.Group(); torso.position.y = 1.18; g.add(torso);

  const belly = s(0.42, drowned(), 0, -0.10, 0.02, 1);
  belly.scale.set(1.45, 1.18, 1.05);
  torso.add(belly);
  torso.add(ribcage({ top: 0.22, height: 0.52, radius: 0.44, count: 6, open: 0.12, thick: 0.024, mat: boneOld() }));
  torso.add(s(0.13, lure(), 0, -0.12, 0, 0));            // the light inside the gut

  // gill slits
  for (const sgn of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const slit = b(0.03, 0.13, 0.06, sinew(), sgn * 0.30, 0.16 - i * 0.09, 0.14);
      slit.rotation.z = sgn * 0.3;
      torso.add(slit);
    }
  }

  const head = new THREE.Group();
  head.position.set(0, 0.34, 0.06);
  torso.add(head);
  const skull = s(0.19, drowned(), 0, 0, 0, 1);
  skull.scale.set(1.05, 0.86, 1.1);
  head.add(skull);
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.12, 0.06);
  head.add(jaw);
  jaw.add(b(0.24, 0.10, 0.24, fleshWet(), 0, -0.05, 0.02));
  for (let i = 0; i < 9; i++) {
    const th = spike(0.014, 0.09, toothMat(), 4);
    th.position.set(-0.10 + (i % 5) * 0.05, 0.02, 0.13 - Math.floor(i / 5) * 0.06);
    jaw.add(th);
  }
  const eyes = [s(0.038, lure(), -0.09, 0.05, 0.15, 0), s(0.038, lure(), 0.09, 0.05, 0.15, 0)];
  head.add(...eyes);

  // the lure: a jointed stalk hanging in front of the face
  const stalk = new THREE.Group();
  stalk.position.set(0, 0.16, 0.02);
  head.add(stalk);
  const s1 = new THREE.Group(); stalk.add(s1);
  s1.add(seg(0.018, 0.012, 0.32, drowned(), 5).translateY(0.16).rotateX(0));
  s1.children[0].position.y = 0.16;
  const s2 = new THREE.Group(); s2.position.y = 0.32; s1.add(s2);
  s2.add(seg(0.012, 0.008, 0.26, drowned(), 5));
  s2.children[0].position.y = -0.13;
  const bulbLight = s(0.055, lure(), 0, -0.28, 0, 0);
  s2.add(bulbLight);

  const arms = [];
  for (const sgn of [-1, 1]) {
    const arm = jointedLimb({ r: 0.062, upper: 0.44, lower: 0.48, mat: drowned(), jointMat: fleshWet(), bend: 0.4 });
    arm.position.set(sgn * 0.30, 0.20, 0);
    torso.add(arm);
    const hand = claw(5, 0.26, drowned(), 1.1);   // webbed, far too wide
    arm.userData.end.add(hand);
    arms.push(arm);
  }
  const legs = [];
  for (const sgn of [-1, 1]) {
    const leg = jointedLimb({ r: 0.095, upper: 0.40, lower: 0.42, mat: drowned(), jointMat: boneOld(), bend: 0.35 });
    leg.position.set(sgn * 0.15, -0.44, 0);
    torso.add(leg);
    leg.userData.end.add(b(0.20, 0.05, 0.34, drowned(), 0, -0.02, 0.09));
    legs.push(leg);
  }

  g.userData.parts = { torso, head, jaw, arms, legs, eyes, lure: bulbLight };
  g.userData.tick = (t, amp, state) => {
    s1.rotation.x = 0.5 + Math.sin(t * 0.8) * 0.16;
    s2.rotation.x = -0.9 + Math.sin(t * 1.1 + 1) * 0.2;
    bulbLight.scale.setScalar(1 + Math.sin(t * 2.4) * 0.18);
    jaw.rotation.x = (state === 'ATTACK' ? 0.6 : 0.1) + Math.sin(t * 1.3) * 0.06;
    belly.scale.y = 1.18 + Math.sin(t * 1.05) * 0.05;
  };
  return bakeStatics(g);
}

/**
 * ASHWALKER (Cinder) — a crust of char over something still burning, with one
 * arm burnt back to the bone.
 */
export function buildAshwalker() {
  const g = new THREE.Group();
  const torso = new THREE.Group(); torso.position.y = 1.34; g.add(torso);
  torso.rotation.x = 0.22;            // it walks leaning into its own heat
  torso.rotation.z = -0.13;           // and it is not symmetrical any more

  const trunk = cap(0.22, 0.54, charred(), 9);
  trunk.scale.set(1.1, 1, 0.78);
  torso.add(trunk);
  // fissures where the crust has cracked
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const cr = b(0.035, 0.16 + (i % 3) * 0.07, 0.03, ember(), Math.cos(a) * 0.20, 0.20 - (i % 4) * 0.13, Math.sin(a) * 0.16);
    cr.rotation.y = -a;
    cr.rotation.z = (i % 2 ? 1 : -1) * 0.4;
    torso.add(cr);
  }
  torso.add(ribcage({ top: 0.24, height: 0.50, radius: 0.24, count: 5, open: 0.35, thick: 0.028, mat: charred() }));
  torso.add(s(0.15, ember(), 0, 0.02, 0.02, 0));     // the fire it is still carrying

  const head = new THREE.Group();
  head.position.set(0, 0.40, 0.02);
  torso.add(head);
  const skull = s(0.155, charred(), 0, 0, 0, 1);
  skull.scale.set(0.92, 1.1, 1.0);
  head.add(skull);
  // the face has burnt through: a lantern of a head
  const socket = s(0.085, ember(), 0, -0.01, 0.09, 0);
  socket.scale.set(1.25, 0.85, 0.5);
  head.add(socket);
  const eyes = [s(0.024, ember(), -0.055, 0.03, 0.13, 0), s(0.024, ember(), 0.055, 0.03, 0.13, 0)];
  head.add(...eyes);
  // a crest of burnt spines, swept back and to one side
  for (let i = 0; i < 7; i++) {
    const horn = spike(0.024, 0.18 + (i % 3) * 0.12, charred(), 4);
    horn.position.set(-0.10 + i * 0.034, 0.13, -0.04 - i * 0.012);
    horn.rotation.z = (i - 3) * 0.20 - 0.25;
    horn.rotation.x = -0.55;
    head.add(horn);
  }

  const arms = [];
  // left arm: still flesh, still burning
  const armL = jointedLimb({ r: 0.075, upper: 0.44, lower: 0.44, mat: charred(), jointMat: ember(), bend: 0.45 });
  armL.position.set(-0.26, 0.22, 0);
  torso.add(armL);
  armL.userData.end.add(claw(4, 0.20, charred(), 0.7));
  arms.push(armL);
  // right arm: burnt back to bone, and far longer for it — the asymmetry is
  // the whole silhouette
  const armR = jointedLimb({ r: 0.038, upper: 0.66, lower: 0.72, mat: boneOld(), jointMat: charred(), bend: 0.25 });
  armR.position.set(0.30, 0.22, 0);
  armR.rotation.z = -0.30;
  torso.add(armR);
  armR.userData.end.add(claw(3, 0.42, boneOld(), 1.1));
  arms.push(armR);

  const legs = [];
  for (const sgn of [-1, 1]) {
    const leg = jointedLimb({ r: 0.105, upper: 0.44, lower: 0.44, mat: charred(), jointMat: ember(), bend: 0.3 });
    leg.position.set(sgn * 0.14, -0.40, 0);
    torso.add(leg);
    leg.userData.end.add(b(0.19, 0.06, 0.30, charred(), 0, -0.03, 0.06));
    legs.push(leg);
  }

  g.userData.parts = { torso, head, arms, legs, eyes };
  g.userData.tick = (t, amp, state) => {
    const heat = state === 'CHASE' || state === 'ATTACK' ? 1 : 0.45;
    const flick = heat * (2.2 + Math.sin(t * 9.1) * 0.7 + Math.sin(t * 3.3) * 0.5);
    ember().emissiveIntensity = 1.6 + flick;
    head.rotation.z = Math.sin(t * 1.6) * 0.05;
  };
  return bakeStatics(g);
}

/**
 * RIMEWRETCH (Permafrost) — caged inside the ice that grew out of it, frozen
 * in the shape it died screaming in.
 */
export function buildRimewretch() {
  const g = new THREE.Group();
  const torso = new THREE.Group(); torso.position.y = 1.30; g.add(torso);

  torso.add(cap(0.20, 0.50, fleshGrey(), 9));
  // ice grows out of the back in a fan of spines
  // A fan of ice out of the back, wide enough to read as a shape of its own
  // at distance — the thing you see first is the ice, not the person in it.
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const sp = spike(0.055 + t * 0.02, 0.42 + Math.sin(t * Math.PI) * 0.55, iceMat(), 5);
    sp.position.set((t - 0.5) * 0.62, 0.14 + Math.sin(t * Math.PI) * 0.22, -0.22);
    sp.rotation.x = -0.8 - t * 0.2;
    sp.rotation.z = (t - 0.5) * 1.5;
    torso.add(sp);
  }
  // and encases the chest
  const shell = s(0.30, iceMat(), 0, 0.04, 0.04, 1);
  shell.scale.set(1.05, 1.15, 0.9);
  torso.add(shell);

  const head = new THREE.Group();
  head.position.set(0, 0.38, 0.01);
  torso.add(head);
  head.add(s(0.14, fleshGrey(), 0, 0, 0, 1));
  const jaw = b(0.13, 0.18, 0.12, fleshRaw(), 0, -0.15, 0.06);   // locked open
  head.add(jaw);
  const icemask = s(0.165, iceMat(), 0, -0.02, 0.03, 1);
  icemask.scale.set(0.95, 1.15, 1.0);
  head.add(icemask);
  const eyes = [s(0.024, eyeCold(), -0.055, 0.04, 0.11, 0), s(0.024, eyeCold(), 0.055, 0.04, 0.11, 0)];
  head.add(...eyes);
  for (let i = 0; i < 4; i++) {
    const horn = spike(0.022, 0.20 + (i % 2) * 0.10, iceMat(), 4);
    horn.position.set(-0.07 + i * 0.047, 0.12, -0.04);
    horn.rotation.z = (i - 1.5) * 0.28;
    horn.rotation.x = -0.5;
    head.add(horn);
  }

  const arms = [];
  for (const sgn of [-1, 1]) {
    const arm = jointedLimb({ r: 0.065, upper: 0.44, lower: 0.46, mat: fleshGrey(), jointMat: iceMat(), bend: 0.4 });
    arm.position.set(sgn * 0.24, 0.20, 0);
    torso.add(arm);
    const hand = new THREE.Group();
    hand.add(claw(4, 0.20, fleshGrey(), 0.7));
    for (let i = 0; i < 3; i++) {
      const ic = spike(0.028, 0.24, iceMat(), 4);
      ic.position.set((i - 1) * 0.05, -0.12, 0.03);
      ic.rotation.x = Math.PI * 0.92;
      hand.add(ic);
    }
    arm.userData.end.add(hand);
    arms.push(arm);
  }
  const legs = [];
  for (const sgn of [-1, 1]) {
    const leg = jointedLimb({ r: 0.095, upper: 0.44, lower: 0.46, mat: fleshGrey(), jointMat: iceMat(), bend: 0.32 });
    leg.position.set(sgn * 0.14, -0.38, 0);
    torso.add(leg);
    leg.userData.end.add(b(0.17, 0.06, 0.28, fleshGrey(), 0, -0.03, 0.06));
    legs.push(leg);
  }

  g.userData.parts = { torso, head, jaw, arms, legs, eyes };
  g.userData.tick = (t) => {
    icemask.rotation.y = Math.sin(t * 0.4) * 0.05;
    head.rotation.x = -0.12 + Math.sin(t * 0.7) * 0.04;
  };
  return bakeStatics(g);
}

/**
 * SPOREBEARER (Bloom) — hunched under the weight of the cap that replaced its
 * head, trailing a slow fall of spores.
 */
export function buildSporebearer() {
  const g = new THREE.Group();
  const torso = new THREE.Group(); torso.position.y = 1.16; g.add(torso);
  torso.rotation.x = 0.42;                                   // permanently stooped under the weight of the cap

  const trunk = cap(0.21, 0.48, fungal(), 9);
  trunk.scale.set(1.05, 1, 0.8);
  torso.add(trunk);
  // fruiting bodies burst out along the ribs
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const bulb = s(0.05 + (i % 3) * 0.022, capMat(), Math.cos(a) * 0.22, 0.22 - (i % 4) * 0.13, Math.sin(a) * 0.18, 0);
    bulb.scale.set(1, 0.7, 1);
    torso.add(bulb);
    if (i % 3 === 0) torso.add(s(0.018, sporeGlow(), Math.cos(a) * 0.24, 0.24 - (i % 4) * 0.13, Math.sin(a) * 0.20, 0));
  }

  // the cap: a broad mushroom where the head was, hiding the face under it
  const head = new THREE.Group();
  head.position.set(0, 0.36, 0);
  torso.add(head);
  const stem = cap(0.055, 0.14, fungal(), 8);
  head.add(stem);
  const capMesh = new THREE.Mesh(new THREE.SphereGeometry(0.52, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), capMat());
  capMesh.position.y = 0.12;
  capMesh.scale.set(1, 0.52, 1);
  capMesh.castShadow = true;
  head.add(capMesh);
  const gills = new THREE.Mesh(new THREE.ConeGeometry(0.50, 0.12, 18, 1, true), sporeGlow());
  gills.position.y = 0.10;
  gills.rotation.x = Math.PI;
  head.add(gills);
  // there is still a face under there, and it is still looking
  const face = s(0.085, fleshGrey(), 0, 0.01, 0.045, 1);
  face.scale.set(0.9, 1.1, 0.8);
  head.add(face);
  const eyes = [s(0.017, sporeGlow(), -0.035, 0.03, 0.10, 0), s(0.017, sporeGlow(), 0.035, 0.03, 0.10, 0)];
  head.add(...eyes);

  const arms = [];
  for (const sgn of [-1, 1]) {
    const arm = jointedLimb({ r: 0.058, upper: 0.44, lower: 0.46, mat: fungal(), jointMat: capMat(), bend: 0.55 });
    arm.position.set(sgn * 0.23, 0.18, 0);
    torso.add(arm);
    const hand = new THREE.Group();
    hand.add(claw(3, 0.18, fungal(), 0.8));
    hand.add(s(0.075, capMat(), 0, -0.10, 0.02, 0));       // a sac ready to burst
    arm.userData.end.add(hand);
    arms.push(arm);
  }
  const legs = [];
  for (const sgn of [-1, 1]) {
    const leg = jointedLimb({ r: 0.09, upper: 0.42, lower: 0.44, mat: fungal(), jointMat: capMat(), bend: 0.3 });
    leg.position.set(sgn * 0.13, -0.36, 0);
    torso.add(leg);
    leg.userData.end.add(b(0.17, 0.06, 0.27, fungal(), 0, -0.03, 0.06));
    legs.push(leg);
  }

  g.userData.parts = { torso, head, arms, legs, eyes };
  g.userData.tick = (t, amp) => {
    capMesh.rotation.z = Math.sin(t * 0.6) * 0.06;
    head.rotation.x = 0.10 + Math.sin(t * 0.9) * 0.05;
    gills.material.emissiveIntensity = 1.6 + Math.sin(t * 1.7) * 0.8;
  };
  return bakeStatics(g);
}

/* ================================================================== */
/* wildlife                                                            */
/* ================================================================== */

function quadruped(opt) {
  const g = new THREE.Group();
  const torso = new THREE.Group(); torso.position.y = opt.bodyY; g.add(torso);
  torso.add(b(opt.bw, opt.bh, opt.bd, opt.mat, 0, 0, 0));
  if (opt.hump) torso.add(s(opt.hump, opt.mat, 0, opt.bh * 0.4, -opt.bd * 0.18, 0));
  const neck = new THREE.Group(); neck.position.set(0, opt.neckY, opt.bd * 0.42); torso.add(neck);
  if (opt.neckLen) neck.add(b(opt.bw * 0.45, opt.neckLen, opt.bw * 0.45, opt.mat, 0, opt.neckLen * 0.35, opt.neckLen * 0.25));
  const head = new THREE.Group();
  head.position.set(0, opt.neckLen ? opt.neckLen * 0.7 : 0, opt.neckLen ? opt.neckLen * 0.5 : opt.hd * 0.4);
  neck.add(head);
  head.add(b(opt.hw, opt.hh, opt.hd, opt.mat, 0, 0, 0));
  head.add(b(opt.hw * 0.6, opt.hh * 0.5, opt.hd * 0.6, opt.mat2 || opt.mat, 0, -opt.hh * 0.2, opt.hd * 0.6));
  const eyeL = s(opt.hw * 0.11, eyeMat(), -opt.hw * 0.4, opt.hh * 0.18, opt.hd * 0.35);
  const eyeR = s(opt.hw * 0.11, eyeMat(), opt.hw * 0.4, opt.hh * 0.18, opt.hd * 0.35);
  eyeL.material = eyeR.material = opt.eye || eyeMat();
  head.add(eyeL, eyeR);
  if (opt.antlers) {
    for (const sgn of [-1, 1]) {
      const a = new THREE.Group();
      a.position.set(sgn * opt.hw * 0.35, opt.hh * 0.5, -opt.hd * 0.1);
      a.add(b(0.045, 0.5, 0.045, furLight(), 0, 0.25, 0));
      a.add(b(0.04, 0.3, 0.04, furLight(), sgn * 0.12, 0.44, 0.05));
      a.add(b(0.04, 0.26, 0.04, furLight(), sgn * 0.18, 0.38, -0.12));
      a.rotation.z = sgn * 0.25;
      head.add(a);
    }
  }
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const lx = (i % 2 ? 1 : -1) * opt.bw * 0.36;
    const lz = (i < 2 ? 1 : -1) * opt.bd * 0.33;
    const l = limb(opt.legW, opt.legLen, opt.legW, opt.mat2 || opt.mat);
    l.position.set(lx, -opt.bh * 0.42, lz);
    torso.add(l); legs.push(l);
  }
  if (opt.tail) {
    const t = limb(opt.legW * 0.8, opt.tail, opt.legW * 0.8, opt.mat);
    t.position.set(0, opt.bh * 0.2, -opt.bd * 0.5);
    t.rotation.x = -0.9;
    torso.add(t);
    g.userData.tail = t;
  }
  g.userData.parts = { torso, head, neck, legs, arms: [], eyes: [eyeL, eyeR] };
  return g;
}

export function buildRabbit() {
  const g = quadruped({
    mat: furLight(), bodyY: 0.19, bw: 0.16, bh: 0.16, bd: 0.30,
    neckY: 0.05, neckLen: 0, hw: 0.12, hh: 0.11, hd: 0.14, legW: 0.045, legLen: 0.16, tail: 0.06,
  });
  const p = g.userData.parts;
  for (const sgn of [-1, 1]) {
    const ear = b(0.035, 0.20, 0.02, furLight(), sgn * 0.045, 0.14, -0.02);
    ear.rotation.z = sgn * 0.16;
    p.head.add(ear);
  }
  return g;
}

export function buildDeer() {
  return quadruped({
    mat: furBrown(), mat2: furDark(), bodyY: 0.95, bw: 0.42, bh: 0.52, bd: 1.15,
    neckY: 0.20, neckLen: 0.52, hw: 0.20, hh: 0.20, hd: 0.34, legW: 0.09, legLen: 0.80,
    tail: 0.16, antlers: true,
  });
}

export function buildBoar() {
  return quadruped({
    mat: furDark(), mat2: furGrey(), bodyY: 0.60, bw: 0.44, bh: 0.48, bd: 0.98,
    neckY: 0.05, neckLen: 0.10, hw: 0.24, hh: 0.24, hd: 0.36, legW: 0.10, legLen: 0.42,
    tail: 0.14, hump: 0.24, eye: eyeRed(),
  });
}

export function buildWolf() {
  const g = quadruped({
    mat: furGrey(), mat2: furDark(), bodyY: 0.72, bw: 0.32, bh: 0.36, bd: 0.98,
    neckY: 0.10, neckLen: 0.22, hw: 0.19, hh: 0.18, hd: 0.32, legW: 0.075, legLen: 0.58,
    tail: 0.36, eye: eyeMat(),
  });
  const p = g.userData.parts;
  for (const sgn of [-1, 1]) {
    const ear = b(0.05, 0.09, 0.03, furDark(), sgn * 0.07, 0.13, -0.04);
    p.head.add(ear);
  }
  return g;
}

export function buildBear() {
  return quadruped({
    mat: furDark(), mat2: furBrown(), bodyY: 1.02, bw: 0.72, bh: 0.72, bd: 1.45,
    neckY: 0.10, neckLen: 0.20, hw: 0.34, hh: 0.32, hd: 0.44, legW: 0.19, legLen: 0.72,
    tail: 0.12, hump: 0.40, eye: eyeRed(),
  });
}

export const CREATURE_FACTORIES = {
  stalker: buildStalker,
  brute: buildBrute,
  crawler: buildCrawler,
  screamer: buildScreamer,
  choir: buildChoir,
  drowned: buildDrowned,
  ashwalker: buildAshwalker,
  rimewretch: buildRimewretch,
  sporebearer: buildSporebearer,
  rabbit: buildRabbit,
  deer: buildDeer,
  boar: buildBoar,
  wolf: buildWolf,
  bear: buildBear,
};

/** Shared building blocks, reused by the biome bosses. */
export const PARTS = {
  b, s, seg, cap, spike, limb, jointedLimb, claw, ribcage, verticalMaw, eyeCluster,
  mats: {
    fleshPale, fleshGrey, fleshDark, fleshRaw, fleshWet, bone, boneOld, sinew,
    charred, ember, iceMat, drowned, lure, voidSkin, voidGlow, fungal, capMat,
    sporeGlow, eyeMat, eyeRed, eyeCold, toothMat,
  },
};

export function disposeCreatureMaterials() {
  for (const k of Object.keys(mats)) { mats[k].dispose(); delete mats[k]; }
}
