/**
 * OperatorModel — the player character, built for the armoury preview.
 *
 * Proportioned off a real 1.80 m figure at roughly 7.5 heads, with capsule
 * limbs and spherical joints rather than stacked boxes, so shoulders, elbows
 * and knees actually bend into a silhouette instead of a stack of crates.
 *
 * Everything is parameterised, so the operator hub can rebuild the figure
 * from a small config object.
 */
import * as THREE from 'three';

export const OPERATOR_OPTIONS = {
  headgear: [
    { id: 'none', label: 'Bare Head' },
    { id: 'beanie', label: 'Wool Cap' },
    { id: 'cap', label: 'Field Cap' },
    { id: 'helmet', label: 'Ballistic Helmet' },
    { id: 'helmetNVG', label: 'Helmet + NVG Mount' },
    { id: 'hood', label: 'Storm Hood' },
  ],
  face: [
    { id: 'none', label: 'Uncovered' },
    { id: 'shemagh', label: 'Shemagh' },
    { id: 'balaclava', label: 'Balaclava' },
    { id: 'respirator', label: 'Respirator' },
    { id: 'halfmask', label: 'Half Mask' },
  ],
  torso: [
    { id: 'jacket', label: 'Field Jacket' },
    { id: 'carrier', label: 'Plate Carrier' },
    { id: 'chestrig', label: 'Chest Rig' },
    { id: 'heavy', label: 'Heavy Armour' },
  ],
  legs: [
    { id: 'trousers', label: 'Combat Trousers' },
    { id: 'padded', label: 'Padded Trousers' },
    { id: 'waders', label: 'Waders' },
  ],
  skin: [
    { id: 'pale', label: 'Pale', color: 0xc4a189 },
    { id: 'tan', label: 'Tan', color: 0xa87c58 },
    { id: 'brown', label: 'Brown', color: 0x7a5237 },
    { id: 'deep', label: 'Deep', color: 0x4e3323 },
  ],
  palette: [
    { id: 'olive', label: 'Olive Drab', cloth: 0x4a5140, gear: 0x33372c, accent: 0x6b6a52 },
    { id: 'coyote', label: 'Coyote', cloth: 0x7a6647, gear: 0x4a3f2c, accent: 0x9b855f },
    { id: 'black', label: 'Night Black', cloth: 0x24262a, gear: 0x141518, accent: 0x3a3d44 },
    { id: 'ranger', label: 'Ranger Green', cloth: 0x3f4a3a, gear: 0x2a3126, accent: 0x5d6b52 },
    { id: 'ash', label: 'Ashfall Grey', cloth: 0x4c4e52, gear: 0x303236, accent: 0x6c6f75 },
    { id: 'rust', label: 'Rust', cloth: 0x6a4530, gear: 0x3d2a1e, accent: 0x8f6141 },
  ],
};

export function defaultOperator() {
  return { headgear: 'helmet', face: 'shemagh', torso: 'carrier', legs: 'trousers', skin: 'tan', palette: 'olive' };
}

const opt = (kind, id) => OPERATOR_OPTIONS[kind].find((o) => o.id === id) || OPERATOR_OPTIONS[kind][0];

/* ------------------------------------------------------------------ */

