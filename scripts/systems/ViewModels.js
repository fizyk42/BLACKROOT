/**
 * ViewModels — first-person weapon geometry.
 *
 * These are built from a small kit of gun-shaped parts (rails with real teeth,
 * curved magazines, fluted barrels, handguards with M-LOK slots, trigger
 * groups, charging handles) rather than a stack of plain boxes, so the
 * silhouettes read as specific weapons instead of grey slabs.
 *
 * Every model exposes:
 *   userData.mounts     named empties an attachment can be parented to
 *   userData.camoParts  meshes whose material takes the weapon finish
 *   userData.ironSight  the iron sights, hidden when an optic is fitted
 *   userData.muzzle     where the flash and tracer originate
 *   userData.sight      the point ADS aligns to the camera
 */
import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* materials                                                           */
/* ------------------------------------------------------------------ */

const CACHE = {};
const mk = (k, o) => (CACHE[k] = CACHE[k] || new THREE.MeshStandardMaterial(o));

const MAT = {
  // `body` is the surface a camo gets painted onto
  body: () => mk('vm_body', { color: 0x4a4e55, roughness: 0.55, metalness: 0.55, envMapIntensity: 1.5 }),
  poly: () => mk('vm_poly', { color: 0x2b2d31, roughness: 0.78, metalness: 0.08, envMapIntensity: 1.2 }),
  steel: () => mk('vm_steel', { color: 0xb2b8c0, roughness: 0.28, metalness: 0.92, envMapIntensity: 1.9 }),
  blued: () => mk('vm_blued', { color: 0x30343a, roughness: 0.34, metalness: 0.88, envMapIntensity: 1.7 }),
  wood: () => mk('vm_wood', { color: 0x6d4a2c, roughness: 0.62, metalness: 0.03, envMapIntensity: 1.2 }),
  rubber: () => mk('vm_rub', { color: 0x1f2023, roughness: 0.95, metalness: 0.0 }),
  brass: () => mk('vm_brass', { color: 0xb08a3c, roughness: 0.32, metalness: 0.95, envMapIntensity: 1.8 }),
};

/* ------------------------------------------------------------------ */
/* part kit                                                            */
/* ------------------------------------------------------------------ */

function box(w, h, d, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z); o.rotation.set(rx, ry, rz);
  return o;
}
function cyl(rt, rb, h, seg, m, x = 0, y = 0, z = 0, rx = Math.PI / 2, open = false) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), m);
  o.position.set(x, y, z); o.rotation.x = rx;
  return o;
}

/** Picatinny rail: a flat base with real cross-slots, so optics sit on teeth. */
function rail(length, m, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.add(box(0.021, 0.006, length, m, 0, 0, 0));
  const teeth = Math.max(3, Math.round(length / 0.0115));
  for (let i = 0; i < teeth; i++) {
    const tz = -length / 2 + 0.006 + i * (length - 0.012) / Math.max(1, teeth - 1);
    g.add(box(0.021, 0.005, 0.0052, m, 0, 0.0055, tz));
  }
  g.position.set(x, y, z);
  return g;
}

/** Handguard with M-LOK cut-outs along both flanks. */
function handguard(length, radius, m, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.add(cyl(radius, radius, length, 12, m, 0, 0, 0));
  const slots = Math.max(2, Math.round(length / 0.045));
  for (let s = 0; s < slots; s++) {
    const sz = -length / 2 + 0.03 + s * (length - 0.06) / Math.max(1, slots - 1);
    for (const side of [-1, 1]) {
      g.add(box(0.004, 0.012, 0.020, MAT.poly(), side * radius * 0.96, 0, sz));
    }
    g.add(box(0.012, 0.004, 0.020, MAT.poly(), 0, -radius * 0.96, sz));
  }
  g.position.set(x, y, z);
  return g;
}

/** Curved rifle magazine — the curve is what makes it read as a magazine. */
function curvedMag(rounds, m, x = 0, y = 0, z = 0, curve = 0.22) {
  const g = new THREE.Group();
  const seg = 5;
  const h = rounds > 25 ? 0.155 : 0.115;
  for (let i = 0; i < seg; i++) {
    const t = i / (seg - 1);
    const yy = -t * h;
    const zz = Math.sin(t * curve * 4) * 0.014;
    const w = 0.030 - t * 0.002;
    g.add(box(w, h / seg + 0.004, 0.048, m, 0, yy, zz, t * curve * 0.5));
  }
  g.add(box(0.034, 0.008, 0.052, MAT.poly(), 0, -h - 0.004, Math.sin(curve * 4) * 0.014));
  g.position.set(x, y, z);
  return g;
}

