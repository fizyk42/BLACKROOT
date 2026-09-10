// The layout of San Aurelio as pure data — no rendering imports, so it can be
// unit-tested in Node (see tools/verify.js) and reused by the server if needed.

export const CITY = {
  PITCH: 88,          // metres between intersection centres
  CELLS: 12,          // 12 x 12 intersections -> 968 m of detailed grid
  ROAD_HALF: 9,       // asphalt half-width (18 m carriageway)
  KERB_HALF: 12.5,    // outer edge of the pavement
  LANE_OFFSETS: [2.7, 6.3], // centre of each lane, measured right of the centreline
  BLOCK_HALF: 31.5,   // buildable half-size of a block interior
  LIGHT_CYCLE: 21,    // seconds for a full traffic-light cycle
};

export const WORLD = {
  // The detailed district sits inside a much larger planned footprint.
  // Milestone 1 builds the grid; the outer ring is terrain + roads only.
  minX: -260, maxX: CITY.PITCH * (CITY.CELLS - 1) + 300,
  minZ: -260, maxZ: CITY.PITCH * (CITY.CELLS - 1) + 300,
  shoreX: -70,        // sand starts here, ocean further west
  oceanX: -170,
  hillsX: CITY.PITCH * (CITY.CELLS - 1) + 120,
};

export const DISTRICTS = {
  coast: { name: 'Sunset Reach', colour: '#3f6f7a' },
  downtown: { name: 'Downtown San Aurelio', colour: '#4a5560' },
  midtown: { name: 'Verdugo Row', colour: '#57544a' },
  residential: { name: 'Palm Hollow', colour: '#4d5c42' },
  industrial: { name: 'Kestrel Docks', colour: '#5a5148' },
  hills: { name: 'Aurelio Heights', colour: '#4c5a45' },
};

export function districtAt(i, j) {
  if (i <= 1) return 'coast';
  if (i <= 4) return j >= 3 && j <= 8 ? 'downtown' : 'midtown';
  if (i <= 7) return 'residential';
  return j >= 7 ? 'hills' : 'industrial';
}

/** District at a world position (used by the HUD street readout). */
export function districtAtWorld(x, z) {
  const i = Math.round(x / CITY.PITCH), j = Math.round(z / CITY.PITCH);
  if (x < WORLD.shoreX) return 'coast';
  if (x > CITY.PITCH * (CITY.CELLS - 1) + 40) return 'hills';
  return districtAt(clampCell(i), clampCell(j));
}

const clampCell = (v) => Math.max(0, Math.min(CITY.CELLS - 1, v));

export const STREET_NAMES_NS = [
  'Ocean Walk', 'Marisol Ave', 'Calle Verde', 'Aurelio Blvd', 'Foundry St',
  'Palm Hollow Rd', 'Sable Ave', 'Kestrel Way', 'Dockside Rd', 'Ridge Line',
  'Copperfield Ave', 'East Rim Rd',
];
export const STREET_NAMES_EW = [
  'North Point', 'Hazel St', 'Linnet St', '7th Street', '8th Street',
  'Vega Street', 'Juniper St', 'Alder St', 'Cypress St', 'Salt Flat Rd',
  'Harbor Cut', 'South Gate',
];

export function streetNameAt(x, z) {
  const i = clampCell(Math.round(x / CITY.PITCH));
  const j = clampCell(Math.round(z / CITY.PITCH));
  const dx = Math.abs(x - i * CITY.PITCH), dz = Math.abs(z - j * CITY.PITCH);
  return dx < dz ? STREET_NAMES_NS[i] : STREET_NAMES_EW[j];
}

export const nodeX = (i) => i * CITY.PITCH;
export const nodeZ = (j) => j * CITY.PITCH;

/** True when the point is on the carriageway (used for spawning and off-road detection). */
export function isOnRoad(x, z) {
  const nx = Math.abs(x - Math.round(x / CITY.PITCH) * CITY.PITCH);
  const nz = Math.abs(z - Math.round(z / CITY.PITCH) * CITY.PITCH);
  const inX = x >= -CITY.ROAD_HALF && x <= nodeX(CITY.CELLS - 1) + CITY.ROAD_HALF;
  const inZ = z >= -CITY.ROAD_HALF && z <= nodeZ(CITY.CELLS - 1) + CITY.ROAD_HALF;
  return (nx <= CITY.ROAD_HALF && inZ) || (nz <= CITY.ROAD_HALF && inX);
}

export function isOnPavement(x, z) {
  if (isOnRoad(x, z)) return false;
  const nx = Math.abs(x - Math.round(x / CITY.PITCH) * CITY.PITCH);
  const nz = Math.abs(z - Math.round(z / CITY.PITCH) * CITY.PITCH);
  return (nx > CITY.ROAD_HALF && nx <= CITY.KERB_HALF) || (nz > CITY.ROAD_HALF && nz <= CITY.KERB_HALF);
}

/**
 * Directed lane graph. Each intersection has 4 approaches; traffic keeps right,
 * so an edge from A to B is offset to the right of the A->B direction.
 */
