'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { MapPin, ArrowUpRight, SlidersHorizontal, Flame, Trees, Sparkles, ClipboardList, Plus, Check, Map as MapIcon, Info, ChevronRight, CircleHelp } from 'lucide-react';
import HeatShieldBrand from './heatshield-brand';
import SiteMap from './map';
import { meetingDirections, type MeetingPoint } from './meeting-point';
import MapDrawer from './map-drawer';
import Tour from './tour';
import { regions } from './regions';
import LiveCommunity from './live-community';
import Community, { initial, storageKey } from './community';
import AccountGate from './account-gate';
import SiteComparison from './site-comparison';
import {checklist,demoSites,explainSite,getSites,label,live,pilot,pilotSites,proposalPdf,tier,tractId,type Site} from './data';
export default function WorkspaceLayout() {
  return <AccountGate><PlanningWorkspace/></AccountGate>;
}

type WorkingProposal = { siteIds: string[]; title: string; meeting?: MeetingPoint };
const emptyProposal: WorkingProposal = { siteIds: [], title: '' };

function proposalKey(account: string) {
  return 'heat-shield-working-proposal:' + (pilot ? 'pilot:' : '') + account;
}

function readProposal(key: string): WorkingProposal {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as WorkingProposal | null;
    if (saved && typeof saved.title === 'string' && Array.isArray(saved.siteIds) &&
      saved.siteIds.every(id => typeof id === 'string')) return saved;
  } catch {
    // Keep the editor usable when browser storage is unavailable.
  }
  return emptyProposal;
}

