import { clamp, resolveCircleVsBoxes } from '../core/util.js';

// Place cars along a clear kerb lane, away from junctions, walls and other cars.
// Door offsets are pedestrian positions and can lie inside a vehicle footprint.
export function findRoadSpawn(graph, spec, x, z, colliders, others = []) {
  const candidates = [];
  for (const edge of graph.edges) {
    const a = graph.nodes[edge.a];
    const t = clamp(((x - a.x) * edge.dx + (z - a.z) * edge.dz) / edge.length, .18, .82);
    for (const sample of new Set([t, .25, .5, .75])) {
      const p = graph.lanePoint(edge, sample, 1, {});
      candidates.push({ ...p, yaw: graph.edgeHeading(edge), distance: (p.x - x) ** 2 + (p.z - z) ** 2 });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const boxes = [], radius = Math.max(spec.width, 1.6) * .5;
  const halfLength = spec.length * .5 - radius * .5;
  for (const p of candidates) {
    if (others.some(v => v.active && Math.hypot(v.pos.x - p.x, v.pos.z - p.z) < (v.spec.length + spec.length) * .5 + 2)) continue;
    let clear = true;
    if (colliders) for (const t of [-1, 0, 1]) {
      const px = p.x + Math.sin(p.yaw) * halfLength * t, pz = p.z + Math.cos(p.yaw) * halfLength * t;
      colliders.query(px - radius - 1, pz - radius - 1, px + radius + 1, pz + radius + 1, boxes);
      if (resolveCircleVsBoxes(px, pz, radius, boxes, 2.5, .6).hit) { clear = false; break; }
    }
    if (clear) return { x: p.x, z: p.z, yaw: p.yaw };
  }
  throw new Error('No clear road space is available for this vehicle.');
}
