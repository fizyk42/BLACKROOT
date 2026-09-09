/**
 * Bake — collapse a tree of static meshes into one mesh per material.
 *
 * A landmark is built the way it is easiest to *write*: a plank here, a beam
 * there, forty of them, each its own mesh. That is the right way to author it
 * and the wrong way to draw it. Eighteen landmarks came to 273 separate draw
 * calls before this, and every one of them was drawn twice — once for the
 * frame and once for the shadow map — for geometry that never moves.
 *
 * Baking bakes only what is genuinely static. Anything that animates, anything
 * a system holds a reference to (a door that opens, a lamp that flickers, an
 * interactable the player can look at), and anything with its own transform
 * that changes is left exactly where it is. The merge is by material *object*,
 * not by appearance, so nothing that looked different before looks the same
 * afterwards.
 */
import * as THREE from 'three';
import { mergeGeometries } from './Flora.js';

/**
 * @param root    the group to flatten, in place
 * @param keep    objects (and their subtrees) that must not be merged
 * @returns { before, after, merged } draw-call counts, for the tests
 */
export function bakeStatic(root, keep = new Set()) {
  root.updateMatrixWorld(true);

  // Anything inside a protected subtree stays. Walking down from each kept
  // object is how a door's handle survives along with the door.
  const protectedSet = new Set();
  for (const k of keep) {
    if (!k || !k.isObject3D) continue;
    k.traverse((o) => protectedSet.add(o));
  }

  const buckets = new Map();     // material -> { mat, meshes[], cast, receive }
  let before = 0;

  root.traverse((o) => {
    if (!o.isMesh) return;
    before++;
    if (protectedSet.has(o)) return;
    if (o.isInstancedMesh || o.isSkinnedMesh) return;
    if (Array.isArray(o.material)) return;          // multi-material: not worth it
    if (!o.geometry || !o.geometry.attributes.position) return;
    // A parent that is animated moves this with it, so it is not static.
    for (let p = o; p && p !== root; p = p.parent) if (protectedSet.has(p)) return;

    let b = buckets.get(o.material);
    if (!b) { b = { mat: o.material, meshes: [], cast: false, receive: false }; buckets.set(o.material, b); }
    b.meshes.push(o);
    b.cast = b.cast || o.castShadow;
    b.receive = b.receive || o.receiveShadow;
  });

  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const xf = new THREE.Matrix4();
  let merged = 0;
  for (const b of buckets.values()) {
    // A material used by exactly one mesh saves nothing and costs a copy of
    // its geometry, so it is left alone.
    if (b.meshes.length < 2) continue;
    const geoms = [];
    for (const o of b.meshes) {
      const g = o.geometry.clone();
      // Into the root's space, so the merged mesh can sit directly under it.
      g.applyMatrix4(xf.copy(inv).multiply(o.matrixWorld));
      if (!g.attributes.normal) g.computeVertexNormals();
      geoms.push(g);
    }
    for (const o of b.meshes) { o.parent?.remove(o); o.geometry.dispose(); }
    const mesh = new THREE.Mesh(mergeGeometries(geoms), b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = 'baked';
    root.add(mesh);
    merged++;
  }

  let after = 0;
  root.traverse((o) => { if (o.isMesh) after++; });
  return { before, after, merged };
}

/**
 * Mark a subtree as never moving again. three.js recomposes a world matrix for
 * every object every frame unless told not to; for the thousands of static
 * props in a world that is pure waste, and it is waste that scales with how
 * much detail you add.
 */
export function freeze(root) {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
  });
}