function capsule(r, len, mat, seg = 10) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, seg), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function ball(r, mat, seg = 12) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg * 0.7), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function slab(w, h, d, mat, r = 0.02) {
  // a box with its corners taken off reads far softer than a hard cube
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Blend two packed hex colours. */
function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/**
 * A gloved hand with four fingers and an opposed thumb, each with two
 * segments and a knuckle. A mitten reads as a mitten from two metres away,
 * and the hands are the second thing anybody looks at after the face.
 */
function buildHand(parent, side, M) {
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.088, 0.032), M.gear);
  palm.position.y = -0.040;
  palm.castShadow = true;
  parent.add(palm);
  // the heel of the hand
  const heel = capsule(0.028, 0.030, M.gear, 10);
  heel.rotation.z = Math.PI / 2;
  heel.position.y = -0.008;
  parent.add(heel);

  const FINGERS = [
    { x: -0.028, len: 0.036, len2: 0.028, r: 0.0105 },
    { x: -0.009, len: 0.040, len2: 0.031, r: 0.0110 },
    { x: 0.010, len: 0.038, len2: 0.029, r: 0.0105 },
    { x: 0.028, len: 0.031, len2: 0.024, r: 0.0095 },
  ];
  for (const f of FINGERS) {
    const root = new THREE.Group();
    root.position.set(side * f.x, -0.086, 0.002);
    root.rotation.x = 0.20 + Math.abs(f.x) * 1.2;
    parent.add(root);
    const seg1 = capsule(f.r, f.len, M.gear, 7);
    seg1.position.y = -f.len / 2;
    root.add(seg1);
    const knuckle = new THREE.Group();
    knuckle.position.y = -f.len - f.r * 0.4;
    knuckle.rotation.x = 0.45;
    root.add(knuckle);
    const seg2 = capsule(f.r * 0.85, f.len2, M.gear, 7);
    seg2.position.y = -f.len2 / 2;
    knuckle.add(seg2);
  }

  // thumb, off the side of the palm and rotated to oppose the fingers
  const thumb = new THREE.Group();
  thumb.position.set(side * 0.040, -0.044, 0.012);
  thumb.rotation.z = side * 0.95;
  thumb.rotation.x = 0.35;
  parent.add(thumb);
  const t1 = capsule(0.0125, 0.030, M.gear, 7);
  t1.position.y = -0.015;
  thumb.add(t1);
  const tJoint = new THREE.Group();
  tJoint.position.y = -0.034;
  tJoint.rotation.x = 0.5;
  thumb.add(tJoint);
  const t2 = capsule(0.011, 0.024, M.gear, 7);
  t2.position.y = -0.012;
  tJoint.add(t2);

  // a knuckle plate, because these are gloves
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.070, 0.030, 0.014), M.strap);
  plate.position.set(0, -0.076, 0.020);
  parent.add(plate);
  return parent;
}

/**
 * Build the operator. Returns a Group standing on y = 0, about 1.80 m tall,
 * with userData.parts naming the joints for posing.
 */
