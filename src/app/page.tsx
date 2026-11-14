export default function Home() {
  return (
    <main>
      <p>HEATSHIELD / BACKEND</p>
      <h1>Planting plans start with evidence.</h1>
      <p>
        The backend is ready for your team&apos;s map interface. Candidate sites
        are planning suggestions and require field verification.
      </p>
      <ul>
        <li>
          <a href="/api/health">Backend status</a>
        </li>
        <li>
          <a href="/api/sites" target="_blank" rel="noreferrer">
            Candidate sites and score breakdowns
          </a>
        </li>
      </ul>
      <p>
        Local demo mode uses synthetic data and template explanations. See
        README.md and docs/API.md for setup, testing, and frontend integration.
      </p>
    </main>
  );
}
