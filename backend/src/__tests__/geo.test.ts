/**
 * Point-in-polygon geofencing tests.
 */

export {};

import { isPointInPolygon, isPointInAnyPolygon, GeoPoint } from '../utils/geo';

// A 1-degree square, roughly centered on the equator/prime-meridian corner —
// values chosen for readable test data, not real-world coordinates.
const square: GeoPoint[] = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 1 },
  { lat: 1, lng: 1 },
  { lat: 1, lng: 0 },
];

describe('isPointInPolygon', () => {
  it('reports a point in the interior as inside', () => {
    expect(isPointInPolygon({ lat: 0.5, lng: 0.5 }, square)).toBe(true);
  });

  it('reports a point clearly outside as outside', () => {
    expect(isPointInPolygon({ lat: 5, lng: 5 }, square)).toBe(false);
  });

  it('reports a point outside on the same latitude band as outside', () => {
    expect(isPointInPolygon({ lat: 0.5, lng: 5 }, square)).toBe(false);
  });

  it('treats a vertex as inside', () => {
    expect(isPointInPolygon({ lat: 0, lng: 0 }, square)).toBe(true);
  });

  it('returns false for a degenerate polygon (fewer than 3 points)', () => {
    expect(isPointInPolygon({ lat: 0.5, lng: 0.5 }, [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }])).toBe(false);
  });

  it('handles a non-convex (L-shaped) polygon correctly', () => {
    const lShape: GeoPoint[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 2 },
      { lat: 1, lng: 2 },
      { lat: 1, lng: 1 },
      { lat: 2, lng: 1 },
      { lat: 2, lng: 0 },
    ];
    // Inside the "notch" cut out of the L — must be outside.
    expect(isPointInPolygon({ lat: 1.5, lng: 1.5 }, lShape)).toBe(false);
    // Inside the leg of the L.
    expect(isPointInPolygon({ lat: 0.5, lng: 1.5 }, lShape)).toBe(true);
  });
});

describe('isPointInAnyPolygon', () => {
  const other: GeoPoint[] = [
    { lat: 10, lng: 10 },
    { lat: 10, lng: 11 },
    { lat: 11, lng: 11 },
    { lat: 11, lng: 10 },
  ];

  it('is true when the point is inside at least one polygon', () => {
    expect(isPointInAnyPolygon({ lat: 10.5, lng: 10.5 }, [square, other])).toBe(true);
  });

  it('is false when the point is inside none of the polygons', () => {
    expect(isPointInAnyPolygon({ lat: 50, lng: 50 }, [square, other])).toBe(false);
  });

  it('is false for an empty polygon list', () => {
    expect(isPointInAnyPolygon({ lat: 0.5, lng: 0.5 }, [])).toBe(false);
  });
});
