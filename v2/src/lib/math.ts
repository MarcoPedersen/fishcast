/** Shared numeric helpers. */
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Great-circle distance in km between two lat/lon points. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371, d1 = (lat2 - lat1) * Math.PI / 180, d2 = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(d1 / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(d2 / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}
