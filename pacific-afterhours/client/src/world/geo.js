// Geometry factories. Everything returns un-merged BufferGeometry already
// positioned in world space, so world.js can merge whole chunks into few draws.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

export function place(geo, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(0, ry, 0);
  _q.setFromEuler(_e);
  _m.compose(_v.set(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
  geo.applyMatrix4(_m);
  return geo;
}

/** Flat quad on the ground (y up), width along x, depth along z. */
export function ground(w, d, y = 0, uvScaleX = 1, uvScaleZ = 1) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScaleX, uv.getY(i) * uvScaleZ);
  g.translate(0, y, 0);
  return g;
}

/** Vertical wall facing +z by default. uvTile = how many texture tiles across / up. */
export function wall(w, h, tileX = 1, tileY = 1) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * tileX, uv.getY(i) * tileY);
  return g;
}

export function box(w, h, d, uvScale = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (uvScale) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale);
  }
  return g;
}

/**
 * A building shell: four textured walls + a roof slab, parapet and rooftop clutter.
 * `tileW`/`tileH` are the real-world size of one facade texture tile.
 */
export function buildingShell(w, h, d, tileW, tileH, opts = {}) {
  const hw = w / 2, hd = d / 2;
  const parts = [];
  const tx = Math.max(1, Math.round(w / tileW));
  const tz = Math.max(1, Math.round(d / tileW));
  const ty = Math.max(1, Math.round(h / tileH));

  const north = wall(w, h, tx, ty); north.translate(0, h / 2, hd); parts.push(north);
  const south = wall(w, h, tx, ty); south.rotateY(Math.PI); south.translate(0, h / 2, -hd); parts.push(south);
  const east = wall(d, h, tz, ty); east.rotateY(Math.PI / 2); east.translate(hw, h / 2, 0); parts.push(east);
  const west = wall(d, h, tz, ty); west.rotateY(-Math.PI / 2); west.translate(-hw, h / 2, 0); parts.push(west);
  return { walls: mergeGeometries(parts, false), height: h };
}

export function roofSlab(w, h, d, parapet = 1.0) {
  const parts = [];
  parts.push(ground(w, d, h, w / 6, d / 6));
  const t = 0.35;
  parts.push(place(box(w, parapet, t), 0, h + parapet / 2, d / 2 - t / 2));
  parts.push(place(box(w, parapet, t), 0, h + parapet / 2, -d / 2 + t / 2));
  parts.push(place(box(t, parapet, d), w / 2 - t / 2, h + parapet / 2, 0));
  parts.push(place(box(t, parapet, d), -w / 2 + t / 2, h + parapet / 2, 0));
  return mergeGeometries(parts, false);
}

export function roofClutter(w, d, h, rng) {
  const parts = [];
  const n = rng.int(2, 5);
  for (let k = 0; k < n; k++) {
    const bw = rng.range(1.6, 3.4), bd = rng.range(1.4, 2.8), bh = rng.range(0.8, 1.8);
    parts.push(place(box(bw, bh, bd),
      rng.range(-w / 2 + 3, w / 2 - 3), h + bh / 2, rng.range(-d / 2 + 3, d / 2 - 3), rng() * 3));
  }
  if (rng.chance(0.5)) { // stair head / lift over-run
    parts.push(place(box(3.2, 2.6, 3.0), rng.range(-w / 4, w / 4), h + 1.3, rng.range(-d / 4, d / 4)));
  }
  if (rng.chance(0.45)) { // roof aerial
    parts.push(place(box(0.14, rng.range(3, 7), 0.14), rng.range(-w / 3, w / 3), h + 3, rng.range(-d / 3, d / 3)));
  }
  return parts.length ? mergeGeometries(parts, false) : null;
}

/** Ground-floor shopfront: recessed glazing, stall riser, awning arm. */
export function shopfront(w, h = 3.6) {
  const parts = [];
  parts.push(place(box(w, 0.7, 0.35), 0, 0.35, 0.1));       // stall riser
  parts.push(place(box(w, 0.35, 0.5), 0, h, 0.05));          // fascia
  parts.push(place(box(0.2, h, 0.4), -w / 2 + 0.1, h / 2, 0.05));
  parts.push(place(box(0.2, h, 0.4), w / 2 - 0.1, h / 2, 0.05));
  return mergeGeometries(parts, false);
}

export function glazing(w, h) {
  const g = new THREE.PlaneGeometry(w, h);
  return g;
}

