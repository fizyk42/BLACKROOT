import { Scene } from 'three';
import assert from 'node:assert/strict';
import { Vehicle, VEHICLES } from '../client/src/entities/vehicle.js';
for (const id of Object.keys(VEHICLES)) {
  const vehicle = new Vehicle(id);
  vehicle.attach(new Scene());
  let meshes = 0;
  vehicle.mesh.traverse(object => {
    if (!object.isMesh) return;
    const positions = object.geometry?.attributes.position;
    assert.ok(positions?.count > 0, `${id}: mesh has no vertices`);
    assert.ok(Array.from(positions.array).every(Number.isFinite), `${id}: invalid vertices`);
    meshes++;
  });
  assert.ok(meshes > 4, `${id}: incomplete model`);
  console.log(`${id}: ${meshes} meshes constructed successfully`);
}
