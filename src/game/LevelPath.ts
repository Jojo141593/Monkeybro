/**
 * Winding orchard trails with intersecting orchard clearings and courtyard side loops. Each individual trail
 * uses z = −t; shared stations make the forks reconnect without dead ends.
 */
export const PATH_LENGTH = 380;
export const CORRIDOR_HALF_WIDTH = 11;
export const ZONE_STARTS = [0, 125, 255] as const;
export const ZONE_NAMES = ['外园 · 月下桃径', '雾林 · 薄纱迷径', '园心 · 母树高枝'] as const;
export const ZONE_GLYPHS = ['外园', '雾林', '园心'] as const;

export function pathX(t: number): number {
  // Central trail; the side routes below split off and rejoin around the groves.
  // Cosines keep the entry tangent straight and the tightest bend wider than the trail.
  return 18 * (1 - Math.cos(t * 0.047)) + 4 * (1 - Math.cos(t * 0.094));
}

export function pathSlope(t: number): number {
  return 18 * 0.047 * Math.sin(t * 0.047) + 4 * 0.094 * Math.sin(t * 0.094);
}

export interface TrailRoute {
  id: string;
  start: number;
  end: number;
  offset: number;
}

export const TRAIL_HALF_WIDTH = 1.05;
export const TRAIL_TREE_STATIONS = [24, 58, 112, 166, 237, 286, 354] as const;
export const TRAIL_ROUTES: readonly TrailRoute[] = [
  { id: 'main', start: -12, end: PATH_LENGTH + 12, offset: 0 },
  { id: 'entry-garden', start: 12, end: 66, offset: -10 },
  { id: 'east-grove', start: 32, end: 98, offset: 10 },
  { id: 'west-court', start: 78, end: 150, offset: -11 },
  { id: 'mist-loop', start: 138, end: 218, offset: -12 },
  { id: 'east-court', start: 200, end: 284, offset: 12 },
  { id: 'mother-tree-loop', start: 266, end: 344, offset: 11 },
];

export function routeX(t: number, route: TrailRoute): number {
  const u = Math.max(0, Math.min(1, (t - route.start) / (route.end - route.start)));
  return pathX(t) + route.offset * Math.sin(Math.PI * u) ** 2;
}

export function routeSlope(t: number, route: TrailRoute): number {
  if (t <= route.start || t >= route.end) return pathSlope(t);
  const span = route.end - route.start;
  return pathSlope(t) + route.offset * Math.PI / span * Math.sin(2 * Math.PI * (t - route.start) / span);
}

/** Approximate distance to the nearest unmarked navigation clearing, including the side loops. */
export function distanceToTrail(x: number, z: number): number {
  const t = -z;
  let distance = Infinity;
  for (const route of TRAIL_ROUTES) {
    if (t < route.start || t > route.end) continue;
    distance = Math.min(distance, Math.abs(x - routeX(t, route)) / Math.hypot(1, routeSlope(t, route)));
  }
  return distance;
}

export function zoneAt(t: number): number {
  if (t >= ZONE_STARTS[2]) return 2;
  if (t >= ZONE_STARTS[1]) return 1;
  return 0;
}

/** Signed horizontal-perpendicular offset of (x,z) from the trail centerline. */
export function lateralOffset(x: number, z: number): number {
  const t = -z;
  const s = pathSlope(t);
  return (x - pathX(t)) / Math.sqrt(1 + s * s);
}

/** Clamp a point into the corridor (and between the start and end walls). */
export function clampToCorridor(p: { x: number; z: number }, margin = 0, extraWidth = 0): void {
  if (p.z > 6) p.z = 6;
  if (p.z < -(PATH_LENGTH + 8)) p.z = -(PATH_LENGTH + 8);
  const t = -p.z;
  const s = pathSlope(t);
  const k = Math.sqrt(1 + s * s);
  const limit = (CORRIDOR_HALF_WIDTH + extraWidth - margin) * k;
  let left = pathX(t);
  let right = left;
  for (const route of TRAIL_ROUTES) {
    if (t < route.start || t > route.end) continue;
    const x = routeX(t, route);
    left = Math.min(left, x);
    right = Math.max(right, x);
  }
  p.x = Math.max(left - limit, Math.min(right + limit, p.x));
}