export function awning(w, depth = 1.5, h = 3.4) {
  const parts = [];
  parts.push(place(box(w, 0.12, depth), 0, h, depth / 2));
  parts.push(place(box(0.09, 0.7, 0.09), -w / 2 + 0.3, h - 0.35, depth - 0.15));
  parts.push(place(box(0.09, 0.7, 0.09), w / 2 - 0.3, h - 0.35, depth - 0.15));
  return mergeGeometries(parts, false);
}

// ------------------------------------------------------------- street furniture

export function streetLight(ry = 0) {
  const parts = [];
  parts.push(place(new THREE.CylinderGeometry(0.36, 0.42, 0.5, 8), 0, 0.25, 0));
  parts.push(place(new THREE.CylinderGeometry(0.11, 0.16, 8.2, 8), 0, 4.2, 0));
  // curved arm approximated with three short segments
  parts.push(place(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6), 0.35, 8.35, 0, 0, 1, 1, 1).rotateZ(0));
  const arm = new THREE.CylinderGeometry(0.08, 0.08, 2.4, 6);
  arm.rotateZ(Math.PI / 2);
  arm.translate(1.4, 8.7, 0);
  parts.push(arm);
  const g = mergeGeometries(parts, false);
  g.rotateY(ry);
  return g;
}

export function streetLightHead(ry = 0) {
  const g = new THREE.BoxGeometry(0.75, 0.2, 0.42);
  g.translate(2.5, 8.6, 0);
  g.rotateY(ry);
  return g;
}

export function trafficSignalPole(ry = 0) {
  const parts = [];
  parts.push(place(new THREE.CylinderGeometry(0.14, 0.2, 6.6, 8), 0, 3.3, 0));
  const arm = new THREE.CylinderGeometry(0.1, 0.1, 4.2, 6);
  arm.rotateZ(Math.PI / 2);
  arm.translate(2.1, 6.4, 0);
  parts.push(arm);
  parts.push(place(box(0.42, 1.25, 0.38), 3.8, 5.75, 0));   // signal housing on the arm
  parts.push(place(box(0.38, 1.1, 0.34), 0, 4.4, 0.28));    // near-side repeater
  const g = mergeGeometries(parts, false);
  g.rotateY(ry);
  return g;
}

export function bench(ry = 0) {
  const parts = [];
  parts.push(place(box(1.9, 0.09, 0.52), 0, 0.46, 0));
  parts.push(place(box(1.9, 0.5, 0.09), 0, 0.72, -0.22));
  parts.push(place(box(0.09, 0.46, 0.5), -0.82, 0.23, 0));
  parts.push(place(box(0.09, 0.46, 0.5), 0.82, 0.23, 0));
  const g = mergeGeometries(parts, false);
  g.rotateY(ry);
  return g;
}

export function bin() {
  const parts = [];
  parts.push(place(new THREE.CylinderGeometry(0.33, 0.28, 0.95, 10), 0, 0.475, 0));
  parts.push(place(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 10), 0, 0.98, 0));
  return mergeGeometries(parts, false);
}

export function hydrant() {
  const parts = [];
  parts.push(place(new THREE.CylinderGeometry(0.14, 0.17, 0.62, 8), 0, 0.31, 0));
  parts.push(place(new THREE.SphereGeometry(0.15, 8, 6), 0, 0.66, 0));
  parts.push(place(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 6).rotateZ(Math.PI / 2), 0, 0.42, 0));
  return mergeGeometries(parts, false);
}

export function parkingMeter() {
  const parts = [];
  parts.push(place(new THREE.CylinderGeometry(0.05, 0.06, 1.15, 6), 0, 0.58, 0));
  parts.push(place(box(0.2, 0.34, 0.14), 0, 1.3, 0));
  return mergeGeometries(parts, false);
}

export function busStop(ry = 0) {
  const parts = [];
  parts.push(place(box(0.12, 2.6, 0.12), -1.8, 1.3, -0.7));
  parts.push(place(box(0.12, 2.6, 0.12), 1.8, 1.3, -0.7));
  parts.push(place(box(0.12, 2.6, 0.12), -1.8, 1.3, 0.7));
  parts.push(place(box(0.12, 2.6, 0.12), 1.8, 1.3, 0.7));
  parts.push(place(box(4.0, 0.12, 1.7), 0, 2.62, 0));
  parts.push(place(box(4.0, 1.9, 0.06), 0, 1.35, -0.75));
  const g = mergeGeometries(parts, false);
  g.rotateY(ry);
  return g;
}