export class RoadGraph {
  constructor() {
    this.nodes = [];
    this.index = new Map();
    for (let i = 0; i < CITY.CELLS; i++) {
      for (let j = 0; j < CITY.CELLS; j++) {
        const id = this.nodes.length;
        this.nodes.push({ id, i, j, x: nodeX(i), z: nodeZ(j), out: [], district: districtAt(i, j) });
        this.index.set(i * 1000 + j, id);
      }
    }
    this.edges = [];
    for (const n of this.nodes) {
      const neigh = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [di, dj] of neigh) {
        const id = this.index.get((n.i + di) * 1000 + (n.j + dj));
        if (id === undefined) continue;
        const b = this.nodes[id];
        const e = {
          id: this.edges.length, a: n.id, b: id,
          dx: Math.sign(b.x - n.x), dz: Math.sign(b.z - n.z),
          length: Math.hypot(b.x - n.x, b.z - n.z),
          axis: di !== 0 ? 'x' : 'z',
        };
        this.edges.push(e);
        n.out.push(e.id);
      }
    }
  }

  node(i, j) {
    const id = this.index.get(i * 1000 + j);
    return id === undefined ? null : this.nodes[id];
  }

  /** Point on a lane along edge `e` at parameter t (0..1), for lane index 0 (inner) or 1 (kerb). */
  lanePoint(e, t, lane = 0, out = { x: 0, z: 0 }) {
    const a = this.nodes[e.a], b = this.nodes[e.b];
    const off = CITY.LANE_OFFSETS[lane] ?? CITY.LANE_OFFSETS[0];
    // Right-hand side of the travel direction.
    const rx = -e.dz, rz = e.dx;
    out.x = a.x + (b.x - a.x) * t + rx * off;
    out.z = a.z + (b.z - a.z) * t + rz * off;
    return out;
  }

  edgeHeading(e) { return Math.atan2(e.dx, e.dz); }

  /** Edges leaving node `id`, optionally excluding a U-turn back down `fromEdge`. */
  exits(id, fromEdge) {
    const n = this.nodes[id];
    const list = [];
    for (const eid of n.out) {
      const e = this.edges[eid];
      if (fromEdge && e.b === fromEdge.a) continue; // no U-turns
      list.push(e);
    }
    return list.length ? list : n.out.map((eid) => this.edges[eid]);
  }

  /** Nearest node to a world position. */
  nearestNode(x, z) {
    const i = Math.max(0, Math.min(CITY.CELLS - 1, Math.round(x / CITY.PITCH)));
    const j = Math.max(0, Math.min(CITY.CELLS - 1, Math.round(z / CITY.PITCH)));
    return this.node(i, j);
  }

  /** A* over the grid; returns an array of node ids. Used for GPS routing and police. */
  findPath(fromId, toId) {
    if (fromId === toId) return [fromId];
    const N = this.nodes.length;
    const g = new Float32Array(N).fill(Infinity);
    const f = new Float32Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const open = [fromId];
    const inOpen = new Uint8Array(N);
    const closed = new Uint8Array(N);
    const goal = this.nodes[toId];
    const h = (n) => Math.abs(n.x - goal.x) + Math.abs(n.z - goal.z);
    g[fromId] = 0; f[fromId] = h(this.nodes[fromId]); inOpen[fromId] = 1;

    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
      const cur = open.splice(bi, 1)[0];
      inOpen[cur] = 0;
      if (cur === toId) {
        const out = [];
        let c = cur;
        while (c !== -1) { out.push(c); c = prev[c]; }
        return out.reverse();
      }
      closed[cur] = 1;
      for (const eid of this.nodes[cur].out) {
        const e = this.edges[eid];
        if (closed[e.b]) continue;
        const t = g[cur] + e.length;
        if (t < g[e.b]) {
          g[e.b] = t; prev[e.b] = cur; f[e.b] = t + h(this.nodes[e.b]);
          if (!inOpen[e.b]) { open.push(e.b); inOpen[e.b] = 1; }
        }
      }
    }
    return null;
  }

  /** Convert a node path into world-space waypoints hugging the correct lane. */
  pathToWaypoints(path, lane = 0) {
    const pts = [];
    for (let k = 0; k < path.length - 1; k++) {
      const a = this.nodes[path[k]], b = this.nodes[path[k + 1]];
      const e = this.edges.find((x) => x.a === a.id && x.b === b.id);
      if (!e) continue;
      pts.push(this.lanePoint(e, 0.08, lane, {}));
      pts.push(this.lanePoint(e, 0.92, lane, {}));
    }
    return pts;
  }

  /**
   * Traffic-light state at an intersection.
   * Alternating intersections start on the opposite phase so the grid feels alive.
   */
  lightFor(node, timeSeconds) {
    const cycle = CITY.LIGHT_CYCLE;
    const skew = ((node.i + node.j) % 2) * (cycle / 2);
    const t = (timeSeconds + skew) % cycle;
    // 0..9 north-south green, 9..10.5 amber, 10.5..19.5 east-west green, 19.5..21 amber
    if (t < 9) return { z: 'green', x: 'red' };
    if (t < 10.5) return { z: 'amber', x: 'red' };
    if (t < 19.5) return { z: 'red', x: 'green' };
    return { z: 'red', x: 'amber' };
  }

  /** May a vehicle travelling along `edge` proceed through node `edge.b`? */
  canProceed(edge, timeSeconds) {
    const l = this.lightFor(this.nodes[edge.b], timeSeconds);
    return l[edge.axis] === 'green';
  }
}

