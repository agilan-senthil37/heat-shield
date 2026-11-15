import { useState } from 'react';

const tasks = [
  ['permission', 'Confirm property permission'],
  ['utilities', 'Check overhead and underground utilities'],
  ['space', 'Check available planting space'],
  ['water', 'Identify a watering plan'],
] as const;

export type Visit = { siteId: string; assignee: string; date: string; status: 'planned' | 'completed' };
export type Review = { siteId: string; taskId: string; status: string; note: string; author: string; at: string };
export type Activity = { id: string; author: string; text: string; at: string };
type Props = {
  sites: { id: string; name: string }[];
  visits: Visit[];
  reviews: Review[];
  activity: Activity[];
  account: string;
  owner: boolean;
  displayName: (id: string) => string;
  onVisit: (visit: Visit) => void;
  onReview: (review: Review) => void;
};

export default function ActionPlan({ sites, visits, reviews, activity, account, owner, displayName, onVisit, onReview }: Props) {
  const [siteId, setSiteId] = useState(sites[0].id);
  const visit = visits.find(item => item.siteId === siteId);
  const canEdit = !visit || owner || visit.assignee === account;
  const [taskId, setTaskId] = useState<string>(tasks[0][0]);
  const review = reviews.find(item => item.siteId === siteId && item.taskId === taskId);

  return <details className="field-notes action-plan">
    <summary>Field action plan</summary>
    <label>Candidate site<select value={siteId} onChange={event => setSiteId(event.target.value)}>
      {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
    </select></label>
    <h5>Field visit</h5>
    <p>{visit ? `${displayName(visit.assignee)} · ${visit.date} · ${visit.status}` : 'Nobody has volunteered for this site yet.'}</p>
    {canEdit && <form key={siteId + (visit?.date ?? '') + (visit?.status ?? '')} onSubmit={event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const date = String(fields.get('date') ?? '');
      const status = fields.get('status') === 'completed' ? 'completed' : 'planned';
      if (date) onVisit({ siteId, assignee: visit?.assignee ?? account, date, status });
    }}>
      <label>Visit date<input name="date" type="date" required defaultValue={visit?.date}/></label>
      {visit && <label>Visit status<select name="status" defaultValue={visit.status}><option value="planned">Planned</option><option value="completed">Completed</option></select></label>}
      <button className="secondary">{visit ? 'Update visit' : 'Volunteer for this visit'}</button>
    </form>}
    <h5>Site checklist</h5>
    <p className="muted">These are volunteer checks. Official planting approval is tracked separately.</p>
    <ul>{tasks.map(([id, title]) => {
      const item = reviews.find(entry => entry.siteId === siteId && entry.taskId === id);
      return <li key={id}><strong>{title}</strong> · {item?.status ?? 'To do'}
        {item && <div className="muted">{item.note && <>{item.note} · </>}{displayName(item.author)} · <time dateTime={item.at}>{item.at.slice(0, 10)}</time></div>}
      </li>;
    })}</ul>
    <label>Checklist task<select value={taskId} onChange={event => setTaskId(event.target.value)}>
      {tasks.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
    </select></label>
    <form key={siteId + '/' + taskId + '/' + (review?.at ?? '')} onSubmit={event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      onReview({ siteId, taskId, status: String(fields.get('reviewStatus')), note: String(fields.get('note')).trim(), author: account, at: new Date().toISOString() });
    }}>
      <label>Checklist status<select name="reviewStatus" defaultValue={review?.status ?? 'To do'}>
        <option>To do</option><option>Needs follow-up</option><option>Reviewed</option>
      </select></label>
      <label>Checklist note<input name="note" maxLength={300} defaultValue={review?.note}/></label>
      <button className="secondary">Save checklist update</button>
    </form>
    <h5>Proposal activity</h5>
    {activity.length ? <ol>{[...activity].reverse().map(entry => <li key={entry.id}>
      {displayName(entry.author)} {entry.text} <small>· <time dateTime={entry.at}>{entry.at.slice(0, 10)}</time></small>
    </li>)}</ol> : <p className="muted">New visits, replies, and checklist updates will appear here.</p>}
  </details>;
}
