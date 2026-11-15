import { label, type Site } from './data';

const metrics: { name: string; read: (site: Site) => string }[] = [
  { name: 'Priority', read: site => site.priority_score == null ? 'Unranked' : site.priority_score + '/100' },
  { name: 'Heat exposure', read: site => site.heat_score == null ? 'Unavailable' : site.heat_score + '/100' },
  { name: 'Tree canopy', read: site => site.canopy_coverage == null ? 'Unavailable' : site.canopy_coverage + '%' },
  { name: 'Field status', read: site => (site.verification_status ?? 'needs verification').replaceAll('_', ' ') },
];

export default function SiteComparison({ sites, onRemove }: { sites: Site[]; onRemove: (id: string) => void }) {
  return <section className="comparison" aria-labelledby="comparison-title">
    <h3 id="comparison-title">Compare sites <small>{sites.length}/2</small></h3>
    {sites.length === 1 && <p>Choose another map pin or ranked candidate, then select <strong>Add to comparison</strong>.</p>}
    <table>
      <thead><tr><th scope="col">Measure</th>{sites.map(site => <th scope="col" key={site.id}>
        {label(site)} <button type="button" className="secondary" aria-label={'Remove ' + label(site) + ' from comparison'} onClick={() => onRemove(site.id)}>Remove</button>
      </th>)}</tr></thead>
      <tbody>{metrics.map(metric => <tr key={metric.name}><th scope="row">{metric.name}</th>{sites.map(site => <td key={site.id}>{metric.read(site)}</td>)}</tr>)}</tbody>
    </table>
  </section>;
}
