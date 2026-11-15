'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X, Compass } from 'lucide-react';

const steps = [
  ['filters','Narrow your search','Use priority, high heat, and low canopy filters to find the sites you want to investigate. The map and ranked list update together.'],
  ['site-map','Read the landscape','Switch between Street, Heat, Vegetation, and Satellite. Drag to pan, or use the map controls. Select a numbered pin for a popup with its rank and scores.'],
  ['ranked','Compare candidates','Hover over the left edge or select Candidates to open the ranked list. Select any row to center the map and read its evidence.'],
  ['evidence','Read the evidence','Hover over the right edge or select Site details to open the full brief. The explanation describes the evidence behind the ranking.'],
  ['evidence','Compare two sites','Add a site to the comparison, then select a second candidate. Open the comparison to see their heat, canopy, and priority side by side.'],
  ['verify','Plan the field visit','Open the checklist to see what your team needs to confirm in person, from permission and utilities to space for roots.'],
  ['shortlist-action','Save a candidate','Add promising sites to your shortlist. You can come back and remove a site at any point.'],
  ['proposal','Prepare a proposal','Name your project and generate a report for your community partners. In demo mode, use Print or save as PDF.'],
  ['community','Work with your neighbors','Open your profile, choose nearby collaborators, and send your proposal. Open your inbox to review invitations and respond.'],
] as const;

export default function Tour({screen,onClose}:{screen:'explore'|'proposal'|'community';onClose:()=>void}){
  const availableSteps = screen === 'explore' ? steps.slice(0, -2) : steps.filter(([id]) => id === screen);
  const [step,setStep]=useState(0),[rect,setRect]=useState<DOMRect>();
  const dialog=useRef<HTMLDialogElement>(null), heading=useRef<HTMLHeadingElement>(null);
  const [id,title,copy]=availableSteps[step];
  useEffect(()=>{const d=dialog.current!;d.showModal();return()=>d.close()},[]);
  useEffect(()=>{
    const target=document.getElementById(id);
    if(target){
      const y=window.scrollY+target.getBoundingClientRect().top;
      window.scrollTo({top:Math.max(0,y-Math.min(100,window.innerHeight*.15)),behavior:'instant'});
    }
    const update=()=>setRect(target?.getBoundingClientRect());
    update();
    window.addEventListener('resize',update);
    window.addEventListener('scroll',update,{passive:true});
    heading.current?.focus({preventScroll:true});
    return()=>{window.removeEventListener('resize',update);window.removeEventListener('scroll',update)};
  },[id,step]);
  const placeAbove=rect && rect.top>window.innerHeight*.53;
  return <dialog className="tour" ref={dialog} onCancel={e=>{e.preventDefault();onClose()}} aria-labelledby="tour-title">
    {rect&&<div className="spotlight" aria-hidden="true" style={{left:Math.max(4,rect.left-5),top:Math.max(4,rect.top-5),width:Math.min(rect.right+5,window.innerWidth-4)-Math.max(4,rect.left-5),height:Math.min(rect.bottom+5,window.innerHeight-4)-Math.max(4,rect.top-5)}}/>}
    <div className={'tour-card'+(placeAbove?' above':'')}>
      <div className="tour-top"><span className="eyebrow"><Compass size={16}/> FIELD GUIDE · {step+1} / {availableSteps.length}</span><button className="icon-button" aria-label="Close tour" onClick={onClose}><X size={20}/></button></div>
      <h2 id="tour-title" ref={heading} tabIndex={-1}>{title}</h2><p>{copy}</p>
      <div className="tour-progress" aria-hidden="true">{availableSteps.map((s,i)=><span key={s[1]} className={i<=step?'complete':''}/>)}</div>
      <div className="tour-actions"><button className="secondary" disabled={!step} onClick={()=>setStep(step-1)}><ArrowLeft size={16}/> Back</button><button className="primary" onClick={()=>step===availableSteps.length-1?onClose():setStep(step+1)}>{step===availableSteps.length-1?'Finish tour':'Next'} <ArrowRight size={16}/></button></div>
    </div>
  </dialog>;
}
