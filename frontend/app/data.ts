import pilotSnapshot from './pilot-sites.json';
export type Site = {
  surfaceTemperature?: number;
  polygons?: number[][][][];
  eligible?: boolean;
  id:string; name?:string; neighborhood?:string; latitude:number; longitude:number;
  priority_score:number|null; canopy_coverage:number|null; heat_score:number|null;
  verification_status?:string; source?:string;
};
const rows = [
  ['Roosevelt Park corridor','Five Wounds',37.3476,-121.8699,94,8,96],
  ['Mayfair neighborhood edge','Mayfair',37.350,-121.842,91,9,94],
  ['East Santa Clara corridor','Downtown East',37.342,-121.878,87,12,90],
  ['Anne Darling corridor','Northside',37.362,-121.857,83,13,88],
  ['Spartan Keyes corridor','Spartan Keyes',37.322,-121.875,82,12,84],
  ['Kelley Park approach','Central San José',37.328,-121.852,76,18,81],
  ['Japantown east edge','Japantown',37.354,-121.889,73,22,77],
  ['Washington neighborhood edge','Washington',37.320,-121.891,70,23,76],
  ['Little Portugal corridor','Little Portugal',37.352,-121.861,69,20,74],
  ['Naglee Park corridor','Naglee Park',37.335,-121.872,61,29,64],
  ['Guadalupe River approach','Downtown West',37.341,-121.901,58,33,61],
  ['Olinder neighborhood edge','Olinder',37.336,-121.853,54,35,58],
] as const;
export const demoSites:Site[] = rows.map(([name,neighborhood,latitude,longitude,priority_score,canopy_coverage,heat_score], i) =>
  ({id:'DEMO-'+String(i+1).padStart(2,'0'),name,neighborhood,latitude,longitude,priority_score,canopy_coverage,heat_score,verification_status:'needs_verification'}));
export const pilot = process.env.NEXT_PUBLIC_DATA_MODE === 'pilot';
export const pilotSites: Site[] = pilotSnapshot;
export const live = process.env.NEXT_PUBLIC_DATA_MODE === 'live';
export const label = (s:Site) => s.name || s.id;
export const tier = (s:Site) => s.priority_score == null ? 'Unranked' : s.priority_score >= 80 ? 'High' : s.priority_score >= 65 ? 'Moderate' : 'Lower';
export const checklist = ['Confirm property ownership and permission','Check underground and overhead utilities','Verify root space, sidewalk access, and visibility','Confirm species, watering, and maintenance with local partners'];
async function request(path:string, signal?:AbortSignal, body?:object) {
  const headers = new Headers();
  if (body) headers.set('Content-Type', 'application/json');
  const res = await fetch(path.replace(/^\/api\//, '/api/atlas/'), {signal, cache:'no-store', headers, ...(body && {method:'POST', body:JSON.stringify(body)})});
  if (!res.ok) throw new Error('Request failed');
  return res;
}
const score = (v:unknown):v is number => typeof v==='number' && Number.isFinite(v) && v>=0 && v<=100;
function isSite(v:unknown):v is Site {
  if (!v || typeof v!=='object') return false;
  const s=v as Site;
  return typeof s.id==='string' && typeof s.latitude==='number' && Math.abs(s.latitude)<=90 &&
    typeof s.longitude==='number' && Math.abs(s.longitude)<=180 && (s.priority_score === null || score(s.priority_score)) &&
    (s.canopy_coverage===null || score(s.canopy_coverage)) && (s.heat_score===null || score(s.heat_score)) &&
    [s.name,s.neighborhood,s.verification_status,s.source].every(t=>t===undefined || typeof t==='string');
}
export async function getSites(signal:AbortSignal, area: string) {
  const sites: Site[] = [];
  let offset = 0;
  for (;;) {
    const query = new URLSearchParams({ limit: '20', include_geometry: 'true', offset: String(offset),
      study_area: area });
    const page = await (await request('/api/sites?' + query, signal)).json();
    if (!Array.isArray(page.data) || page.data_mode !== 'supabase') throw new Error('Expected Supabase site data');
    for (const row of page.data) {
      const geometry = row.screening_geometry ?? row.geometry;
      const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : undefined;
      if (!polygons?.length) continue;
      let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
      let invalid = false;
      for (const polygon of polygons) {
        for (const ring of polygon) {
          for (const point of ring) {
            const [longitude, latitude] = point;
            if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
                Math.abs(longitude) > 180 || Math.abs(latitude) > 90) {
              invalid = true;
              break;
            }
            west = Math.min(west, longitude);
            south = Math.min(south, latitude);
            east = Math.max(east, longitude);
            north = Math.max(north, latitude);
          }
          if (invalid) break;
        }
        if (invalid) break;
      }
      if (invalid || !Number.isFinite(west)) continue;
      const site: Site = {
        id: row.id, name: row.name, neighborhood: row.study_area,
        latitude: (south + north) / 2,
        longitude: (west + east) / 2,
        surfaceTemperature: typeof row.surface_temperature_c === 'number' ? row.surface_temperature_c : undefined,
        polygons, eligible: row.eligible, priority_score: row.priority_score,
        canopy_coverage: row.canopy_coverage == null ? null : row.canopy_coverage * 100,
        heat_score: row.heat_score == null ? null : row.heat_score * 100,
        verification_status: row.verification_status ?? undefined,
        source: typeof row.data_source === 'string' ? row.data_source : undefined,
      };
      if (!isSite(site)) throw new Error('Invalid site data');
      sites.push(site);
    }
    if (page.next_offset == null) return sites;
    if (!Number.isInteger(page.next_offset) || page.next_offset <= offset) throw new Error('Invalid pagination');
    offset = page.next_offset;
  }
}
export async function explainSite(site:Site,signal:AbortSignal) {
  if (pilot) return `The city inventory lists this location as a candidate. The surrounding census block had ${site.canopy_coverage}% tree canopy in 2020, and the modeled heat island score was ${site.heat_score}/100. These area estimates help prioritize field review.`;
  if (!live) return `This sample corridor ranks ${tier(site).toLowerCase()} for review. Its illustrative heat score is ${site.heat_score}/100 and canopy coverage is ${site.canopy_coverage}%. These values show how the interface explains ranking factors. A field visit would be needed to establish feasibility.`;
  const data = await (await request('/api/explain',signal,{site_id:site.id})).json();
  if (typeof data?.data?.summary !== 'string' || !data.data.summary.trim()) throw new Error('Missing explanation');
  return data.data.summary as string;
}
export async function proposalPdf(name:string, sites:Site[],signal:AbortSignal) {
  const created = await (await request('/api/proposals', signal, { project_name: name, selected_site_ids: sites.map(site => site.id) })).json();
  if (typeof created?.data?.id !== 'string') throw new Error('Missing proposal ID');
  const response = await request('/api/proposals/' + encodeURIComponent(created.data.id) + '/pdf', signal);
  if (!response.headers.get('content-type')?.includes('application/pdf')) throw new Error('Expected a PDF');
  return response.blob();
}