function PlanningWorkspace(){
  const pathname = usePathname();
  const router = useRouter();
  const screen = pathname === '/explore' ? 'explore' : pathname === '/proposal' ? 'proposal' : 'community';
  const [mapVisited, setMapVisited] = useState(screen === 'explore');
  useEffect(() => {
    if (screen === 'explore') setMapVisited(true);
    setTour(false);
    if (pathname === '/' && ['#explore', '#proposal'].includes(window.location.hash)) {
      router.replace('/' + window.location.hash.slice(1));
    }
  }, [screen, pathname, router]);
  const [tour,setTour]=useState(false);
  const tourTrigger=useRef<HTMLButtonElement|null>(null);
  function openTour(e:React.MouseEvent<HTMLButtonElement>){tourTrigger.current=e.currentTarget;setTour(true)}
  function closeTour(){setTour(false);requestAnimationFrame(()=>tourTrigger.current?.focus({preventScroll:true}))}
  const [comparison, setComparison] = useState<string[]>([]);
  const [area, setArea] = useState<string>(live ? regions[0] : 'Santa Clara County');
  const [knownSites, setKnownSites] = useState<Site[]>([]);
  const availableHere = live || area === 'Santa Clara County';
  const [sourceSites,setSites]=useState<Site[]>(live ? [] : pilot ? pilotSites : demoSites);
  const [load,setLoad]=useState(live?'loading':'ready'),[retry,setRetry]=useState(0);
  const [id,setId]=useState(''),[priority,setPriority]=useState('All priorities'),[heat,setHeat]=useState(false),[canopy,setCanopy]=useState(false);
  const [working, setWorking] = useState<WorkingProposal>(emptyProposal);
  const workingRef = useRef(working);
  const draftKey = useRef<string | null>(null);
  const [report,setReport]=useState(false),[pdf,setPdf]=useState('');
  const { siteIds: selected, title: name } = working;

  function showProposal(next: WorkingProposal) {
    workingRef.current = next;
    setWorking(next);
    setReport(false);
    setPdf('');
  }

  function loadAccountProposal(account: string) {
    draftKey.current = proposalKey(account);
    showProposal(readProposal(draftKey.current));
  }

  useEffect(() => {
    if (live) return;
    try {
      const profile = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      loadAccountProposal(typeof profile?.account === 'string' ? profile.account : initial.account);
    } catch {
      loadAccountProposal(initial.account);
    }
    function syncProposal(event: StorageEvent) {
      if (draftKey.current && event.key === draftKey.current) showProposal(readProposal(draftKey.current));
    }
    window.addEventListener('storage', syncProposal);
    return () => window.removeEventListener('storage', syncProposal);
  }, []);

  function updateProposal(changes: Partial<WorkingProposal>) {
    const next = { ...workingRef.current, ...changes };
    const key = draftKey.current;
    if (key) {
      try { localStorage.setItem(key, JSON.stringify(next)); } catch {
        // The current tab still retains edits for this visit.
      }
    }
    showProposal(next);
  }
  const [explain,setExplain]=useState<{id:string;text:string;state:string}>(),[explainRetry,setExplainRetry]=useState(0);
  const [completedSites, setCompletedSites] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!live || screen !== 'explore') return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refreshCompletions() {
      try {
        const response = await fetch('/api/community?completedSites', { cache: 'no-store', signal: controller.signal });
        if (response.ok) {
          const { sites } = await response.json() as { sites: string[] };
          if (!controller.signal.aborted) setCompletedSites(new Set(sites));
        }
      } catch {
        // Keep the last known completion status until the next refresh.
      }
      if (!controller.signal.aborted) timer = setTimeout(refreshCompletions, 5000);
    }
    void refreshCompletions();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [screen]);

  function withCompletion(site: Site): Site {
    if (!completedSites.has(site.id)) return site;
    return { ...site, workReported: true,
      priority_score: site.priority_score === null ? null : Math.max(0, Math.round((site.priority_score - 5) * 100) / 100) };
  }
  const sites = sourceSites.map(withCompletion);
  const filtered=(availableHere ? sites : []).filter(s=>(priority==='All priorities'||tier(s)===priority)&&(!heat||(live ? (s.surfaceTemperature ?? -1) >= 44 : (s.heat_score ?? -1) >= 80))&&(!canopy||(s.canopy_coverage??101)<15)).sort((a,b)=>(b.priority_score ?? -1) - (a.priority_score ?? -1));
  const active=filtered.find(s=>s.id===id) ?? (tour ? filtered[0] : undefined);
  const chosen=(live ? knownSites.map(withCompletion) : sites).filter(s=>selected.includes(s.id)).sort((a,b)=>(b.priority_score ?? -1) - (a.priority_score ?? -1));
  const activeId=active?.id;
  useEffect(()=>{
    if(!live || !mapVisited)return;
    const c=new AbortController();
    getSites(AbortSignal.any([c.signal,AbortSignal.timeout(45000)]), area).then(s=>{if(!c.signal.aborted){setSites(s);setKnownSites(prior=>[...prior.filter(site=>site.neighborhood!==area),...s]);setLoad('ready')}}).catch(()=>{if(!c.signal.aborted)setLoad('error')});
    return ()=>c.abort();
  },[area,retry,mapVisited]);
  useEffect(()=>{
    if(!active || screen !== 'explore')return;
    const c=new AbortController();
    explainSite(active,AbortSignal.any([c.signal,AbortSignal.timeout(10000)])).then(text=>{if(!c.signal.aborted)setExplain({id:active.id,text,state:'ready'})}).catch(()=>{if(!c.signal.aborted)setExplain({id:active.id,text:'The explanation is unavailable right now.',state:'error'})});
    return ()=>c.abort();
    // Selection IDs are unique within the loaded dataset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[activeId,explainRetry,screen]);
  function toggle(site: Site) {
    const ids = workingRef.current.siteIds;
    if (site.eligible === false && !ids.includes(site.id)) return;
    updateProposal({ siteIds: ids.includes(site.id) ? ids.filter(id => id !== site.id) : [...ids, site.id], ...(workingRef.current.meeting?.siteId === site.id ? { meeting: undefined } : {}) });
  }
  async function generate(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!name.trim()||!chosen.length)return;
    if (!live) {
      setReport(true);
      requestAnimationFrame(() => document.getElementById('proposal-preview')?.focus());
      return;
    }
    setPdf('loading');
    try {
      const file=await proposalPdf(name.trim(),chosen,AbortSignal.timeout(20000));
      const url=URL.createObjectURL(file),a=document.createElement('a');
      a.href=url;a.download='heat-shield-proposal.pdf';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      setPdf('done');
    }catch{setPdf('error')}
  }
  return <>
    <a className="skip" href="#main">Skip to main content</a>
    <header className="bar"><div className="shell bar-inner"><Link className="brand" href="/"><HeatShieldBrand/></Link><nav aria-label="Main navigation"><Link href="/explore" aria-current={screen === 'explore' ? 'page' : undefined}><MapIcon size={16}/> Pinpoint</Link><Link href="/proposal" aria-current={screen === 'proposal' ? 'page' : undefined}><ClipboardList size={16}/> Proposal <b>{chosen.length}</b></Link><Link href="/" aria-current={screen === 'community' ? 'page' : undefined}>Photosynthesis</Link></nav><button className="guide" onClick={openTour}><CircleHelp size={17}/> <span>Field guide</span></button></div></header>
    <main id="main" className="shell">
      {(screen === 'explore' || mapVisited) && <div className="explore-page" hidden={screen !== 'explore'}>
      <div className="route-heading">
        <p className="eyebrow"><MapPin size={15}/> {live ? area : availableHere ? 'San José, CA' : area}</p>
        <h1>Pinpoint</h1>
        <p>{live ? 'Find open ground with little tree cover and a low moisture signal, including near homes and in some parks. Visit the patch to check its surface, access and planting permission.' : 'Select a ranked pin to see what the local inventory says about that location.'}</p>
      </div>
      <section id="explore" aria-labelledby="explore-title">
        <div className="section-head"><div><p className="eyebrow">01 / FIELD ATLAS</p><h2 id="explore-title">Planting priorities</h2></div><div className="totals">{pilot && <span className="demo-badge">City inventory snapshot</span>}{!live&&!pilot&&<span className="demo-badge" title="Sample locations and illustrative scores"><Info size={14}/> Demo sites and scores</span>}<span><b>{availableHere&&load==='ready'?sites.length:'—'}</b> candidates</span><span><b>{availableHere&&load==='ready'?sites.filter(s=>tier(s)==='High').length:'—'}</b> high priority</span></div></div>
        <div className="filters" id="filters"><label className="region-control">Study area<select value={area} onChange={e=>{setArea(e.target.value);setId('');setComparison([]);if(live){setSites([]);setLoad('loading')}}}>{regions.map(region=><option key={region}>{region}</option>)}</select></label><SlidersHorizontal size={17}/><label><span className="sr">Priority filter</span><select value={priority} onChange={e=>setPriority(e.target.value)}>{['All priorities','High','Moderate','Lower'].map(t=><option key={t}>{t}</option>)}</select></label><label className="check"><input type="checkbox" checked={heat} onChange={e=>setHeat(e.target.checked)}/> {live ? 'Ground temperature ≥ 44 °C' : 'Heat score ≥ 80'}</label><label className="check"><input type="checkbox" checked={canopy} onChange={e=>setCanopy(e.target.checked)}/> Canopy &lt; 15%</label>{(heat||canopy||priority!=='All priorities')&&<button className="reset" onClick={()=>{setPriority('All priorities');setHeat(false);setCanopy(false)}}>Clear filters</button>}</div>
        {!availableHere?<p className="empty" role="status">The regional data service is required to view candidates in {area}. This preview includes San José only.</p>:load==='ready'&&!sites.length?<p className="empty">{live ? 'No zones met the heat, canopy and land screening criteria in ' : 'No candidate records were returned for '}{area}.</p>:load==='loading'?<p className="empty" role="status">Loading candidate sites…</p>:load==='error'?<div className="empty" role="status">Couldn’t load candidate sites. <button onClick={()=>{setLoad('loading');setRetry(retry+1)}}>Try again</button></div>:<>
        <p className="map-instructions"><strong>Choose a study area.</strong> Then {live ? 'select an outlined shade zone' : 'select a pin'} on the map or open <strong>Candidates</strong> for a ranked list. Review its scores and add it to your proposal.</p>
        {live && (area === 'Tracy' || area === 'Mountain House') && <p className="muted">
          Select a zone to see its tree canopy and nearby land cover. {area === 'Mountain House' && 'The source years are shown in each zone. Check recent development and young trees in the field.'}
        </p>}
        <div className="workspace map-workspace">
          <SiteMap meeting={working.meeting} onMeeting={(meeting, invite) => {
            updateProposal({
              meeting, siteIds: workingRef.current.siteIds.includes(meeting.siteId) ? workingRef.current.siteIds : [...workingRef.current.siteIds, meeting.siteId],
              ...(invite && !workingRef.current.title.trim() ? { title: `Planting near ${meeting.name}`.slice(0, 100) } : {}),
            });
            if (invite) router.push('/proposal#send-planting-call');
          }} key={area} sites={filtered} areaSites={sites} selected={id ? active : undefined} onSelect={setId} onShortlist={toggle} shortlisted={selected}/>
          <MapDrawer side="left" label="Candidates" id="map-candidates" forced={tour}>
          <section id="ranked" className="site-list" aria-labelledby="ranked-title"><div className="list-title"><span className="eyebrow">SITE INDEX</span><h3 id="ranked-title">{live ? 'Where shade is needed' : 'Ranked candidates'}</h3><small>{filtered.length} shown</small>
          {live && <details className="shade-method"><summary>How ratings work</summary><p>The planting score gives up to 60 points based on how warm the ground is compared with other candidates in this study area, plus up to 40 for missing tree canopy. Compare the actual temperatures in °C across areas. Only zones with at least 40 °C surface heat and at most 15% canopy are shown. The screen checks for low satellite moisture and excludes mapped buildings and water. Developed open space can qualify near homes and in parks. A completion report lowers the shade need score by 5 points.</p></details>}</div><div className="list-scroll">{filtered.length?filtered.map((s,i)=><button key={s.id} aria-pressed={s.id===activeId} onClick={()=>setId(s.id)}><span className="rank">{String(i+1).padStart(2,'0')}</span><span>{label(s)}<small>{s.workReported?'Work reported complete':selected.includes(s.id)?'Shortlisted':live && s.surfaceTemperature != null ? s.surfaceTemperature.toFixed(1)+' °C surface · '+s.canopy_coverage+'% canopy' : s.neighborhood||tier(s)+' priority'}</small></span><b className={'rank-score '+tier(s).toLowerCase()}>{s.priority_score == null ? '—' : live ? s.priority_score.toFixed(1) : s.priority_score}</b></button>):<p className="muted">No candidates match these filters.</p>}</div></section>
          </MapDrawer>
          <MapDrawer side="right" label="Site details" id="map-details" forced={tour}>
          <aside className="detail" id="evidence" aria-label="Site details">{active?<><div className="detail-top"><span className="eyebrow">AREA DETAILS</span><span className={'pill '+tier(active).toLowerCase()}>{tier(active)} priority</span></div>
          <h3>{label(active)}</h3><p className="place"><MapPin size={14}/>{active.neighborhood||'San José pilot'}</p>
          {active.workReported && <p><strong>Work reported complete</strong> · 5-point planning adjustment</p>}
          <div className="score"><span>Shade need score</span><strong>{active.priority_score == null ? "Unranked" : <>{active.priority_score}<small> / 100</small></>}</strong></div>
          <div className="metrics">{active.surfaceTemperature != null && <div><Flame size={17}/><span>Satellite ground temperature</span><b>{active.surfaceTemperature.toFixed(1)} °C</b></div>}{!live && <><div><Flame size={17}/> <span>Heat exposure</span><b>{active.heat_score==null?'—':active.heat_score+'/100'}</b></div>{active.heat_score!=null&&<progress className="heat-meter" aria-label="Heat exposure" max={100} value={active.heat_score}/>}</>}<div><Trees size={17}/> <span>Tree canopy</span><b>{active.canopy_coverage==null?'—':active.canopy_coverage+'%'}</b></div>{active.canopy_coverage!=null&&<progress className="canopy-meter" aria-label="Tree canopy percentage" max={100} value={active.canopy_coverage}/>}</div>
          <div className="why"><h4><Sparkles size={16}/> {live ? 'Site explanation' : pilot ? 'About this candidate' : 'Example explanation'}</h4><p role="status">{explain?.id===active.id?explain.text:'Loading explanation…'}</p>{explain?.id===active.id&&explain.state==='error'&&<button onClick={()=>{setExplain(undefined);setExplainRetry(explainRetry+1)}}>Retry explanation</button>}</div>
          {(active.source || tractId(active)) && <details><summary>Data details</summary>{tractId(active) && <p>Census tract ID: {tractId(active)}</p>}{active.source && <p>Source: {active.source}</p>}{active.sceneDate && <p>Satellite scene: {active.sceneDate}. Moisture index: {active.ndmi ?? "unavailable"}. Values at or below zero pass this dry-ground screen.</p>}</details>}
          <details id="verify"><summary>Field verification checklist</summary><p>Status: {active.verification_status?.replaceAll('_',' ')||'needs verification'}</p><ul>{checklist.map(i=><li key={i}>{i}</li>)}</ul></details>
          <button id="shortlist-action" className="primary" disabled={active.eligible === false && !selected.includes(active.id)} aria-pressed={selected.includes(active.id)} onClick={()=>toggle(active)}>{selected.includes(active.id)?<Check size={18}/>:<Plus size={18}/>} {selected.includes(active.id)?'Remove from proposal':'Add to proposal'}</button>
          <button type="button" className="secondary compare-action" aria-pressed={comparison.includes(active.id)} disabled={comparison.length === 2 && !comparison.includes(active.id)} onClick={() => setComparison(previous => previous.includes(active.id) ? previous.filter(id => id !== active.id) : [...previous, active.id].slice(0, 2))}>
            {comparison.includes(active.id) ? 'Remove from comparison' : 'Add to comparison'}
          </button>
          {comparison.length > 0 && <a className="compare-link" href="#comparison-title">View comparison ({comparison.length}/2)</a>}
          </>:<p>{filtered.length ? "Choose an area on the map or from Candidates to see its details." : "No candidate matches the current filters."}</p>}</aside></MapDrawer></div>
          {comparison.length > 0 && <SiteComparison sites={sites.filter(site => comparison.includes(site.id))} onRemove={id => setComparison(previous => previous.filter(siteId => siteId !== id))}/>}
          <div className="shortlist-strip"><ClipboardList size={19}/><div><strong>Field shortlist</strong><span aria-live="polite">{chosen.length?chosen.length+' '+(chosen.length===1?'site':'sites')+' ready for your proposal':'Add promising sites as you explore.'}</span></div><Link href="/proposal">Open proposal <ChevronRight size={17}/></Link></div></>}
      </section>
      </div>}
      {screen === 'proposal' && <section id="proposal" aria-labelledby="proposal-title">
      <div className="planning-banner">
        <div><p className="eyebrow"><ClipboardList size={16}/> Planting plan</p><h1 id="proposal-title">Planting proposal</h1>
        <p>Review your candidates and prepare a plan to share with your community.</p></div>
        <Link className="banner-action" href="/explore">Back to Pinpoint</Link>
      </div>
      <div className="proposal-workbench">
        <section className="proposal-shortlist" aria-labelledby="proposal-sites">
          <div className="proposal-section-heading"><h2 id="proposal-sites">Shortlisted sites</h2><span>{chosen.length} selected</span></div>
          {chosen.length ? <ol>{chosen.map(site => <li key={site.id} className="proposal-site">
            <div className="proposal-site-title"><div><h3>{label(site)}</h3><p className="muted">{site.neighborhood || 'San José'}</p></div>
              <span className={'pill ' + tier(site).toLowerCase()}>{tier(site)} priority</span></div>
            <dl>
              <div><dt>Priority</dt><dd>{site.priority_score == null ? 'Unranked' : site.priority_score + '/100'}</dd></div>
              <div><dt>{live ? 'Ground temperature' : 'Heat score'}</dt><dd>{site.surfaceTemperature != null ? site.surfaceTemperature.toFixed(1) + ' °C' : site.heat_score == null ? 'Unavailable' : site.heat_score + '/100'}</dd></div>
              <div><dt>Canopy</dt><dd>{site.canopy_coverage == null ? 'Unavailable' : site.canopy_coverage + '%'}</dd></div>
            </dl>
            <details><summary>Field review details</summary><p>{(site.verification_status || 'Needs verification').replaceAll('_', ' ')}</p>{site.source && <p>Source {site.source}</p>}</details>
            <button type="button" className="secondary" onClick={() => toggle(site)}>Remove <span className="sr">{label(site)}</span></button>
          </li>)}</ol> : <div className="proposal-empty"><span className="empty-pin"><MapPin size={30}/></span><h3>Where should we plant?</h3><p>Pick a site in Pinpoint to bring its heat and canopy data into your proposal.</p><Link className="primary" href="/explore">Open Pinpoint <ChevronRight size={16}/></Link></div>}
        </section>
        <form className="proposal-form" onSubmit={generate}>
          <h2>Prepare your proposal</h2>
          <ul className="proposal-progress" aria-label="Proposal requirements">
            <li data-done={chosen.length > 0}>{chosen.length > 0 ? <Check size={15}/> : <MapPin size={15}/>} Shortlist a site{chosen.length > 0 && <span className="sr"> (complete)</span>}</li>
            <li data-done={!!name.trim()}>{name.trim() ? <Check size={15}/> : <ClipboardList size={15}/>} Name the project{ name.trim() && <span className="sr"> (complete)</span>}</li>
          </ul>
          <label htmlFor="name">Project name</label><input id="name" required maxLength={100} value={name} placeholder="e.g. East San José shade project" onChange={e=>updateProposal({ title: e.target.value })}/>
          <button className="primary" disabled={!chosen.length||!name.trim()||pdf==='loading'}>{pdf==='loading'?'Generating…':live?'Generate PDF proposal':'Generate preview proposal'} <ArrowUpRight size={17}/></button>
          {chosen.length && name.trim() ? <a href="#send-planting-call">Ask someone to work on this area <ChevronRight size={16}/></a> : <p className="muted">Add a site and name the project to send a planting call.</p>}
          <p className="pdf-status" role="status">{pdf==='error'?'The PDF couldn’t be generated. Try again.':pdf==='done'?'Your PDF download has started.':''}</p>
        </form>
      </div>
      {working.meeting && chosen.some(site => site.id === working.meeting?.siteId) && <section className="meeting-summary" aria-label="Meeting point">
        <h2>Meeting point</h2><p>{working.meeting.name} · <a href={meetingDirections(working.meeting)} target="_blank" rel="noreferrer">Get directions</a></p>
        <button type="button" className="secondary" onClick={() => updateProposal({ meeting: undefined })}>Remove meeting point</button>
      </section>}
      <LiveCommunity title={name} sites={chosen} meeting={working.meeting} compose/>
      {report&&<article className="report" id="proposal-preview" tabIndex={-1}><p className="eyebrow">{pilot ? 'CITY INVENTORY / FIELD REVIEW' : 'DEMO / FIELD REVIEW'}</p><h3>{name.trim()}</h3><p>{pilot ? 'City inventory candidates with dated area estimates. Planting feasibility needs field verification.' : 'Sample candidates for discussion. The scores are illustrative and planting feasibility has not been verified.'}</p><ol>{chosen.map(s=><li key={s.id}>{label(s)} — {s.priority_score}/100; heat {s.heat_score}/100; canopy {s.canopy_coverage}%.</li>)}</ol><h4>Before planting</h4><ul>{checklist.map(i=><li key={i}>{i}</li>)}</ul><button className="primary" onClick={()=>window.print()}>Print or save as PDF <ArrowUpRight size={17}/></button></article>}
      </section>}
      <div hidden={screen !== 'community'}>
        {screen === 'community' && <div id="live-photosynthesis"><LiveCommunity title={name} sites={chosen}/></div>}
        {!live && !pilot && <Community title={name} sites={chosen} onLoadDraft={draft => {
        updateProposal({ siteIds: draft.siteIds, title: draft.title });
        router.push('/proposal');
      }} onAccountChange={account => {
        loadAccountProposal(account);
        setComparison([]);
      }}/>}</div>
      <footer><HeatShieldBrand/> <span>Planning priorities for field review. {!live&&!pilot&&'Demo scores are illustrative.'}</span></footer>
    </main>
    {tour&&<Tour key={screen} screen={screen} onClose={closeTour}/>}
  </>;
}
