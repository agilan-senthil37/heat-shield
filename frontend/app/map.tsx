'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, ArrowUpRight, MapPin, Minus, Plus, Layers2, X, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import {label,landCoverExplanation,live,pilot,tier,tractId,type Site} from './data';

import { containsPoint, meetingDirections, type MeetingPoint } from './meeting-point';

type MapView = 'street' | 'satellite' | 'heat' | 'vegetation';

function point(lat:number,lng:number,z:number){
  const sin=Math.sin(Math.max(-85.05,Math.min(85.05,lat))*Math.PI/180), scale=256*2**z;
  return [(lng+180)/360*scale,(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*scale];
}
type Camera = { x: number; y: number; z: number };

function fitArea(sites: Site[], width: number, height: number): Camera {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  function extend(lat: number, lng: number) {
    const [x, y] = point(lat, lng, 0);
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  for (const site of sites) {
    extend(site.latitude, site.longitude);
    for (const polygon of site.polygons ?? []) {
      for (const ring of polygon) for (const [lng, lat] of ring) extend(lat, lng);
    }
  }
  if (!Number.isFinite(left)) {
    const [x, y] = point(37.344, -121.872, 0);
    return { x, y, z: 12 };
  }
  const scale = Math.min(Math.max(100, width - 100) / (right - left), Math.max(100, height - 120) / (bottom - top));
  return { x: (left + right) / 2, y: (top + bottom) / 2, z: Math.max(8, Math.min(14, Math.floor(Math.log2(scale)))) };
}

export default function SiteMap({ sites, areaSites, selected, onSelect, onShortlist, shortlisted, meeting, onMeeting }: {
  sites: Site[];
  areaSites: Site[];
  selected?: Site;
  onSelect: (id: string) => void;
  onShortlist: (site: Site) => void;
  shortlisted: string[];
  meeting?: MeetingPoint;
  onMeeting: (point: MeetingPoint, invite: boolean) => void;
}){
  const [view, setView] = useState<MapView>('street');
  const map = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 900, height: 520 });
  const [camera, setCamera] = useState<Camera>();
  useEffect(() => {
    const el = map.current;
    if (!el) return;
    const observer = new ResizeObserver(([{ contentRect }]) => {
      if (contentRect.width && contentRect.height) setSize({ width: contentRect.width, height: contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const overview = useMemo(() => fitArea(areaSites, size.width, size.height), [areaSites, size.width, size.height]);
  const [pickFor, setPickFor] = useState<string>();
  const [spot, setSpot] = useState<{ latitude: number; longitude: number }>();
  const [meetingError, setMeetingError] = useState('');
  const picking = !!selected && pickFor === selected.id;
  const [closedId, setClosedId] = useState<string>();
  const overlay = view === 'heat' || view === 'vegetation';
  const basemap = view === 'satellite' ? 'satellite' : 'street';
  const layer = view === 'heat' ? (live ? 'Satellite ground temperature' : 'Heat score') : view === 'vegetation' ? 'Tree canopy' : 'Priority';
  const temperatures = areaSites.flatMap(site => site.surfaceTemperature == null ? [] : [site.surfaceTemperature]);
  const lowTemperature = Math.min(...temperatures);
  const highTemperature = Math.max(...temperatures);
  function readMetric(site: Site) {
    if (view === 'vegetation') return site.canopy_coverage;
    if (view !== 'heat') return site.priority_score;
    if (!live) return site.heat_score;
    if (site.surfaceTemperature == null) return null;
    return highTemperature === lowTemperature ? 50 : 100 * (site.surfaceTemperature - lowTemperature) / (highTemperature - lowTemperature);
  }
  const [failedTiles, setFailedTiles] = useState<Record<string, boolean>>({});
  const pins = useRef(new Map<string, HTMLButtonElement>());
  const popup = selected && selected.id !== closedId ? selected : undefined;
  function closePopup(restoreFocus = false) {
    if (restoreFocus && popup) (pins.current.get(popup.id) ?? map.current)?.focus();
    setClosedId(selected?.id);
  }
  useEffect(() => {
    if (!selected) return;
    const [x, y] = point(selected.latitude, selected.longitude, 0);
    setCamera(previous => ({ x, y, z: Math.max(previous?.z ?? overview.z, selected.polygons ? (selected.openArea ? 16 : 13) : 15) }));
    setClosedId(undefined);
  }, [selected, overview.z]);
  function pick(id: string) {
    setPickFor(undefined); setSpot(undefined); setMeetingError('');
    setClosedId(undefined);
    if (selected?.id === id) {
      const [x, y] = point(selected.latitude, selected.longitude, 0);
      setCamera(previous => ({ x, y, z: Math.max(previous?.z ?? overview.z, selected.polygons ? (selected.openArea ? 16 : 13) : 15) }));
    }
    onSelect(id);
  }
  const drag=useRef<{x:number;y:number;moving:boolean}|null>(null);
  const suppressClick = useRef(false);
  const current = camera ?? overview;
  const z = current.z, cx = current.x * 2**z, cy = current.y * 2**z;
  const outlines = useMemo(() => sites.filter(site => site.polygons).map(site => ({
    site,
    path: site.polygons!.flatMap(polygon => polygon.map(ring => ring.map(([lng, lat], index) => {
      const [x, y] = point(lat, lng, z);
      return (index === 0 ? 'M' : 'L') + x + ',' + y;
    }).join(' ') + ' Z')).join(' '),
  })), [sites, z]);
  function placeSpot(event: React.MouseEvent<SVGPathElement>, site: Site) {
    if (!picking) { pick(site.id); return; }
    const bounds = map.current!.getBoundingClientRect();
    const x = (cx + event.clientX - bounds.left - map.current!.clientLeft - size.width / 2) / 2**z;
    const y = (cy + event.clientY - bounds.top - map.current!.clientTop - size.height / 2) / 2**z;
    const longitude = Number((x / 256 * 360 - 180).toFixed(6));
    const latitude = Number((Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 256))) * 180 / Math.PI).toFixed(6));
    if (!selected?.polygons || !containsPoint(selected.polygons, latitude, longitude)) {
      setMeetingError('Choose a spot inside the highlighted area.'); return;
    }
    setMeetingError('');
    setSpot({ latitude, longitude });
  }
  const marker = picking && spot ? { ...spot, name: 'New meeting point' } : meeting;
  const markerPixels = marker ? point(marker.latitude, marker.longitude, z) : undefined;
  const tiles=[];
  for (let ty=Math.floor((cy-size.height/2)/256); ty<=Math.floor((cy+size.height/2)/256); ty++) {
    if (ty<0 || ty>=2**z) continue;
    for (let tx=Math.floor((cx-size.width/2)/256); tx<=Math.floor((cx+size.width/2)/256); tx++) {
      tiles.push({tx,ty,left:tx*256-cx,top:ty*256-cy});
    }
  }
  const imageryUnavailable = !!failedTiles[basemap + '/' + z + '/' + Math.floor(cx / 256) + '/' + Math.floor(cy / 256)];
  const move=(dx:number,dy:number)=>setCamera(previous => {
    const c = previous ?? overview;
    return { ...c, x: c.x + dx / 2**c.z, y: c.y + dy / 2**c.z };
  });
  const zoom = (step: number) => setCamera(previous => {
    const c = previous ?? overview;
    return { ...c, z: Math.max(8, Math.min(17, c.z + step)) };
  });
  return <section className="map" id="site-map" data-picking={picking} ref={map} tabIndex={-1} aria-label="Candidate site map"
    onKeyDown={event => { if (event.key === 'Escape') { if (picking) { setPickFor(undefined); setSpot(undefined); } else if (popup) closePopup(true); } }}
    onPointerDown={e=>{
      suppressClick.current=false;
      if(e.button!==0 || (e.target as Element).closest('button, a, label, select, input, .pin-popup, .meeting-picker')) return;
      drag.current={x:e.clientX,y:e.clientY,moving:false};
    }}
    onPointerMove={e=>{
      const last=drag.current;
      if (!last) return;
      if (!last.moving && Math.hypot(last.x-e.clientX,last.y-e.clientY)<5) return;
      if (!last.moving) e.currentTarget.setPointerCapture(e.pointerId);
      suppressClick.current=true;
      move(last.x-e.clientX,last.y-e.clientY);
      drag.current={x:e.clientX,y:e.clientY,moving:true};
    }}
    onPointerUp={()=>{drag.current=null}}
    onPointerCancel={()=>{drag.current=null}}
    onPointerLeave={()=>{if (!drag.current?.moving) drag.current=null}}
    onLostPointerCapture={()=>{drag.current=null}}
    onClickCapture={e=>{if(suppressClick.current && e.detail>0){suppressClick.current=false;e.stopPropagation();}}}>

    <div className={`tiles tiles-${basemap}`} aria-hidden="true">{tiles.map(tile => {
      const wrappedX = ((tile.tx % 2**z) + 2**z) % 2**z;
      const key = [basemap, z, tile.tx, tile.ty].join('/');
      const street = `https://tile.openstreetmap.org/${z}/${wrappedX}/${tile.ty}.png`;
      const imagery = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${tile.ty}/${wrappedX}`;
      return <img key={key} alt="" draggable={false} src={basemap === 'street' ? street : imagery}
        style={{left: `calc(50% + ${tile.left}px)`, top: `calc(50% + ${tile.top}px)`, visibility: failedTiles[key] ? 'hidden' : undefined}}
        onError={() => setFailedTiles(previous => ({ ...previous, [key]: true }))}
        onLoad={() => setFailedTiles(previous => previous[key] ? { ...previous, [key]: false } : previous)}/>;
    })}</div>
    {overlay && <div className={`site-overlay site-overlay-${view}`} aria-hidden="true">
      {sites.map(site => {
        const metric = readMetric(site);
        if (site.polygons || metric == null || metric === 0) return null;
        const [px, py] = point(site.latitude, site.longitude, z);
        return <span key={site.id} style={{
          left: `calc(50% + ${px-cx}px)`,
          top: `calc(50% + ${py-cy}px)`,
          width: Math.min(220, Math.max(64, 110 * 2**(z - 13))),
          opacity: .22 + .68 * metric / 100,
        }}/>;
      })}
    </div>}
    <div className="map-top">
      <label className="layer"><Layers2 size={15}/><span>Map view</span>
        <select aria-label="Map view" value={view} onChange={event => setView(event.target.value as MapView)}>
          <option value="street">Street</option>
          <option value="heat">Heat</option>
          <option value="vegetation">Vegetation</option>
          <option value="satellite">Satellite</option>
        </select>
      </label>
    </div>
    {imageryUnavailable && <div className="map-unavailable" role="status">Basemap unavailable. Try Satellite or open the site in Maps.</div>}
    {popup && !popup.polygons && <div className="site-focus-ring" aria-hidden="true"/>}
    <svg className="screening-areas" aria-hidden="true">
      <g transform={`translate(${size.width/2-cx} ${size.height/2-cy})`}>
      {outlines.map(({site, path}) => {
        const metric = readMetric(site);
        const isSelected = site.id === selected?.id;
        const fill = metric == null ? '#82958a' : view === 'vegetation' ? '#19773b' : '#cf4a28';
        return <path key={site.id} d={path} fill={fill} fillOpacity={overlay ? (metric == null ? .04 : .06 + metric / 320) : isSelected ? .16 : site.id.startsWith('shade:') ? .12 : 0}
          fillRule="evenodd" stroke={isSelected ? '#17392c' : site.id.startsWith('shade:') ? '#a83f22' : '#426454'} strokeOpacity={isSelected || site.id.startsWith('shade:') ? 1 : .58} strokeWidth={isSelected ? 2.5 : 1}
          vectorEffect="non-scaling-stroke" className={isSelected ? 'selected-tract' : undefined}
          onClick={event => placeSpot(event, site)}/>;
      })}
      </g>
    </svg>
    <div className="markers">{sites.map((s,index)=>{
      if (s.polygons) return null;
      const metric = readMetric(s);
      const color = metric == null ? 'unknown' : view === 'vegetation' ? 'vegetation-pin':metric>=80?'high':metric>=65?'moderate':'lower';
      const [px,py]=point(s.latitude,s.longitude,z);
      return <button key={s.id} ref={node => { if (node) pins.current.set(s.id, node); else pins.current.delete(s.id); }} title={label(s)} aria-label={label(s)+', rank '+(index+1)+', '+layer+': '+(metric==null?'unknown':Math.round(metric)+(view === 'vegetation' ? '%' : ''))} aria-expanded={popup?.id === s.id} aria-controls={popup?.id === s.id ? 'pin-popup' : undefined} aria-pressed={selected?.id===s.id} className={'marker '+color+(selected?.id===s.id?' active':'')} style={{left:`calc(50% + ${px-cx}px)`,top:`calc(50% + ${py-cy}px)`}} onClick={()=>pick(s.id)}>{popup?.id === s.id ? <MapPin size={18}/> : index + 1}</button>
    })}</div>
    {marker && markerPixels && <span className="meeting-pin" title={marker.name} aria-label={marker.name} role="img"
      style={{ left: size.width / 2 + markerPixels[0] - cx, top: size.height / 2 + markerPixels[1] - cy }}><MapPin size={17}/></span>}
    {picking && <form className="meeting-picker" onSubmit={event => {
      event.preventDefault();
      if (!selected) return;
      const fields = new FormData(event.currentTarget);
      const name = String(fields.get('meetingName') ?? '').trim();
      const lat = String(fields.get('pointLat') ?? '').trim();
      const lng = String(fields.get('pointLng') ?? '').trim();
      const location = spot ?? (lat && lng ? { latitude: Number(lat), longitude: Number(lng) } : undefined);
      if (!name || !location || !selected.polygons || !containsPoint(selected.polygons, location.latitude, location.longitude)) {
        setMeetingError('Name a public spot and choose a point inside the highlighted area.'); return;
      }
      const button = (event.nativeEvent as SubmitEvent).submitter;
      onMeeting({ ...location, name, siteId: selected.id }, button?.getAttribute('value') === 'invite');
      setSpot(undefined); setPickFor(undefined); setMeetingError('');
    }}>
      <strong>{spot ? 'Name this meeting point' : 'Pick a public meeting point'}</strong>
      <p>Choose a spot inside the outline, such as a park entrance or library front door.</p>
      <label>Meeting place<input name="meetingName" defaultValue={meeting?.siteId === selected?.id ? meeting?.name : undefined} required maxLength={100} placeholder="e.g. Park entrance on Main Street"/></label>
      {!spot && <details><summary>Enter coordinates instead</summary><label>Latitude<input type="number" step="any" name="pointLat"/></label><label>Longitude<input type="number" step="any" name="pointLng"/></label></details>}
      <p role="status">{meetingError || (spot ? 'Pin placed. You can click again to move it.' : 'Click or tap the map to place a pin.')}</p>
      <button className="primary" type="submit" value="invite">Save and invite</button>{' '}
      <button className="secondary" type="submit">Save meeting point</button>{' '}
      <button className="secondary" type="button" onClick={() => { setPickFor(undefined); setSpot(undefined); setMeetingError(''); }}>Cancel</button>
    </form>}
    {popup && !picking && <section id="pin-popup" className="pin-popup" aria-label={label(popup) + ' quick facts'}>
      <button type="button" className="pin-popup-close" aria-label="Close candidate popup" onClick={() => closePopup(true)}><X size={18}/></button>
      <p className="eyebrow">{popup.polygons ? 'Screening area · ' : ''}{tier(popup) === 'Unranked' ? 'Unranked' : tier(popup) + ' priority'}</p>
      <h3>{tractId(popup) ? 'Candidate area in ' + popup.neighborhood : label(popup)}</h3>
      {popup.siteCode && popup.id.startsWith('shade:') ? <p className="muted">{popup.siteCode} · {popup.openArea?.toLocaleString() ?? "—"} m² of screened open ground</p> : popup.neighborhood && !tractId(popup) && <p className="muted">{popup.neighborhood}</p>}
      <dl>
        {popup.workReported && <div><dt>Site status</dt><dd>Work reported complete</dd></div>}
        <div><dt>Priority</dt><dd>{popup.priority_score == null ? 'Unranked' : popup.priority_score + '/100'}</dd></div>
        <div><dt>{popup.surfaceTemperature == null ? 'Heat exposure' : 'Ground temp.'}</dt><dd>{popup.surfaceTemperature == null ? (popup.heat_score == null ? '—' : popup.heat_score + '/100') : popup.surfaceTemperature.toFixed(1) + ' °C'}</dd></div>
        <div><dt>Tree canopy</dt><dd>{popup.canopy_coverage == null ? '—' : popup.canopy_coverage + '%'}</dd></div>
      </dl>
      {live && popup.sceneDate && <p className="muted">Satellite estimate from {popup.sceneDate}. The planting score compares sites within this study area.</p>}
      {!popup.polygons && <a className="site-external" href={`https://www.google.com/maps/search/?api=1&query=${popup.latitude},${popup.longitude}`} target="_blank" rel="noreferrer">Open location in Maps <ArrowUpRight size={14}/></a>}
      {popup.landContext && <details className="zone-land-context"><summary>Why is tree canopy low here?</summary>
        <p>{landCoverExplanation(popup.landContext)}</p>
        <p>Tree canopy is from {popup.canopyYear ?? 2021}. Land cover is from {popup.landYear ?? 2021}. Surface heat was measured on {popup.sceneDate ?? 'a summer 2024 date'}.</p>
      </details>}
      {popup.id.startsWith('shade:') && <a className="site-external" href={`https://www.google.com/maps/search/?api=1&query=${popup.latitude},${popup.longitude}`} target="_blank" rel="noreferrer">View survey area in Maps <ArrowUpRight size={14}/></a>}
      {popup.polygons && <p className="muted">Low satellite moisture signal · verify the ground and access in person.</p>}
      {popup.polygons && <div className="meeting-actions">
        {meeting?.siteId === popup.id && <p><strong>Meet at {meeting.name}</strong> · <a href={meetingDirections(meeting)} target="_blank" rel="noreferrer">Directions</a></p>}
        <button type="button" className="secondary" disabled={popup.eligible === false} onClick={() => {
          setPickFor(popup.id); setSpot(meeting?.siteId === popup.id ? meeting : undefined); setMeetingError('');
          setCamera(c => c ? { ...c, z: Math.max(15, c.z) } : undefined);
        }}>{meeting?.siteId === popup.id ? 'Change meeting point' : 'Pick a meeting point'}</button>
      </div>}
      <button className="primary" disabled={popup.eligible === false && !shortlisted.includes(popup.id)} aria-pressed={shortlisted.includes(popup.id)} onClick={() => onShortlist(popup)}>
        {shortlisted.includes(popup.id) ? 'Remove from proposal' : 'Add to proposal'}
      </button>
    </section>}
    <div className="map-buttons"><button aria-label="Zoom in" disabled={z===17} onClick={()=>zoom(1)}><Plus/></button><button aria-label="Zoom out" disabled={z===8} onClick={()=>zoom(-1)}><Minus/></button><button aria-label="Return to area overview" title="Return to area overview" onClick={()=>{setCamera(undefined);closePopup()}}><Crosshair/></button></div>
    <div className="pan"><button aria-label="Pan west" onClick={()=>move(-100,0)}><ChevronLeft/></button><button aria-label="Pan north" onClick={()=>move(0,-100)}><ChevronUp/></button><button aria-label="Pan south" onClick={()=>move(0,100)}><ChevronDown/></button><button aria-label="Pan east" onClick={()=>move(100,0)}><ChevronRight/></button></div>
    <div className="map-bottom">
      {overlay ? <div className="map-tag overlay-legend">
        <strong>{layer}{view === 'vegetation' ? ' (%)' : live ? ' (°C)' : ' (0–100)'}</strong>
        <span className={`overlay-key overlay-key-${view}`}>{live && view === 'heat' && temperatures.length ? lowTemperature.toFixed(1) : 'Lower'} <i/> {live && view === 'heat' && temperatures.length ? highTemperature.toFixed(1) : 'Higher'}</span>
        <span>{pilot ? 'City area estimates at candidate sites' : live ? (view === 'vegetation' ? 'Tree canopy in surveyed zones. Outside the outlines is unscored.' : 'Surface heat in surveyed zones.') : 'Demo candidate measurements'}</span>
        {sites.length > 0 && sites.every(site => readMetric(site) == null) && <span>No measurements for these sites</span>}
      </div> : areaSites.some(site => site.polygons) ? <span className="map-tag">Outlines show dry open ground</span> : <span className="map-tag legend" aria-label="Priority: high 80 or more, moderate 65 to 79, lower below 65"><i className="high"/> High <i className="moderate"/> Moderate <i className="lower"/> Lower</span>}
      <span className="map-tag">{camera ? 'Map detail' : 'Area overview'}</span>
    </div>
    {basemap === 'street'
      ? <a className="attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
      : <a className="attribution" href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" target="_blank" rel="noreferrer">Esri, Maxar, Earthstar Geographics, GIS User Community</a>}

  </section>;
}