/** Trigger, guard and grip — small, but their absence is what reads as "box". */
function triggerGroup(m, gripMat, x = 0, y = 0, z = 0, gripAngle = 0.30) {
  const g = new THREE.Group();
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.0042, 6, 14, Math.PI * 1.15), m);
  guard.rotation.set(Math.PI / 2, 0, -0.35);
  guard.position.set(0, -0.014, -0.004);
  g.add(guard);
  const trig = box(0.006, 0.024, 0.006, MAT.steel(), 0, -0.014, 0.002);
  trig.rotation.x = 0.22;
  g.add(trig);
  const grip = box(0.030, 0.098, 0.040, gripMat, 0, -0.062, 0.030, gripAngle);
  g.add(grip);
  g.add(box(0.032, 0.010, 0.042, MAT.poly(), 0, -0.112, 0.048));
  // finger grooves
  for (let i = 0; i < 3; i++) g.add(box(0.032, 0.004, 0.006, MAT.poly(), 0, -0.040 - i * 0.020, 0.012 + i * 0.008, gripAngle));
  g.position.set(x, y, z);
  return g;
}

function ironSights(m, frontZ, rearZ, height = 0.030) {
  const g = new THREE.Group();
  // front post inside a hooded ring
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.010, 0.0022, 5, 12), m);
  hood.rotation.y = Math.PI / 2;
  hood.position.set(0, height, frontZ);
  g.add(hood);
  g.add(box(0.0025, 0.013, 0.0025, MAT.steel(), 0, height - 0.003, frontZ));
  // rear aperture
  const ap = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.0026, 5, 12), m);
  ap.rotation.y = Math.PI / 2;
  ap.position.set(0, height, rearZ);
  g.add(ap);
  g.add(box(0.020, 0.006, 0.008, m, 0, height - 0.010, rearZ));
  return g;
}

function mount(name, parent, x, y, z, rx = 0) {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  o.rotation.x = rx;
  parent.add(o);
  return o;
}

/* ------------------------------------------------------------------ */
/* weapons                                                             */
/* ------------------------------------------------------------------ */

/**
 * Every model faces -Z (down the barrel) with the grip roughly at the origin.
 */