export function buildOperator(cfg = defaultOperator()) {
  const c = { ...defaultOperator(), ...cfg };
  const pal = opt('palette', c.palette);
  const skinCol = opt('skin', c.skin).color;

  const M = {
    skin: new THREE.MeshStandardMaterial({ color: skinCol, roughness: 0.72, metalness: 0.02 }),
    cloth: new THREE.MeshStandardMaterial({ color: pal.cloth, roughness: 0.92, metalness: 0.02 }),
    gear: new THREE.MeshStandardMaterial({ color: pal.gear, roughness: 0.78, metalness: 0.08 }),
    accent: new THREE.MeshStandardMaterial({ color: pal.accent, roughness: 0.85, metalness: 0.04 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.95, metalness: 0.0 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x2a3a30, roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.55 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x7c828a, roughness: 0.35, metalness: 0.9 }),
    // A slightly darker, redder skin for the recessed parts. Real skin is
    // never one flat colour, and the eye reads the shading before the shape.
    skinDark: new THREE.MeshStandardMaterial({
      color: mixHex(skinCol, 0x000000, 0.35), roughness: 0.78, metalness: 0.02,
    }),
    socket: new THREE.MeshStandardMaterial({
      color: mixHex(skinCol, 0x2a1410, 0.55), roughness: 0.85, metalness: 0,
    }),
    eyeWhite: new THREE.MeshStandardMaterial({ color: 0xe6e3d8, roughness: 0.28, metalness: 0 }),
    iris: new THREE.MeshStandardMaterial({ color: 0x4a5a48, roughness: 0.22, metalness: 0.05 }),
    hair: new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 0.92, metalness: 0.02 }),
    strap: new THREE.MeshStandardMaterial({ color: mixHex(pal.gear, 0x000000, 0.25), roughness: 0.9 }),
  };

  const g = new THREE.Group();
  const parts = {};

  /* ---- pelvis and spine ---- */
  const root = new THREE.Group();
  root.position.y = 0.94;                       // hip joint height on a 1.80 m figure
  g.add(root);
  parts.root = root;

  const pelvis = capsule(0.135, 0.10, M.cloth, 18);
  pelvis.rotation.z = Math.PI / 2;
  pelvis.scale.set(1, 1.25, 0.78);
  root.add(pelvis);

  const spine = new THREE.Group();
  spine.position.y = 0.10;
  root.add(spine);
  parts.spine = spine;

  // ribcage: wider at the chest, narrower at the waist
  const chest = capsule(0.155, 0.20, M.cloth, 20);
  chest.position.y = 0.20;
  chest.scale.set(1.12, 1, 0.72);
  spine.add(chest);
  const waist = capsule(0.125, 0.08, M.cloth, 18);
  waist.position.y = 0.05;
  waist.scale.set(1, 1, 0.74);
  spine.add(waist);

  /* ---- head ---- */
  const neck = new THREE.Group();
  neck.position.y = 0.47;          // C7, ~1.51 m
  spine.add(neck);
  parts.neck = neck;
  const neckCol = capsule(0.058, 0.07, M.skin, 14);
  neckCol.position.y = 0.03;
  neck.add(neckCol);

  const head = new THREE.Group();
  head.position.y = 0.17;          // head centre, ~1.68 m; crown lands at 1.79
  neck.add(head);
  parts.head = head;

  // The skull is built the way a head actually reads: a cranium, a brow ridge
  // over the eyes, cheekbones, a jaw that tapers to a chin, and a nose with a
  // bridge. The old version was a sphere with a box for a jaw, which is why it
  // looked like a mannequin.
  const skull = ball(0.098, M.skin, 22);
  skull.scale.set(0.92, 1.06, 1.02);
  head.add(skull);

  // cranium: slightly flattened at the back, fuller at the crown
  const crown = ball(0.092, M.skin, 20);
  crown.scale.set(0.96, 0.9, 0.94);
  crown.position.set(0, 0.030, -0.014);
  head.add(crown);

  // brow ridge
  const brow = capsule(0.017, 0.088, M.skin, 12);
  brow.rotation.z = Math.PI / 2;
  brow.position.set(0, 0.034, 0.070);
  brow.scale.set(1, 1, 0.85);
  head.add(brow);

  // cheekbones
  for (const sgn of [-1, 1]) {
    const cheek = ball(0.030, M.skin, 12);
    cheek.scale.set(0.85, 0.62, 0.78);
    cheek.position.set(sgn * 0.050, -0.014, 0.055);
    head.add(cheek);
  }

  // jaw and chin: a tapered wedge rather than a block
  const jaw = capsule(0.052, 0.055, M.skin, 14);
  jaw.rotation.z = Math.PI / 2;
  jaw.position.set(0, -0.050, 0.020);
  jaw.scale.set(1, 1.02, 0.86);
  head.add(jaw);
  const chin = ball(0.028, M.skin, 12);
  chin.scale.set(0.9, 0.75, 0.85);
  chin.position.set(0, -0.070, 0.055);
  head.add(chin);

  // nose: a bridge and a tip, not one blob
  const bridge = capsule(0.010, 0.036, M.skin, 8);
  bridge.position.set(0, 0.008, 0.084);
  bridge.rotation.x = 0.32;
  head.add(bridge);
  const nose = ball(0.017, M.skin, 10);
  nose.position.set(0, -0.020, 0.092);
  nose.scale.set(1.0, 0.85, 1.15);
  head.add(nose);

  // mouth line
  const mouth = slab(0.036, 0.006, 0.012, M.rubber);
  mouth.position.set(0, -0.048, 0.076);
  head.add(mouth);

  for (const s of [-1, 1]) {
    const ear = ball(0.021, M.skin, 10);
    ear.position.set(s * 0.092, -0.004, -0.002);
    ear.scale.set(0.38, 1.05, 0.72);
    head.add(ear);
    const lobe = ball(0.011, M.skin, 8);
    lobe.position.set(s * 0.090, -0.024, 0.000);
    head.add(lobe);

    // a sunken eye socket, so the eye sits in the head instead of on it
    const socket = ball(0.024, M.socket, 10);
    socket.scale.set(1.15, 0.8, 0.5);
    socket.position.set(s * 0.036, 0.010, 0.072);
    head.add(socket);
    const eye = ball(0.0125, M.eyeWhite, 10);
    eye.position.set(s * 0.036, 0.010, 0.078);
    head.add(eye);
    const iris = ball(0.0062, M.iris, 8);
    iris.position.set(s * 0.036, 0.010, 0.0875);
    head.add(iris);
    const pupil = ball(0.0028, M.rubber, 6);
    pupil.position.set(s * 0.036, 0.010, 0.0905);
    head.add(pupil);

    const browHair = slab(0.040, 0.008, 0.016, M.hair);
    browHair.position.set(s * 0.036, 0.040, 0.080);
    browHair.rotation.z = -s * 0.12;
    head.add(browHair);
  }
  parts.skull = skull;

  // Hair, when nothing is covering it. A skullcap plus a hairline, which is
  // enough to stop a bare head reading as a shop dummy.
  if (c.headgear === 'none' || c.headgear === 'cap') {
    const hair = ball(0.101, M.hair, 18);
    hair.scale.set(0.97, 0.86, 0.98);
    hair.position.set(0, 0.028, -0.008);
    head.add(hair);
    const back = ball(0.086, M.hair, 14);
    back.scale.set(0.92, 0.78, 0.7);
    back.position.set(0, -0.010, -0.055);
    head.add(back);
    for (const sgn of [-1, 1]) {
      const sideburn = slab(0.014, 0.038, 0.026, M.hair);
      sideburn.position.set(sgn * 0.082, -0.010, 0.006);
      head.add(sideburn);
    }
  }

  /* ---- face covering ---- */
  if (c.face === 'shemagh') {
    const wrap = capsule(0.088, 0.06, M.accent, 14);
    wrap.position.set(0, -0.048, 0.012);
    wrap.rotation.z = Math.PI / 2;
    wrap.scale.set(1, 1.25, 1.05);
    head.add(wrap);
    const tail = slab(0.16, 0.14, 0.03, M.accent);
    tail.position.set(0.05, -0.10, -0.06);
    tail.rotation.set(0.3, 0.3, 0.2);
    head.add(tail);
  } else if (c.face === 'balaclava') {
    const cover = ball(0.101, M.gear, 16);
    cover.scale.set(0.94, 1.09, 1.02);
    head.add(cover);
    const opening = slab(0.10, 0.036, 0.02, new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 1 }));
    opening.position.set(0, 0.018, 0.094);
    head.add(opening);
  } else if (c.face === 'respirator') {
    const mask = capsule(0.070, 0.05, M.rubber, 12);
    mask.position.set(0, -0.040, 0.040);
    mask.rotation.z = Math.PI / 2;
    mask.scale.set(1, 1.1, 1.15);
    head.add(mask);
    for (const s of [-1, 1]) {
      const filter = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.030, 0.048, 12), M.gear);
      filter.rotation.z = Math.PI / 2;
      filter.position.set(s * 0.082, -0.048, 0.048);
      head.add(filter);
    }
    const lens = slab(0.13, 0.05, 0.01, M.glass);
    lens.position.set(0, 0.020, 0.086);
    head.add(lens);
  } else if (c.face === 'halfmask') {
    const mask = capsule(0.072, 0.04, M.gear, 12);
    mask.position.set(0, -0.048, 0.036);
    mask.rotation.z = Math.PI / 2;
    mask.scale.set(1, 1.05, 1.1);
    head.add(mask);
  }

  /* ---- headgear ---- */
  if (c.headgear === 'beanie') {
    const cap = ball(0.104, M.gear, 14);
    cap.scale.set(0.96, 0.86, 1.0);
    cap.position.y = 0.030;
    head.add(cap);
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.016, 8, 20), M.gear);
    brim.rotation.x = Math.PI / 2;
    brim.position.y = -0.012;
    head.add(brim);
  } else if (c.headgear === 'cap') {
    const crown = ball(0.102, M.cloth, 14);
    crown.scale.set(0.96, 0.72, 1.0);
    crown.position.y = 0.036;
    head.add(crown);
    const peak = slab(0.15, 0.014, 0.10, M.cloth);
    peak.position.set(0, 0.020, 0.098);
    peak.rotation.x = 0.18;
    head.add(peak);
  } else if (c.headgear === 'helmet' || c.headgear === 'helmetNVG') {
    const shell = ball(0.113, M.gear, 16);
    shell.scale.set(1.0, 0.90, 1.02);
    shell.position.y = 0.026;
    head.add(shell);
    // cut-away at the ears, suggested with side rails
    for (const s of [-1, 1]) {
      const railM = slab(0.012, 0.030, 0.13, M.rubber);
      railM.position.set(s * 0.108, 0.006, 0.004);
      head.add(railM);
    }
    const brimH = new THREE.Mesh(new THREE.TorusGeometry(0.110, 0.012, 8, 22, Math.PI * 1.3), M.gear);
    brimH.rotation.set(Math.PI / 2, 0, Math.PI * 0.15);
    brimH.position.y = -0.012;
    head.add(brimH);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.086, 0.008, 6, 16), M.accent);
    strap.rotation.set(Math.PI / 2, 0.2, 0);
    strap.position.set(0, -0.062, 0.010);
    head.add(strap);
    if (c.headgear === 'helmetNVG') {
      const mountP = slab(0.052, 0.036, 0.030, M.metal);
      mountP.position.set(0, 0.062, 0.098);
      head.add(mountP);
      const arm = slab(0.024, 0.070, 0.022, M.metal);
      arm.position.set(0, 0.098, 0.118);
      arm.rotation.x = -0.5;
      head.add(arm);
      for (const s of [-1, 1]) {
        const tubeN = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.024, 0.075, 12), M.gear);
        tubeN.rotation.x = Math.PI / 2 - 0.35;
        tubeN.position.set(s * 0.028, 0.128, 0.146);
        head.add(tubeN);
        const lensN = new THREE.Mesh(new THREE.CircleGeometry(0.020, 14),
          new THREE.MeshStandardMaterial({ color: 0x2f6b4a, emissive: 0x1a4a30, emissiveIntensity: 0.8, roughness: 0.2, metalness: 0.5 }));
        lensN.position.set(s * 0.028, 0.140, 0.180);
        lensN.rotation.x = 0.35;
        head.add(lensN);
      }
    }
  } else if (c.headgear === 'hood') {
    const hood = ball(0.128, M.cloth, 14);
    hood.scale.set(1.0, 1.02, 1.06);
    hood.position.set(0, 0.020, -0.018);
    head.add(hood);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.020, 8, 20), M.cloth);
    rim.rotation.set(Math.PI / 2 - 0.35, 0, 0);
    rim.position.set(0, 0.010, 0.052);
    head.add(rim);
  }

  /* ---- torso gear ---- */
  if (c.torso === 'carrier' || c.torso === 'heavy') {
    const heavy = c.torso === 'heavy';
    const front = slab(0.30, heavy ? 0.36 : 0.31, 0.075, M.gear);
    front.position.set(0, 0.20, heavy ? 0.115 : 0.105);
    spine.add(front);
    const back = slab(0.30, heavy ? 0.36 : 0.31, 0.06, M.gear);
    back.position.set(0, 0.20, -0.10);
    spine.add(back);
    for (const s of [-1, 1]) {
      const shoulderStrap = slab(0.075, 0.10, 0.24, M.gear);
      shoulderStrap.position.set(s * 0.115, 0.325, 0.010);
      spine.add(shoulderStrap);
    }
    // magazine pouches
    for (let i = 0; i < 3; i++) {
      const pouch = slab(0.072, 0.105, 0.055, M.accent);
      pouch.position.set(-0.088 + i * 0.088, 0.145, 0.155);
      spine.add(pouch);
    }
    const admin = slab(0.13, 0.075, 0.045, M.accent);
    admin.position.set(0.045, 0.265, 0.150);
    spine.add(admin);
    if (heavy) {
      for (const s of [-1, 1]) {
        const side = slab(0.055, 0.20, 0.16, M.gear);
        side.position.set(s * 0.175, 0.19, 0.010);
        spine.add(side);
      }
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.036, 8, 18), M.gear);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.360;
      spine.add(collar);
    }
  } else if (c.torso === 'chestrig') {
    const rig = slab(0.26, 0.20, 0.06, M.gear);
    rig.position.set(0, 0.20, 0.105);
    spine.add(rig);
    for (let i = 0; i < 4; i++) {
      const pouch = slab(0.055, 0.10, 0.05, M.accent);
      pouch.position.set(-0.093 + i * 0.062, 0.185, 0.140);
      spine.add(pouch);
    }
    for (const s of [-1, 1]) {
      const strap = slab(0.045, 0.09, 0.20, M.gear);
      strap.position.set(s * 0.10, 0.325, 0.010);
      spine.add(strap);
    }
  } else {
    // plain jacket: collar and a couple of chest pockets
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.026, 8, 16), M.cloth);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.345;
    spine.add(collar);
    for (const s of [-1, 1]) {
      const pocket = slab(0.085, 0.095, 0.02, M.accent);
      pocket.position.set(s * 0.075, 0.22, 0.112);
      spine.add(pocket);
    }
  }

  // belt
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.138, 0.026, 8, 20), M.gear);
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(1, 0.78, 1);
  belt.position.y = 0.02;
  spine.add(belt);
  const buckle = slab(0.05, 0.045, 0.03, M.metal);
  buckle.position.set(0, 0.02, 0.115);
  spine.add(buckle);
  const dumpPouch = slab(0.10, 0.12, 0.07, M.accent);
  dumpPouch.position.set(-0.16, -0.02, -0.02);
  spine.add(dumpPouch);

  // A collar, so the head does not appear to be screwed onto the chest.
  const collar = capsule(0.088, 0.05, M.cloth, 14);
  collar.rotation.z = Math.PI / 2;
  collar.scale.set(1, 1.15, 0.86);
  collar.position.set(0, 0.42, 0.004);
  spine.add(collar);
  const collarLip = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.014, 6, 18), M.accent);
  collarLip.rotation.x = Math.PI / 2;
  collarLip.position.set(0, 0.452, 0);
  spine.add(collarLip);

  /* ---- arms ---- */
  parts.arms = [];
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.185, 0.41, 0);   // shoulder joint ~1.45 m
    spine.add(shoulder);

    const deltoid = ball(0.072, M.cloth, 12);
    shoulder.add(deltoid);

    const upper = capsule(0.050, 0.23, M.cloth, 14);
    upper.position.y = -0.165;
    shoulder.add(upper);
    // a shoulder seam where the sleeve is set into the jacket
    const seam = new THREE.Mesh(new THREE.TorusGeometry(0.054, 0.008, 5, 14), M.accent);
    seam.rotation.x = Math.PI / 2;
    seam.position.y = -0.048;
    shoulder.add(seam);

    const elbow = new THREE.Group();
    elbow.position.y = -0.33;        // elbow ~1.12 m
    shoulder.add(elbow);
    elbow.add(ball(0.048, M.cloth, 10));

    const fore = capsule(0.044, 0.17, M.cloth, 14);
    fore.position.y = -0.13;
    elbow.add(fore);
    // cuff at the wrist
    const cuff = capsule(0.047, 0.030, M.gear, 12);
    cuff.position.y = -0.244;
    elbow.add(cuff);

    const glove = new THREE.Group();
    glove.position.y = -0.265;       // wrist ~0.86 m
    elbow.add(glove);
    buildHand(glove, s, M);

    // elbow pad
    const pad = ball(0.056, M.rubber, 10);
    pad.scale.set(0.9, 0.9, 0.7);
    pad.position.set(0, 0.005, 0.028);
    elbow.add(pad);

    shoulder.rotation.z = s * 0.10;
    parts.arms.push({ shoulder, elbow, glove });
  }

  /* ---- legs ---- */
  parts.legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.088, -0.02, 0);
    root.add(hip);

    const thigh = capsule(0.072, 0.32, M.cloth, 12);
    thigh.position.y = -0.23;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.46;         // knee ~0.46 m
    hip.add(knee);
    knee.add(ball(0.066, M.cloth, 10));
    if (c.legs === 'padded') {
      const kneePad = ball(0.072, M.rubber, 10);
      kneePad.scale.set(0.95, 1.0, 0.75);
      kneePad.position.z = 0.030;
      knee.add(kneePad);
    }

    const shin = capsule(0.058, 0.28, M.cloth, 12);
    shin.position.y = -0.195;
    knee.add(shin);

    const boot = new THREE.Group();
    boot.position.y = -0.39;         // ankle ~0.07 m, sole on the ground
    knee.add(boot);
    const ankle = capsule(0.056, 0.06, c.legs === 'waders' ? M.rubber : M.gear, 10);
    ankle.position.y = 0.020;
    boot.add(ankle);
    const foot = slab(0.098, 0.070, 0.255, c.legs === 'waders' ? M.rubber : M.gear);
    foot.position.set(0, -0.030, 0.045);
    boot.add(foot);
    const toe = capsule(0.048, 0.06, c.legs === 'waders' ? M.rubber : M.gear, 8);
    toe.rotation.x = Math.PI / 2;
    toe.position.set(0, -0.032, 0.155);
    toe.scale.set(1, 1, 0.7);
    boot.add(toe);
    const sole = slab(0.100, 0.024, 0.262, M.rubber);
    sole.position.set(0, -0.060, 0.045);
    boot.add(sole);

    if (c.legs === 'waders') {
      const upperWader = capsule(0.078, 0.30, M.rubber, 12);
      upperWader.position.y = -0.20;
      hip.add(upperWader);
    }

    // thigh dump / holster on the right leg
    if (s === 1) {
      const holster = slab(0.085, 0.16, 0.06, M.accent);
      holster.position.set(0.045, -0.20, 0.030);
      hip.add(holster);
    }

    parts.legs.push({ hip, knee, boot });
  }

  g.userData.parts = parts;
  g.userData.materials = M;
  g.userData.config = c;
  return g;
}

