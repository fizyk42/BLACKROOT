import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Vehicle, VEHICLES } from '../client/src/entities/vehicle.js';
import { Player } from '../client/src/entities/player.js';
import { TrafficCar, TrafficSystem } from '../client/src/entities/traffic.js';
import { RoadGraph, isOnRoad, poi } from '../client/src/world/citymap.js';
import { SpatialGrid } from '../client/src/core/util.js';
import { findRoadSpawn } from '../client/src/world/vehicle-spawn.js';

const neutral = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const advance = (v, ctl, seconds = 1) => {
  for (let i = 0; i < seconds * 60; i++) v.update(1 / 60, { ...neutral, ...ctl });
};
const cameraAt = yaw => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(-Math.sin(yaw) * 6, 2, -Math.cos(yaw) * 6);
  camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  return camera;
};
for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  const camera = cameraAt(yaw);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const forward = camera.getWorldDirection(new THREE.Vector3()); forward.y = 0; forward.normalize();
  for (const [x, y, expected] of [[1, 0, right], [-1, 0, right.clone().negate()], [0, 1, forward], [0, -1, forward.clone().negate()]]) {
    // Stub animation only; execute the production locomotion and combat methods.
    const p = Object.assign(Object.create(Player.prototype), {
      character: { play() {}, playOnce() {}, setPosition() {}, setYaw() {} },
      camYaw: yaw, pos: new THREE.Vector3(), vel: new THREE.Vector3(), lastSafePos: new THREE.Vector3(),
      grounded: true, stamina: 100, vy: 0, yaw, weapon: 'fists', weapons: { fists: {} }, footTimer: 0,
    });
    const input = { axes: { moveX: x, moveY: y }, isDown: () => false, pressed: () => false };
    for (let i = 0; i < 60; i++) p.updateOnFoot(1 / 60, input, null, { input });
    assert.ok(p.pos.dot(expected) > 3, `walking (${x},${y}) must follow the camera at yaw ${yaw}`);
  }
  for (const id of Object.keys(VEHICLES)) {
    const v = new Vehicle(id, { yaw }); v.attach(new THREE.Scene());
    const front = v.mesh.userData.chassis.children.find(o => o.material === v.mesh.userData.headMat);
    const rear = v.mesh.userData.chassis.children.find(o => o.material === v.mesh.userData.tailMat);
    const centre = mesh => { mesh.geometry.computeBoundingBox(); return mesh.localToWorld(mesh.geometry.boundingBox.getCenter(new THREE.Vector3())); };
    v.mesh.updateMatrixWorld(true);
    const nose = centre(front).sub(centre(rear)); nose.y = 0; nose.normalize();
    advance(v, { throttle: 1 });
    assert.ok(v.pos.dot(nose) > 2, `${id}: must travel nose-first at yaw ${yaw}`);
    assert.ok(v.pos.clone().normalize().dot(nose) > .999, `${id}: no sideways travel`);
    for (const w of v.mesh.userData.wheels) {
      w.children[0].geometry.computeBoundingBox();
      const size = w.children[0].geometry.boundingBox.getSize(new THREE.Vector3());
      assert.ok(size.z < size.x && size.z < size.y, `${id}: tyre axle must cross the model width`);
    }
    v.steerAngle = v.yawRate = 0; v.bodyPitch = v.bodyRoll = 0;
    const start = v.pos.clone(); advance(v, { throttle: .3, steer: 1 }, .5);
    assert.ok(v.pos.clone().sub(start).dot(right) > .1, `${id}: right steering must turn screen-right`);
    const left = new Vehicle(id, { yaw }); left.speed = 6; advance(left, { steer: -1 }, .5);
    assert.ok(left.pos.dot(right) < -.1, `${id}: left steering must turn screen-left`);
    const reverse = new Vehicle(id, { yaw }); advance(reverse, { brake: 1 }, 1);
    assert.ok(reverse.pos.dot(forward) < -1, `${id}: brake at rest reverses`);
    const brake = new Vehicle(id, { yaw }); brake.speed = 10; advance(brake, { brake: 1 }, .3);
    assert.ok(brake.speed >= 0 && brake.speed < 8, `${id}: brakes slow forward travel`);
    const handbrake = new Vehicle(id); handbrake.speed = 2; advance(handbrake, { handbrake: true }, 2);
    assert.equal(handbrake.speed, 0, `${id}: handbrake settles at rest`);
    v.detach(v.mesh.parent);
  }
}
console.log('Camera-relative movement, nose-first driving, wheel axes, steering, braking and reverse passed for all seven vehicle types at four headings.');

const graph = new RoadGraph(), colliders = new SpatialGrid();
const shop = poi('vega_shop');
colliders.add({ minX: shop.x - 11, maxX: shop.x + 11, minZ: shop.z - 8, maxZ: shop.z + 8, height: 9 });
const spawned = [];
for (const id of Object.keys(VEHICLES)) {
  const spot = findRoadSpawn(graph, VEHICLES[id], shop.x, shop.z, colliders, spawned);
  assert.ok(isOnRoad(spot.x, spot.z), `${id}: spawn on asphalt`);
  const v = new Vehicle(id, spot), original = v.pos.clone();
  for (let i = 0; i < 60; i++) v.update(1 / 60, { ...neutral, throttle: 1 }, colliders, spawned);
  assert.equal(v.health, 100, `${id}: spawn should not collide with the garage or another car`);
  assert.ok(v.pos.distanceTo(original) > 2, `${id}: can drive away from spawn`);
  v.pos.copy(original); spawned.push(v);
}
const scene = new THREE.Scene(), traffic = new TrafficSystem(scene, { graph });
// Exercise both road orientations deterministically through actual parked spawn.
const random = Math.random;
try {
  for (const horizontal of [true, false]) for (const side of [-1, 1]) {
    const values = [5/11 + .001, 5/11 + .001, horizontal ? .25 : .75, .5, side < 0 ? .25 : .75];
    Math.random = () => values.length ? values.shift() : .5;
    const v = traffic.spawnParked(new THREE.Vector3(440, 0, 440), []);
    assert.ok(v, 'parked car spawned');
    assert.ok(horizontal ? Math.abs(Math.cos(v.yaw)) < 1e-6 : Math.abs(Math.sin(v.yaw)) < 1e-6, 'parked car parallel to kerb');
    traffic.takeVehicle(v);
    assert.ok(!traffic.parked.includes(v) && v.mesh.parent === scene, 'traffic handover preserves mesh');
  }
} finally { Math.random = random; }
// A displaced AI driver must converge toward its lane after the steering fix.
const edge = graph.edges.find(e => e.axis === 'z' && e.dz > 0 && graph.nodes[e.a].x === 440 && graph.nodes[e.a].z === 440);
for (const side of [-1, 1]) {
  const car = new TrafficCar(graph, edge, 0); car.t = .3;
  const lane = graph.lanePoint(edge, car.t, 0, {});
  car.vehicle.pos.set(lane.x + side * 2, 0, lane.z); car.vehicle.speed = 6;
  for (let i = 0; i < 90; i++) car.update(1 / 60, 0, null, [], null);
  assert.ok(Math.abs(car.pos.x - lane.x) < 1, 'traffic steers back toward lane');
}
console.log('Clear road spawns, parked headings, vehicle handover and AI lane correction passed.');
