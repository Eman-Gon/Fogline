import { useId } from 'react';
import type { CommuteResearch } from './commute-types';

type ExaResearchReportProps = {
  research?: CommuteResearch;
  loading?: boolean;
};

function checkedTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return `${new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  }).format(new Date(value))} PT`;
}

function sameMessage(first: string, second: string) {
  return first.trim().replace(/\s+/g, ' ').toLowerCase() === second.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function ExaResearchReport({ research, loading = false }: ExaResearchReportProps) {
  const titleId = useId();
  const assessment = research?.status === 'ready' ? research.assessment : undefined;
  const level = assessment?.level ?? 'unknown';
  const checkedAt = research ? checkedTime(research.checkedAt) : null;
  const title = research?.status === 'deferred' ? 'Route research not active' : research?.status === 'unavailable' ? 'Exa report unavailable'
    : assessment?.title || (research ? 'Route impact not confirmed' : 'No Exa report yet');
  const explanation = assessment?.explanation || research?.message || 'Refresh this ride to search Exa for route conditions. Route conditions have not been checked.';
  const findings = assessment?.findings ?? [];
  const additionalSources = research?.sources.filter(source => !findings.some(finding => finding.url === source.url)) ?? [];

  return <section className="journey-card" aria-labelledby={titleId} aria-busy={loading}>
    <h2 id={titleId}>Exa route report</h2>
    {loading ? <p role="status">Searching Exa again… The updated route report will appear here.</p> : <>
      <div className={`exa-assessment exa-${level}`} role="status">
        <strong>{title}</strong>
        <p>{explanation}</p>
        {research?.message && !sameMessage(research.message, explanation) && <p>{research.message}</p>}
        {level === 'unknown' && !/not an all-clear/i.test(explanation) && <p>Route conditions are unconfirmed. This is not an all-clear.</p>}
        {findings.map((finding, index) => <article key={`${finding.url}:${index}`}>
          <a href={finding.url} target="_blank" rel="noopener noreferrer">{finding.title}</a>
          <p>{finding.explanation}</p>
          <small>Impact window: {finding.window || 'Not confirmed in the source.'}</small>
        </article>)}
      </div>
      {research && <p className="feed-meta">For {research.day} · {checkedAt ? <>Checked <time dateTime={research.checkedAt!}>{checkedAt}</time></> : 'No completed search time available'}</p>}
      {additionalSources.length > 0 && <div>
        <h3>Sources checked</h3>
        {additionalSources.map((source, index) => <article key={`${source.url}:${index}`}>
          <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
          {source.excerpt && <p>{source.excerpt}</p>}
          {source.publishedAt && <small>Published: {source.publishedAt}</small>}
        </article>)}
      </div>}
      {research?.status === 'ready' && <p className="muted">Based on Exa search sources, not live vehicle tracking. Check linked dates, affected stops, and impact windows before traveling.</p>}
    </>}
  </section>;
}