/** A relaxed standing pose with the weight on one leg. */
export function poseIdle(model, t = 0) {
  const p = model.userData.parts;
  if (!p) return;
  const breathe = Math.sin(t * 1.1) * 0.012;
  p.spine.rotation.x = -0.04 + breathe * 0.4;
  p.spine.rotation.y = Math.sin(t * 0.31) * 0.05;
  p.root.position.y = 0.96 + breathe * 0.5;
  p.neck.rotation.x = 0.05 - breathe * 0.3;
  p.head.rotation.y = Math.sin(t * 0.23) * 0.12;
  p.head.rotation.x = Math.sin(t * 0.41) * 0.04;

  const [la, ra] = p.arms;
  la.shoulder.rotation.set(-0.12 + Math.sin(t * 0.9) * 0.02, 0, -0.16);
  la.elbow.rotation.set(-0.55, 0, 0);
  ra.shoulder.rotation.set(-0.10 + Math.sin(t * 0.9 + 1) * 0.02, 0, 0.14);
  ra.elbow.rotation.set(-0.42, 0, 0);

  const [ll, rl] = p.legs;
  ll.hip.rotation.set(0.02, 0, 0.03);
  ll.knee.rotation.set(-0.06, 0, 0);
  rl.hip.rotation.set(-0.10, 0, -0.04);
  rl.knee.rotation.set(-0.22, 0, 0);
}

