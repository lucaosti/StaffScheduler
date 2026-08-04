/**
 * Point-in-polygon geofencing.
 *
 * Ray casting (even-odd rule): count how many times a ray cast from the point
 * eastward crosses the polygon's edges. An odd count means the point is
 * inside. Chosen over a library because the problem is a single well-known
 * ~15-line algorithm — the kind of dependency this codebase has consistently
 * preferred to own rather than pull in (see the CSV serializer, the rate
 * limiter). Coordinates are plain degrees; the polygon is treated as flat,
 * which is accurate enough at the scale of a single site or campus and avoids
 * pulling in a geodesic library for a problem that doesn't need one here.
 *
 * @author Luca Ostinelli
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Whether `point` lies inside `polygon` (a simple, non-self-intersecting
 * ring). Points exactly on an edge are treated as inside, on the (rare) side
 * of erring toward letting a borderline punch through rather than rejecting
 * one that was genuinely on-site.
 */
export function isPointInPolygon(point: GeoPoint, polygon: GeoPoint[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const vi = polygon[i];
    const vj = polygon[j];

    // A point exactly on an edge satisfies this crossing test as a boundary
    // case of floating-point equality more often than not; treated as inside
    // per the function's documented boundary behavior above.
    if (
      point.lat === vi.lat && point.lng === vi.lng
    ) {
      return true;
    }

    const crosses =
      vi.lng > point.lng !== vj.lng > point.lng &&
      point.lat < ((vj.lat - vi.lat) * (point.lng - vi.lng)) / (vj.lng - vi.lng) + vi.lat;

    if (crosses) inside = !inside;
  }
  return inside;
}

/** Whether `point` falls inside at least one of the given polygons. */
export function isPointInAnyPolygon(point: GeoPoint, polygons: GeoPoint[][]): boolean {
  return polygons.some((polygon) => isPointInPolygon(point, polygon));
}
