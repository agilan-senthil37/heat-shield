'use client';
import { useEffect, useRef, useState } from 'react';
import { Crosshair, ArrowUpRight, MapPin, Minus, Plus, Layers2, X, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import {label,live,pilot,tier,type Site} from './data';

type MapView = 'street' | 'satellite' | 'heat' | 'vegetation';

function point(lat:number,lng:number,z:number){
  const sin=Math.sin(Math.max(-85.05,Math.min(85.05,lat))*Math.PI/180), scale=256*2**z;
  return [(lng+180)/360*scale,(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*scale];
}
export default function SiteMap({ sites, selected, onSelect, onShortlist, shortlisted }: {
  sites: Site[];
  selected?: Site;
  onSelect: (id: string) => void;
  onShortlist: (site: Site) => void;
  shortlisted: string[];
}){
  const [z,zoom]=useState(13), [pan,setPan]=useState([0,0]), [view, setView] = useState<MapView>('street');
  const overlay = view === 'heat' || view === 'vegetation';
  const basemap = view === 'satellite' ? 'satellite' : 'street';
  const layer = view === 'heat' ? 'Heat exposure' : view === 'vegetation' ? 'Tree canopy' : 'Priority';
  const readMetric = (site: Site) => view === 'heat' ? site.heat_score : view === 'vegetation' ? site.canopy_coverage : site.priority_score;
  const [failedTiles, setFailedTiles] = useState<Record<string, boolean>>({});
  const [popupId, setPopupId] = useState<string>();
  const pins = useRef(new Map<string, HTMLButtonElement>());
  const popup = selected?.id === popupId ? selected : undefined;
  function closePopup(restoreFocus = false) {
    if (restoreFocus && popupId) pins.current.get(popupId)?.focus();
    setPopupId(undefined);
  }
  useEffect(()=>setPan([0,0]),[selected?.id]);
  const drag=useRef<{x:number;y:number}|null>(null);
  const anchor = z >= 15 ? selected : undefined;
  const [x,y]=point(anchor?.latitude??37.344,anchor?.longitude??-121.872,z);
  const cx=x+pan[0],cy=y+pan[1];
  const tiles=[];
  for(let dy=-2;dy<=2;dy++) for(let dx=-3;dx<=3;dx++){
    const tx=Math.floor(cx/256)+dx,ty=Math.floor(cy/256)+dy;
    if(ty>=0&&ty<2**z) tiles.push({tx,ty,left:tx*256-cx,top:ty*256-cy});
  }
  const imageryUnavailable = !!failedTiles[basemap + '/' + z + '/' + Math.floor(cx / 256) + '/' + Math.floor(cy / 256)];
  const move=(dx:number,dy:number)=>{ closePopup(); setPan(([a,b])=>[a+dx,b+dy]); };
  return <section className="map" id="site-map" aria-label="Candidate site map"
    onKeyDown={event => { if (event.key === 'Escape' && popup) closePopup(true); }}
    onPointerDown={e=>{if(e.target!==e.currentTarget || e.button!==0)return;closePopup();drag.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId)}}
    onPointerMove={e=>{if(!drag.current)return;move(drag.current.x-e.clientX,drag.current.y-e.clientY);drag.current={x:e.clientX,y:e.clientY}}}
    onLostPointerCapture={()=>{drag.current=null}}>

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
      {sites.filter(site => site.polygons).map(site => {
        const path = site.polygons!.flatMap(polygon => polygon.map(ring => ring.map(([lng, lat], index) => {
          const [px, py] = point(lat, lng, z);
          return (index === 0 ? 'M' : 'L') + (px - cx) + ',' + (py - cy);
        }).join(' ') + ' Z')).join(' ');
        const metric = readMetric(site);
        const fill = metric == null ? '#82958a' : view === 'vegetation' ? '#19773b' : '#cf4a28';
        return <path key={site.id} d={path} fill={fill} fillOpacity={metric == null ? .15 : .15 + metric / 180}
          fillRule="evenodd" stroke={site.id === selected?.id ? '#17392c' : '#ffffff'} strokeWidth={site.id === selected?.id ? 3 : 1}
          onClick={() => { onSelect(site.id); setPan([0, 0]); zoom(15); setPopupId(site.id); }}/>;
      })}
    </svg>
    <div className="markers">{sites.map((s,index)=>{
      if (s.polygons) return null;
      const metric = readMetric(s);
      const color = metric == null ? 'unknown' : view === 'vegetation' ? 'vegetation-pin':metric>=80?'high':metric>=65?'moderate':'lower';
      const [px,py]=point(s.latitude,s.longitude,z);
      return <button key={s.id} ref={node => { if (node) pins.current.set(s.id, node); else pins.current.delete(s.id); }} title={label(s)} aria-label={label(s)+', rank '+(index+1)+', '+layer+': '+(metric==null?'unknown':Math.round(metric)+(view === 'vegetation' ? '%' : ''))} aria-expanded={popup?.id === s.id} aria-controls={popup?.id === s.id ? 'pin-popup' : undefined} aria-pressed={selected?.id===s.id} className={'marker '+color+(selected?.id===s.id?' active':'')} style={{left:`calc(50% + ${px-cx}px)`,top:`calc(50% + ${py-cy}px)`}} onClick={()=>{onSelect(s.id);setPan([0,0]);zoom(17);setPopupId(s.id)}}>{popup?.id === s.id ? <MapPin size={18}/> : index + 1}</button>
    })}</div>
    {popup && <section id="pin-popup" className="pin-popup" aria-label={label(popup) + ' quick facts'}>
      <button type="button" className="pin-popup-close" aria-label="Close candidate popup" onClick={() => closePopup(true)}><X size={18}/></button>
      <p className="eyebrow">{popup.polygons ? 'Screening area · ' : ''}{tier(popup) === 'Unranked' ? 'Unranked' : tier(popup) + ' priority'}</p>
      <h3>{label(popup)}</h3>
      {popup.neighborhood && <p className="muted">{popup.neighborhood}</p>}
      <dl>
        <div><dt>Priority</dt><dd>{popup.priority_score == null ? 'Unranked' : popup.priority_score + '/100'}</dd></div>
        <div><dt>Heat exposure</dt><dd>{popup.heat_score == null ? '—' : popup.heat_score + '/100'}</dd></div>
        <div><dt>Tree canopy</dt><dd>{popup.canopy_coverage == null ? '—' : popup.canopy_coverage + '%'}</dd></div>
      </dl>
      {!popup.polygons && <a className="site-external" href={`https://www.google.com/maps/search/?api=1&query=${popup.latitude},${popup.longitude}`} target="_blank" rel="noreferrer">Open location in Maps <ArrowUpRight size={14}/></a>}
      <button className="primary" disabled={popup.eligible === false} aria-pressed={shortlisted.includes(popup.id)} onClick={() => onShortlist(popup)}>
        {shortlisted.includes(popup.id) ? 'Remove from proposal' : 'Add to proposal'}
      </button>
    </section>}
    <div className="map-buttons"><button aria-label="Zoom in" disabled={z===17} onClick={()=>{zoom(z+1);setPan([0,0])}}><Plus/></button><button aria-label="Zoom out" disabled={z===10} onClick={()=>{zoom(z-1);setPan([0,0]);closePopup()}}><Minus/></button><button aria-label="Return to area overview" title="Return to area overview" onClick={()=>{zoom(13);setPan([0,0]);closePopup()}}><Crosshair/></button></div>
    <div className="pan"><button aria-label="Pan west" onClick={()=>move(-100,0)}><ChevronLeft/></button><button aria-label="Pan north" onClick={()=>move(0,-100)}><ChevronUp/></button><button aria-label="Pan south" onClick={()=>move(0,100)}><ChevronDown/></button><button aria-label="Pan east" onClick={()=>move(100,0)}><ChevronRight/></button></div>
    <div className="map-bottom">
      {overlay ? <div className="map-tag overlay-legend">
        <strong>{layer}{view === 'vegetation' ? ' (%)' : ' (0–100)'}</strong>
        <span className={`overlay-key overlay-key-${view}`}>Lower <i/> Higher</span>
        <span>{pilot ? 'City area estimates at candidate sites' : live ? 'Candidate measurements only' : 'Demo candidate measurements'}</span>
        {sites.length > 0 && sites.every(site => readMetric(site) == null) && <span>No measurements for these sites</span>}
      </div> : <span className="map-tag legend" aria-label="Priority: high 80 or more, moderate 65 to 79, lower below 65"><i className="high"/> High <i className="moderate"/> Moderate <i className="lower"/> Lower</span>}
      <span className="map-tag">{z >= 16 ? 'Site view' : 'Area overview'}</span>
    </div>
    {basemap === 'street'
      ? <a className="attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
      : <a className="attribution" href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" target="_blank" rel="noreferrer">Esri, Maxar, Earthstar Geographics, GIS User Community</a>}

  </section>;
}