export function buildViewModel(id) {
  const g = new THREE.Group();
  const mounts = {};
  const camoParts = [];
  let ironSight = null;
  let muzzle = new THREE.Vector3(0, 0, -0.4);
  let sight = new THREE.Vector3(0, 0.045, -0.1);

  const B = MAT.body(), P = MAT.poly(), S = MAT.steel(), BL = MAT.blued(), W = MAT.wood(), R = MAT.rubber();

  switch (id) {
    case 'pistol': {
      // slide with serrations and an ejection port
      const slide = box(0.030, 0.034, 0.185, B, 0, 0.020, -0.045);
      g.add(slide); camoParts.push(slide);
      for (let i = 0; i < 7; i++) g.add(box(0.031, 0.030, 0.0035, BL, 0, 0.020, 0.020 - i * 0.0075));
      g.add(box(0.024, 0.014, 0.040, BL, 0.004, 0.028, -0.030));      // ejection port
      const frame = box(0.028, 0.026, 0.150, P, 0, -0.006, -0.040);
      g.add(frame); camoParts.push(frame);
      g.add(cyl(0.0075, 0.0075, 0.030, 10, S, 0, 0.020, -0.140));      // barrel crown
      g.add(triggerGroup(P, P, 0, -0.006, 0.012, 0.26));
      g.add(box(0.026, 0.012, 0.030, P, 0, -0.020, -0.058));           // dust cover / rail
      g.add(rail(0.036, P, 0, -0.030, -0.062));
      ironSight = new THREE.Group();
      ironSight.add(box(0.004, 0.008, 0.005, S, 0, 0.040, -0.126));
      ironSight.add(box(0.024, 0.008, 0.008, S, 0, 0.040, 0.036));
      ironSight.add(box(0.004, 0.009, 0.006, BL, -0.008, 0.041, 0.036));
      ironSight.add(box(0.004, 0.009, 0.006, BL, 0.008, 0.041, 0.036));
      g.add(ironSight);
      mounts.optic = mount('optic', g, 0, 0.038, -0.028);
      mounts.muzzle = mount('muzzle', g, 0, 0.020, -0.150);
      mounts.barrel = mount('barrel', g, 0, 0.020, -0.150);
      mounts.mag = mount('mag', g, 0, -0.040, 0.020);
      mounts.stock = mount('stock', g, 0, 0, 0.10);
      mounts.grip = mount('grip', g, 0, -0.030, -0.062);
      mounts.laser = mount('laser', g, 0.022, -0.024, -0.060);
      muzzle.set(0, 0.020, -0.155);
      sight.set(0, 0.041, -0.1);
      break;
    }

    case 'revolver': {
      const frame = box(0.026, 0.052, 0.120, B, 0, 0.014, -0.030);
      g.add(frame); camoParts.push(frame);
      // fluted cylinder
      const cylr = cyl(0.026, 0.026, 0.052, 12, BL, 0, 0.012, 0.010, 0);
      cylr.rotation.set(Math.PI / 2, 0, 0);
      g.add(cylr);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(box(0.008, 0.006, 0.048, BL, Math.cos(a) * 0.021, 0.012 + Math.sin(a) * 0.021, 0.010));
      }
      g.add(cyl(0.0095, 0.0095, 0.175, 12, S, 0, 0.020, -0.100));       // barrel
      g.add(box(0.018, 0.020, 0.170, BL, 0, 0.006, -0.098));            // underlug
      for (let i = 0; i < 5; i++) g.add(box(0.020, 0.005, 0.006, BL, 0, 0.032, -0.045 - i * 0.026));  // rib flutes
      g.add(triggerGroup(BL, W, 0, 0.000, 0.026, 0.34));
      g.add(box(0.030, 0.020, 0.030, BL, 0, 0.030, 0.046));             // hammer shroud
      const hammer = box(0.008, 0.026, 0.012, S, 0, 0.044, 0.056);
      hammer.rotation.x = -0.3; g.add(hammer);
      ironSight = new THREE.Group();
      ironSight.add(box(0.004, 0.011, 0.006, S, 0, 0.040, -0.180));
      ironSight.add(box(0.022, 0.009, 0.008, S, 0, 0.040, 0.040));
      g.add(ironSight);
      mounts.optic = mount('optic', g, 0, 0.038, -0.020);
      mounts.muzzle = mount('muzzle', g, 0, 0.020, -0.188);
      mounts.barrel = mount('barrel', g, 0, 0.020, -0.188);
      mounts.mag = mount('mag', g, 0, -0.030, 0.020);
      mounts.stock = mount('stock', g, 0, 0, 0.10);
      mounts.grip = mount('grip', g, 0, -0.004, -0.090);
      mounts.laser = mount('laser', g, 0.020, 0.004, -0.090);
      muzzle.set(0, 0.020, -0.192);
      sight.set(0, 0.040, -0.1);
      break;
    }

    case 'shotgun': {
      const rec = box(0.040, 0.060, 0.200, B, 0, 0.010, 0.055);
      g.add(rec); camoParts.push(rec);
      g.add(cyl(0.0145, 0.0145, 0.560, 14, BL, 0, 0.026, -0.230));      // barrel
      g.add(cyl(0.0115, 0.0115, 0.440, 12, BL, 0, -0.004, -0.180));     // magazine tube
      g.add(box(0.030, 0.008, 0.520, BL, 0, 0.042, -0.210));            // vent rib
      const pump = box(0.046, 0.040, 0.130, W, 0, -0.004, -0.170);
      g.add(pump); camoParts.push(pump);
      for (let i = 0; i < 9; i++) g.add(box(0.047, 0.006, 0.006, MAT.wood(), 0, -0.004, -0.225 + i * 0.014));
      g.add(box(0.036, 0.024, 0.060, BL, 0, -0.018, 0.030));            // loading port / lifter
      g.add(triggerGroup(BL, W, 0, -0.012, 0.070, 0.10));
      const stock = box(0.042, 0.090, 0.230, W, 0, -0.030, 0.240, -0.10);
      g.add(stock); camoParts.push(stock);
      g.add(box(0.046, 0.052, 0.018, R, 0, -0.055, 0.352));             // recoil pad
      ironSight = new THREE.Group();
      ironSight.add(box(0.005, 0.010, 0.006, MAT.brass(), 0, 0.050, -0.500));
      g.add(ironSight);
      mounts.optic = mount('optic', g, 0, 0.042, 0.020);
      mounts.muzzle = mount('muzzle', g, 0, 0.026, -0.508);
      mounts.barrel = mount('barrel', g, 0, 0.026, -0.508);
      mounts.mag = mount('mag', g, 0, -0.020, -0.120);
      mounts.stock = mount('stock', g, 0, -0.010, 0.150);
      mounts.grip = mount('grip', g, 0, -0.020, -0.190);
      mounts.laser = mount('laser', g, 0.026, 0.000, -0.180);
      muzzle.set(0, 0.026, -0.514);
      sight.set(0, 0.050, -0.1);
      break;
    }

    case 'rifle': {
      const rec = box(0.036, 0.062, 0.230, B, 0, 0.008, 0.040);
      g.add(rec); camoParts.push(rec);
      g.add(cyl(0.0105, 0.0125, 0.640, 12, BL, 0, 0.020, -0.290));      // heavy barrel
      for (let i = 0; i < 6; i++) g.add(box(0.024, 0.004, 0.006, BL, 0, 0.032, -0.120 - i * 0.070));
      const fore = box(0.046, 0.048, 0.300, W, 0, -0.006, -0.190);
      g.add(fore); camoParts.push(fore);
      g.add(box(0.048, 0.010, 0.060, MAT.wood(), 0, -0.028, -0.190));   // sling swivel bed
      const bolt = cyl(0.010, 0.010, 0.090, 10, S, 0.026, 0.020, 0.062);
      bolt.rotation.set(Math.PI / 2, 0, 0.35);
      g.add(bolt);
      g.add(cyl(0.011, 0.011, 0.024, 10, S, 0.048, 0.006, 0.086, 0));   // bolt knob
      g.add(box(0.030, 0.032, 0.070, BL, 0, -0.026, 0.020));            // floorplate / internal mag
      g.add(triggerGroup(BL, W, 0, -0.014, 0.056, 0.06));
      const stock = box(0.044, 0.100, 0.300, W, 0, -0.030, 0.280, -0.08);
      g.add(stock); camoParts.push(stock);
      g.add(box(0.046, 0.058, 0.018, R, 0, -0.060, 0.420));
      g.add(box(0.040, 0.050, 0.080, MAT.wood(), 0, 0.010, 0.190));     // comb
      ironSight = new THREE.Group();
      ironSight.add(box(0.004, 0.012, 0.006, S, 0, 0.044, -0.580));
      ironSight.add(box(0.024, 0.010, 0.010, S, 0, 0.044, -0.010));
      g.add(ironSight);
      mounts.optic = mount('optic', g, 0, 0.042, -0.020);
      mounts.muzzle = mount('muzzle', g, 0, 0.020, -0.608);
      mounts.barrel = mount('barrel', g, 0, 0.020, -0.608);
      mounts.mag = mount('mag', g, 0, -0.040, 0.020);
      mounts.stock = mount('stock', g, 0, -0.010, 0.150);
      mounts.grip = mount('grip', g, 0, -0.030, -0.230);
      mounts.laser = mount('laser', g, 0.026, -0.006, -0.220);
      muzzle.set(0, 0.020, -0.614);
      sight.set(0, 0.044, -0.1);
      break;
    }

    case 'smg': {
      const rec = box(0.040, 0.070, 0.240, B, 0, 0.006, -0.020);
      g.add(rec); camoParts.push(rec);
      g.add(box(0.042, 0.020, 0.120, P, 0, 0.040, -0.030));             // top cover
      g.add(rail(0.150, P, 0, 0.052, -0.030));
      g.add(handguard(0.110, 0.020, P, 0, -0.002, -0.170));
      g.add(cyl(0.0085, 0.0085, 0.070, 10, S, 0, 0, -0.245));
      const mag = curvedMag(30, P, 0, -0.038, 0.010, 0.16);
      g.add(mag); camoParts.push(...mag.children.slice(0, 3));
      g.add(triggerGroup(P, P, 0, -0.010, 0.070, 0.24));
      g.add(box(0.010, 0.020, 0.020, S, 0.026, 0.030, 0.040));          // charging handle
      const tube = cyl(0.018, 0.018, 0.130, 10, P, 0, 0.010, 0.180);
      g.add(tube); camoParts.push(tube);
      g.add(box(0.036, 0.056, 0.016, R, 0, -0.006, 0.250));
      g.add(box(0.014, 0.030, 0.100, P, 0, -0.008, 0.180));             // stock spine
      ironSight = new THREE.Group();
      ironSight.add(box(0.004, 0.010, 0.005, S, 0, 0.062, -0.200));
      ironSight.add(box(0.022, 0.008, 0.008, S, 0, 0.062, 0.040));
      g.add(ironSight);
      mounts.optic = mount('optic', g, 0, 0.056, -0.030);
      mounts.muzzle = mount('muzzle', g, 0, 0, -0.278);
      mounts.barrel = mount('barrel', g, 0, 0, -0.278);
      mounts.mag = mount('mag', g, 0, -0.038, 0.010);
      mounts.stock = mount('stock', g, 0, 0.006, 0.110);
      mounts.grip = mount('grip', g, 0, -0.022, -0.180);
      mounts.laser = mount('laser', g, 0.024, -0.002, -0.180);
      muzzle.set(0, 0, -0.284);
      sight.set(0, 0.062, -0.1);
      break;
    }

    case 'carbine': {
      const upper = box(0.038, 0.048, 0.290, B, 0, 0.026, -0.040);
      g.add(upper); camoParts.push(upper);
      g.add(rail(0.280, P, 0, 0.052, -0.040));
      const lower = box(0.034, 0.052, 0.170, B, 0, -0.014, 0.030);
      g.add(lower); camoParts.push(lower);
      g.add(box(0.030, 0.020, 0.044, P, 0.006, 0.024, 0.070));          // ejection port cover
      g.add(box(0.012, 0.018, 0.030, S, -0.024, 0.040, 0.098));         // forward assist
      g.add(handguard(0.240, 0.023, P, 0, 0.020, -0.250));
      g.add(cyl(0.0085, 0.0085, 0.160, 10, S, 0, 0.020, -0.420));
      g.add(cyl(0.013, 0.013, 0.022, 10, BL, 0, 0.020, -0.352));        // gas block
      g.add(box(0.008, 0.030, 0.010, BL, 0, 0.040, -0.352));
      const mag = curvedMag(30, P, 0, -0.044, 0.006, 0.20);
      g.add(mag); camoParts.push(...mag.children.slice(0, 3));
      g.add(triggerGroup(P, P, 0, -0.020, 0.062, 0.28));
      g.add(box(0.030, 0.014, 0.030, S, 0, 0.048, 0.128));              // charging handle
      const buffer = cyl(0.019, 0.019, 0.160, 10, P, 0, 0.014, 0.190);
      g.add(buffer); camoParts.push(buffer);
      g.add(box(0.038, 0.062, 0.090, P, 0, -0.002, 0.230));             // stock body
      g.add(box(0.042, 0.058, 0.016, R, 0, -0.004, 0.282));
      ironSight = new THREE.Group();
      ironSight.add(box(0.005, 0.026, 0.006, BL, 0, 0.066, -0.352));
      ironSight.add(box(0.022, 0.010, 0.010, BL, 0, 0.062, 0.100));
      g.add(ironSight);
      mounts.optic = mount('optic', g, 0, 0.056, -0.020);
      mounts.muzzle = mount('muzzle', g, 0, 0.020, -0.498);
      mounts.barrel = mount('barrel', g, 0, 0.020, -0.498);
      mounts.mag = mount('mag', g, 0, -0.044, 0.006);
      mounts.stock = mount('stock', g, 0, 0.010, 0.150);
      mounts.grip = mount('grip', g, 0, -0.004, -0.300);
      mounts.laser = mount('laser', g, 0.026, 0.014, -0.300);
      muzzle.set(0, 0.020, -0.504);
      sight.set(0, 0.062, -0.1);
      break;
    }

    case 'knife': {
      g.add(box(0.026, 0.100, 0.032, R, 0, -0.036, 0.036));
      for (let i = 0; i < 5; i++) g.add(box(0.027, 0.005, 0.033, MAT.rubber(), 0, -0.012 - i * 0.018, 0.036));
      g.add(box(0.034, 0.012, 0.014, BL, 0, 0.012, 0.004));             // guard
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.038, 0.210), S);
      blade.position.set(0, 0.024, -0.100);
      g.add(blade);
      const edge = box(0.003, 0.010, 0.200, MAT.steel(), 0, 0.006, -0.098);
      g.add(edge);
      // serrations on the spine
      for (let i = 0; i < 7; i++) g.add(box(0.011, 0.006, 0.008, BL, 0, 0.042, -0.030 - i * 0.016));
      g.add(box(0.011, 0.020, 0.030, S, 0, 0.030, -0.198, 0.5));        // clip point
      muzzle.set(0, 0.024, -0.205);
      sight.set(0, 0.024, -0.1);
      break;
    }

    case 'axe': {
      const haft = cyl(0.017, 0.020, 0.560, 8, W, 0, -0.050, 0.070, 1.36);
      g.add(haft);
      for (let i = 0; i < 4; i++) g.add(box(0.020, 0.006, 0.020, R, 0, -0.006 + i * 0.004, 0.180 - i * 0.03));
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.115, 0.070), S);
      head.position.set(0, 0.100, -0.205);
      g.add(head);
      const bit = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.130, 0.030), MAT.steel());
      bit.position.set(0, 0.100, -0.248);
      g.add(bit);
      g.add(box(0.030, 0.050, 0.055, BL, 0, 0.100, -0.150));            // eye / poll
      g.add(box(0.024, 0.030, 0.040, BL, 0, 0.100, -0.108));
      muzzle.set(0, 0.100, -0.262);
      sight.set(0, 0.050, -0.1);
      break;
    }

    case 'machete': {
      g.add(box(0.024, 0.048, 0.110, R, 0, -0.014, 0.062));
      for (let i = 0; i < 4; i++) g.add(box(0.025, 0.005, 0.026, MAT.rubber(), 0, -0.014, 0.024 + i * 0.024));
      g.add(box(0.030, 0.010, 0.012, BL, 0, 0.006, 0.004));
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.062, 0.420), S);
      blade.position.set(0, 0.020, -0.200);
      g.add(blade);
      g.add(box(0.0025, 0.014, 0.410, MAT.steel(), 0, -0.006, -0.198)); // edge bevel
      const tip = box(0.008, 0.050, 0.060, S, 0, 0.030, -0.400, 0.35);
      g.add(tip);
      muzzle.set(0, 0.020, -0.418);
      sight.set(0, 0.020, -0.1);
      break;
    }

    default: {
      // bare hands: a suggestion of a fist so the slot never renders empty
      g.add(box(0.062, 0.050, 0.100, R, 0.02, -0.02, -0.02, 0, 0.3, 0));
      g.add(box(0.058, 0.020, 0.030, R, 0.02, 0.004, -0.062, 0, 0.3, 0));
      muzzle.set(0, 0, -0.1);
      sight.set(0, 0, -0.1);
    }
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  g.userData.muzzle = muzzle;
  g.userData.sight = sight;
  g.userData.mounts = mounts;
  g.userData.camoParts = camoParts;
  g.userData.ironSight = ironSight;
  return g;
}