export function palmTree(rng, scale = 1) {
  const parts = [];
  const h = rng.range(6.5, 11) * scale;
  const seg = 6;
  for (let s = 0; s < seg; s++) {
    const t0 = s / seg, t1 = (s + 1) / seg;
    const lean = Math.sin(t0 * 1.4) * h * 0.06;
    const c = new THREE.CylinderGeometry(0.22 - t1 * 0.09, 0.26 - t0 * 0.09, (h / seg) * 1.02, 7);
    c.translate(lean, h * (t0 + t1) / 2, lean * 0.4);
    parts.push(c);
  }
  return { trunk: mergeGeometries(parts, false), height: h, lean: Math.sin(1.4) * h * 0.06 };
}

export function palmFronds(h, lean, rng) {
  const parts = [];
  const n = rng.int(7, 10);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const len = rng.range(2.2, 3.4);
    const g = new THREE.PlaneGeometry(0.75, len);
    g.translate(0, len / 2, 0);
    g.rotateX(rng.range(0.75, 1.35));
    g.rotateY(a);
    g.translate(lean, h - 0.3, lean * 0.4);
    parts.push(g);
  }
  return mergeGeometries(parts, false);
}

export function broadleafTree(rng, scale = 1) {
  const h = rng.range(4.5, 8) * scale;
  const trunk = new THREE.CylinderGeometry(0.16, 0.32, h, 7);
  trunk.translate(0, h / 2, 0);
  const canopy = [];
  const n = rng.int(3, 5);
  for (let k = 0; k < n; k++) {
    const r = rng.range(1.4, 2.5) * scale;
    const s = new THREE.SphereGeometry(r, 7, 5);
    s.translate(rng.range(-1.1, 1.1), h + rng.range(-0.3, 1.4), rng.range(-1.1, 1.1));
    // squash for a wind-shaped look
    s.scale(1, rng.range(0.62, 0.85), 1);
    canopy.push(s);
  }
  return { trunk, canopy: mergeGeometries(canopy, false) };
}

export function bush(rng) {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const s = new THREE.SphereGeometry(rng.range(0.5, 0.95), 6, 4);
    s.translate(rng.range(-0.5, 0.5), rng.range(0.3, 0.6), rng.range(-0.5, 0.5));
    parts.push(s);
  }
  return mergeGeometries(parts, false);
}

export function fenceRun(length, ry = 0) {
  const parts = [];
  const posts = Math.max(2, Math.round(length / 2.5));
  for (let k = 0; k <= posts; k++) {
    parts.push(place(box(0.09, 2.2, 0.09), -length / 2 + (length * k) / posts, 1.1, 0));
  }
  parts.push(place(box(length, 0.08, 0.05), 0, 2.05, 0));
  parts.push(place(box(length, 0.08, 0.05), 0, 1.2, 0));
  const g = mergeGeometries(parts, false);
  g.rotateY(ry);
  return g;
}

export function dumpster(ry = 0) {
  const parts = [];
  parts.push(place(box(2.0, 1.15, 1.15), 0, 0.62, 0));
  parts.push(place(box(2.05, 0.1, 1.2), 0, 1.24, 0));
  const g = mergeGeometries(parts, false);
  g.rotateY(ry);
  return g;
}

export function acUnit(ry = 0) {
  const parts = [];
  parts.push(place(box(1.4, 0.9, 1.1), 0, 0.45, 0));
  parts.push(place(new THREE.CylinderGeometry(0.35, 0.35, 0.1, 10), 0, 0.93, 0));
  const g = mergeGeometries(parts, false);
  g.rotateY(ry);
  return g;
}

export function utilityPole(ry = 0) {
  const parts = [];
  parts.push(place(new THREE.CylinderGeometry(0.16, 0.24, 9.5, 7), 0, 4.75, 0));
  parts.push(place(box(2.6, 0.14, 0.14), 0, 8.7, 0));
  parts.push(place(box(2.0, 0.12, 0.12), 0, 8.0, 0));
  const g = mergeGeometries(parts, false);
  g.rotateY(ry);
  return g;
}

/** Sign panel used for shopfronts and business fascias. */
export function signPanel(w, h) {
  return new THREE.PlaneGeometry(w, h);
}

export function kerbRing(x0, z0, x1, z1, height = 0.16, thickness = 0.35) {
  const parts = [];
  const w = x1 - x0, d = z1 - z0;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  parts.push(place(box(w, height, thickness), cx, height / 2, z0));
  parts.push(place(box(w, height, thickness), cx, height / 2, z1));
  parts.push(place(box(thickness, height, d), x0, height / 2, cz));
  parts.push(place(box(thickness, height, d), x1, height / 2, cz));
  return mergeGeometries(parts, false);
}

export { mergeGeometries };