/** Weapon-ready pose: both hands forward, weapon shouldered. */
export function poseReady(model, t = 0) {
  const p = model.userData.parts;
  if (!p) return;
  const breathe = Math.sin(t * 1.3) * 0.008;
  p.spine.rotation.set(-0.10 + breathe * 0.3, -0.30, 0);
  p.root.position.y = 0.955 + breathe * 0.4;
  p.neck.rotation.x = 0.10;
  p.head.rotation.set(0.02, 0.26, 0);

  const [la, ra] = p.arms;
  // right hand on the grip, left hand forward on the handguard
  ra.shoulder.rotation.set(-1.05, 0.30, 0.26);
  ra.elbow.rotation.set(-1.35, 0, 0);
  la.shoulder.rotation.set(-1.35, -0.10, -0.42);
  la.elbow.rotation.set(-1.05, 0, 0);

  const [ll, rl] = p.legs;
  ll.hip.rotation.set(0.16, 0, 0.05);
  ll.knee.rotation.set(-0.30, 0, 0);
  rl.hip.rotation.set(-0.22, 0, -0.05);
  rl.knee.rotation.set(-0.34, 0, 0);
}

/**
 * Locomotion, for operators seen from the outside — which, so far, means the
 * other people in a co-op run.
 *
 * `speed` is metres per second, not a 0..1 blend, so the same call covers a
 * creep and a sprint: the stride lengthens and quickens with it. `weapon`
 * folds the arms into a carry rather than letting them swing, because a
 * player holding a rifle who swings their arms like a jogger looks wrong from
 * twenty metres away, which is where you will normally see them.
 */