// ------------------------------------------------------------------ points of interest
// Positions are on block frontages so doors face the pavement.

const P = CITY.PITCH;

export const POIS = [
  { id: 'vega_shop', kind: 'garage', name: 'Vega & Daughter Auto', x: P * 5 + 20, z: P * 4 - 20, ry: Math.PI, sign: 'VEGA & DAUGHTER', sub: 'auto repair · since 1994', story: true },
  { id: 'apartment_1', kind: 'safehouse', name: 'Linnet Street Studio', x: P * 5 - 22, z: P * 2 + 20, ry: 0, price: 0, sign: 'LINNET ARMS', sub: 'apartments' },
  { id: 'apartment_2', kind: 'safehouse', name: 'Marisol Loft', x: P * 2 + 22, z: P * 6 - 20, ry: Math.PI, price: 42000, sign: 'MARISOL LOFTS' },
  { id: 'house_hills', kind: 'safehouse', name: 'Ridge Line House', x: P * 9 + 20, z: P * 9 - 22, ry: Math.PI, price: 185000, sign: 'RIDGE LINE' },
  { id: 'dealer', kind: 'dealer', name: 'Coastline Motors', x: P * 3 - 22, z: P * 2 + 22, ry: 0, sign: 'COASTLINE MOTORS', sub: 'used · financed · driven' },
  { id: 'clothes', kind: 'clothing', name: 'Tidewater Outfitters', x: P * 4 + 22, z: P * 5 + 20, ry: Math.PI, sign: 'TIDEWATER', sub: 'outfitters' },
  { id: 'tuner', kind: 'tuning', name: "Park's Performance", x: P * 6 - 22, z: P * 7 + 20, ry: 0, sign: "PARK'S PERFORMANCE", sub: 'tuning · paint · parts' },
  { id: 'diner', kind: 'food', name: 'The Afterhours Diner', x: P * 1 + 22, z: P * 5 - 20, ry: Math.PI, sign: 'AFTERHOURS', sub: 'open all night' },
  { id: 'depot', kind: 'jobboard', name: 'Kestrel Freight Depot', x: P * 9 - 24, z: P * 3 + 22, ry: 0, sign: 'KESTREL FREIGHT', sub: 'courier dispatch' },
  { id: 'taxi_office', kind: 'jobboard', name: 'Sunline Rides', x: P * 2 - 22, z: P * 8 + 20, ry: 0, sign: 'SUNLINE RIDES' },
  { id: 'racehub', kind: 'racehub', name: 'The Pier Lot', x: P * 0 + 24, z: P * 9 + 22, ry: Math.PI, sign: 'PIER PARKING', sub: 'lot 4' },
  { id: 'police', kind: 'police', name: 'San Aurelio PD — Central', x: P * 4 - 24, z: P * 8 + 22, ry: 0, sign: 'SAN AURELIO PD' },
  { id: 'hospital', kind: 'hospital', name: 'St. Marisol Medical', x: P * 6 + 24, z: P * 2 - 22, ry: Math.PI, sign: 'ST. MARISOL', sub: 'medical center' },
  { id: 'sloane_tower', kind: 'story', name: 'Sloane Development Group', x: P * 3 + 24, z: P * 6 + 22, ry: Math.PI, sign: 'SLOANE', sub: 'development group' },
  { id: 'pier', kind: 'landmark', name: 'Aurelio Pier', x: -110, z: P * 6, ry: 0, sign: 'AURELIO PIER' },
  { id: 'impound', kind: 'garage', name: 'City Impound', x: P * 8 + 24, z: P * 1 + 22, ry: Math.PI, sign: 'CITY IMPOUND' },
];

export function poi(id) { return POIS.find((p) => p.id === id); }

/** Deterministic collectible placements (film canisters left around town). */
export function collectibleSpots(count = 20) {
  const out = [];
  let s = 1337;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  while (out.length < count) {
    const i = Math.floor(rnd() * CITY.CELLS);
    const j = Math.floor(rnd() * CITY.CELLS);
    const x = nodeX(i) + (rnd() - 0.5) * 2 * (CITY.KERB_HALF - 2);
    const z = nodeZ(j) + (rnd() - 0.5) * 2 * (CITY.KERB_HALF - 2);
    if (!isOnPavement(x, z)) continue;
    if (out.some((p) => Math.hypot(p.x - x, p.z - z) < 90)) continue;
    out.push({ id: 'reel_' + out.length, x, z, index: out.length });
  }
  return out;
}