export interface Circle {
  x: number;
  z: number;
  r: number;
  /** Tree trunks block harvest line of sight. Rocks and shrines do not. */
  sight?: boolean;
  /** Continuous architecture walls need global detours rather than trunk repulsion. */
  wall?: boolean;
}

/** Uniform grid of static circle colliders (tree trunks, rocks, pillars). */
export class ColliderGrid {
  private readonly cell = 4;
  private readonly cells = new Map<number, Circle[]>();

  private key(ix: number, iz: number): number {
    return (ix + 512) * 4096 + (iz + 2048);
  }

  add(c: Circle): void {
    const ix = Math.floor(c.x / this.cell);
    const iz = Math.floor(c.z / this.cell);
    const k = this.key(ix, iz);
    let list = this.cells.get(k);
    if (!list) {
      list = [];
      this.cells.set(k, list);
    }
    list.push(c);
  }

  clear(): void {
    this.cells.clear();
  }

  /** Push p out of any collider overlapping a circle of radius r. */
  resolve(p: { x: number; z: number }, r: number): boolean {
    const ix = Math.floor(p.x / this.cell);
    const iz = Math.floor(p.z / this.cell);
    let hit = false;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.cells.get(this.key(ix + dx, iz + dz));
        if (!list) continue;
        for (const c of list) {
          const ex = p.x - c.x;
          const ez = p.z - c.z;
          const min = c.r + r;
          const d2 = ex * ex + ez * ez;
          if (d2 < min * min) {
            if (d2 <= 1e-8) {
              p.x += min;
              hit = true;
              continue;
            }
            const d = Math.sqrt(d2);
            const push = (min - d) / d;
            p.x += ex * push;
            p.z += ez * push;
            hit = true;
          }
        }
      }
    }
    return hit;
  }

  /** Steering helper: sum of repulsion vectors from nearby colliders. */
  avoid(x: number, z: number, radius: number, out: { x: number; z: number }, includeWalls = true): void {
    out.x = 0;
    out.z = 0;
    const ix = Math.floor(x / this.cell);
    const iz = Math.floor(z / this.cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.cells.get(this.key(ix + dx, iz + dz));
        if (!list) continue;
        for (const c of list) {
          if (!includeWalls && c.wall) continue;
          const ex = x - c.x;
          const ez = z - c.z;
          const d = Math.sqrt(ex * ex + ez * ez);
          const range = c.r + radius;
          if (d < range && d > 1e-4) {
            const w = (range - d) / range;
            out.x += (ex / d) * w;
            out.z += (ez / d) * w;
          }
        }
      }
    }
  }

  isFree(x: number, z: number, r: number): boolean {
    const p = { x, z };
    return !this.resolve(p, r);
  }

  /**
   * True when a sight-blocking circle (tree trunk) cuts the XZ segment.
   * The last `endSlack` metres are ignored so a peach beside its own trunk
   * can still be picked from up close.
   */
  blocksSegment(x0: number, z0: number, x1: number, z1: number, endSlack = 0.55): boolean {
    return this.segmentBlocked(x0, z0, x1, z1, endSlack, false, 0);
  }

  /** Swept body clearance against architecture only; trees retain local avoidance. */
  blocksWallSegment(x0: number, z0: number, x1: number, z1: number, clearance = 0): boolean {
    return this.segmentBlocked(x0, z0, x1, z1, 0, true, clearance);
  }

  /** Bounded 0.6m A*: only invoked by a cached monster route when a wall intervenes. */
  routeAroundWalls(from: { x: number; z: number }, target: { x: number; z: number }, radius: number): { x: number; z: number }[] {
    const step = 0.6;
    const clearance = radius + 0.08;
    const x0 = Math.floor((Math.min(from.x, target.x) - 11) / step) * step;
    const z0 = Math.floor((Math.min(from.z, target.z) - 11) / step) * step;
    const width = Math.ceil((Math.max(from.x, target.x) + 11 - x0) / step) + 1;
    const height = Math.ceil((Math.max(from.z, target.z) + 11 - z0) / step) + 1;
    if (width * height > 12000) return [];
    const points = new Map<number, { x: number; z: number }>();
    const point = (id: number): { x: number; z: number } => {
      let p = points.get(id);
      if (!p) { p = { x: x0 + (id % width) * step, z: z0 + Math.floor(id / width) * step }; points.set(id, p); }
      return p;
    };
    // Connect to a nearby lattice node without crossing a wall (rounding alone can put it inside plaster).
    const nearest = (p: { x: number; z: number }): number => {
      const ix = Math.round((p.x - x0) / step), iz = Math.round((p.z - z0) / step);
      let best = -1, distance = Infinity;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const x = ix + dx, z = iz + dz;
        if (x < 0 || z < 0 || x >= width || z >= height) continue;
        const id = z * width + x, q = point(id), d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < distance && !this.blocksWallSegment(p.x, p.z, q.x, q.z, clearance)) { best = id; distance = d; }
      }
      return best;
    };
    const start = nearest(from), goal = nearest(target);
    if (start < 0 || goal < 0) return [];
    const scores = new Map<number, number>([[start, 0]]), previous = new Map<number, number>();
    const closed = new Set<number>();
    const heap: { id: number; f: number }[] = [];
    const push = (id: number, f: number): void => {
      const item = { id, f }; heap.push(item);
      let i = heap.length - 1;
      while (i > 0) { const parent = (i - 1) >> 1; if (heap[parent].f <= f) break; heap[i] = heap[parent]; i = parent; }
      heap[i] = item;
    };
    const pop = (): number => {
      const first = heap[0], last = heap.pop()!;
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (child + 1 < heap.length && heap[child + 1].f < heap[child].f) child++;
          if (heap[child].f >= last.f) break;
          heap[i] = heap[child]; i = child;
        }
        heap[i] = last;
      }
      return first.id;
    };
    const heuristic = (id: number): number => Math.hypot(point(id).x - point(goal).x, point(id).z - point(goal).z);
    push(start, heuristic(start));
    while (heap.length && closed.size < 6000) {
      const id = pop();
      if (closed.has(id)) continue;
      if (id === goal) {
        const result = [{ x: target.x, z: target.z }];
        let k = goal;
        while (k !== start) { result.push(point(k)); k = previous.get(k)!; }
        result.push(point(start));
        return result.reverse();
      }
      closed.add(id);
      const p = point(id), ix = id % width, iz = Math.floor(id / width);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dz) || ix + dx < 0 || ix + dx >= width || iz + dz < 0 || iz + dz >= height) continue;
        const next = id + dz * width + dx;
        if (closed.has(next)) continue;
        const q = point(next), cost = scores.get(id)! + Math.hypot(dx, dz) * step;
        if (cost >= (scores.get(next) ?? Infinity) || this.blocksWallSegment(p.x, p.z, q.x, q.z, clearance)) continue;
        scores.set(next, cost); previous.set(next, id); push(next, cost + heuristic(next));
      }
    }
    return [];
  }

  private segmentBlocked(x0: number, z0: number, x1: number, z1: number, endSlack: number, wallsOnly: boolean, clearance: number): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const keep = Math.max(0, len - endSlack);
    const x2 = len > 1e-4 ? x0 + (dx / len) * keep : x0;
    const z2 = len > 1e-4 ? z0 + (dz / len) * keep : z0;
    const minX = Math.min(x0, x2);
    const maxX = Math.max(x0, x2);
    const minZ = Math.min(z0, z2);
    const maxZ = Math.max(z0, z2);
    const ix0 = Math.floor(minX / this.cell) - 1;
    const ix1 = Math.floor(maxX / this.cell) + 1;
    const iz0 = Math.floor(minZ / this.cell) - 1;
    const iz1 = Math.floor(maxZ / this.cell) + 1;
    const sdx = x2 - x0;
    const sdz = z2 - z0;
    const len2 = sdx * sdx + sdz * sdz;
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = this.cells.get(this.key(ix, iz));
        if (!list) continue;
        for (const c of list) {
          if (wallsOnly ? !c.wall : !c.sight) continue;
          let t = 0;
          if (len2 > 1e-8) t = ((c.x - x0) * sdx + (c.z - z0) * sdz) / len2;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const ex = x0 + sdx * t - c.x;
          const ez = z0 + sdz * t - c.z;
          if (ex * ex + ez * ez < (c.r + clearance) ** 2) return true;
        }
      }
    }
    return false;
  }
}