/** Where the viewmodel rests in camera space, per weapon. */
export const HIP_POSE = {
  pistol:   { pos: [0.135, -0.140, -0.40], rot: [0.02, 0.075, 0] },
  revolver: { pos: [0.140, -0.145, -0.41], rot: [0.02, 0.075, 0] },
  shotgun:  { pos: [0.150, -0.150, -0.30], rot: [0.03, 0.075, 0] },
  rifle:    { pos: [0.152, -0.152, -0.28], rot: [0.03, 0.070, 0] },
  smg:      { pos: [0.145, -0.148, -0.36], rot: [0.02, 0.080, 0] },
  carbine:  { pos: [0.148, -0.150, -0.32], rot: [0.02, 0.075, 0] },
  knife:    { pos: [0.180, -0.180, -0.38], rot: [0.10, -0.25, 0.10] },
  axe:      { pos: [0.215, -0.250, -0.42], rot: [0.08, -0.30, 0.15] },
  machete:  { pos: [0.200, -0.215, -0.42], rot: [0.08, -0.28, 0.12] },
  none:     { pos: [0.165, -0.200, -0.38], rot: [0, 0, 0] },
};

/** Apply a camo texture to the paintable surfaces of a built model. */
export function applyCamo(model, texture, info) {
  if (!model || !model.userData.camoParts) return;
  for (const part of model.userData.camoParts) {
    if (!part.isMesh) continue;
    if (!part.userData._camoMat) {
      part.userData._origMat = part.material;
      part.userData._camoMat = part.material.clone();
    }
    const m = part.userData._camoMat;
    if (texture) {
      m.map = texture;
      m.color.set(0xffffff);
      m.roughness = info ? info.rough : 0.6;
      m.metalness = info ? info.metal : 0.3;
      m.needsUpdate = true;
      part.material = m;
    } else {
      part.material = part.userData._origMat;
    }
  }
}

export function disposeViewModelMaterials() {
  for (const k of Object.keys(CACHE)) { CACHE[k].dispose(); delete CACHE[k]; }
}
