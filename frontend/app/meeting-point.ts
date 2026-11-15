export type MeetingPoint = { siteId: string; name: string; latitude: number; longitude: number };

export function readMeeting(value: unknown): MeetingPoint | null {
  if (!value || typeof value !== 'object') return null;
  const { siteId, name, latitude, longitude } = value as Partial<MeetingPoint>;
  if (typeof siteId !== 'string' || typeof name !== 'string' || !name.trim() || name.trim().length > 100 ||
      typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return null;
  return { siteId, name: name.trim(), latitude, longitude };
}

export function containsPoint(polygons: number[][][][], latitude: number, longitude: number) {
  function insideRing(ring: number[][]) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x, y] = ring[i], [previousX, previousY] = ring[j];
      if ((y > latitude) !== (previousY > latitude) &&
          longitude < (previousX - x) * (latitude - y) / (previousY - y) + x) inside = !inside;
    }
    return inside;
  }
  return polygons.some(([outer, ...holes]) => outer && insideRing(outer) && !holes.some(insideRing));
}

export const meetingDirections = ({ latitude, longitude }: MeetingPoint) =>
  'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(latitude + ',' + longitude);