export function poseLocomotion(model, t, speed = 0, crouch = false, weapon = true) {
  const p = model.userData.parts;
  if (!p) return;
  const run = Math.min(1, speed / 5.4);
  if (run < 0.04) { (weapon ? poseReady : poseIdle)(model, t); return; }

  // Stride frequency rises with speed but not linearly: a walk is ~1.8 Hz and
  // a sprint ~2.9 Hz, and anything faster reads as a cartoon.
  const freq = 1.75 + run * 1.15;
  const ph = t * freq * Math.PI * 2;
  const swing = (0.30 + run * 0.52) * (crouch ? 0.6 : 1);
  const s = Math.sin(ph), c = Math.cos(ph);

  const crouchDrop = crouch ? 0.16 : 0;
  p.root.position.y = 0.94 - crouchDrop + Math.abs(c) * 0.026 * (0.4 + run);
  p.spine.rotation.set(-0.06 - run * 0.20 - (crouch ? 0.18 : 0), -s * 0.10, s * 0.04);
  p.neck.rotation.x = 0.06 + run * 0.10;
  p.head.rotation.set(-run * 0.06, s * 0.05, 0);

  const [ll, rl] = p.legs;
  // The knee only bends on the recovery half of the cycle; a leg that bends
  // while it is carrying weight is the classic broken walk.
  ll.hip.rotation.set(s * swing, 0, 0.03);
  ll.knee.rotation.set(-Math.max(0.05, -s + 0.25) * (0.5 + run * 0.7), 0, 0);
  rl.hip.rotation.set(-s * swing, 0, -0.03);
  rl.knee.rotation.set(-Math.max(0.05, s + 0.25) * (0.5 + run * 0.7), 0, 0);

  const [la, ra] = p.arms;
  if (weapon) {
    // Weapon carried across the body; it only bounces with the stride.
    ra.shoulder.rotation.set(-0.95 - run * 0.18 + c * 0.05, 0.28, 0.24);
    ra.elbow.rotation.set(-1.30, 0, 0);
    la.shoulder.rotation.set(-1.22 - run * 0.14 + c * 0.05, -0.12, -0.40);
    la.elbow.rotation.set(-1.02, 0, 0);
  } else {
    la.shoulder.rotation.set(-s * swing * 0.8, 0, -0.16);
    la.elbow.rotation.set(-0.45 - Math.max(0, -s) * 0.7, 0, 0);
    ra.shoulder.rotation.set(s * swing * 0.8, 0, 0.16);
    ra.elbow.rotation.set(-0.45 - Math.max(0, s) * 0.7, 0, 0);
  }
}

export function disposeOperator(model) {
  model.traverse((o) => {
    if (o.isMesh) { o.geometry.dispose(); }
  });
  const M = model.userData.materials || {};
  for (const k of Object.keys(M)) M[k].dispose();
}
