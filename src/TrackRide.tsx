import type { TrackedRide } from './tracking-types';
import { ExaResearchReport } from './ExaResearchReport';
import { ArrivalStatus } from './ArrivalStatus';

const minute = 60000;
const clock = (at: number) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date(at));
const duration = (start?: number, end?: number) => start != null && end != null ? `${Math.round((end - start) / minute)} min` : 'Awaiting check-ins';

export function TrackRide({ ride, history = [], now, busy, onAction }: {
  ride: TrackedRide; history?: TrackedRide[]; now: number; busy: boolean;
  onAction: (action: string) => void;
}) {
  const plan = ride.journey.plan;
  const observations = ride.samples.filter(s => s.source === 'live' && s.delay !== null);
  const last = ride.samples.at(-1);
  const fresh = last?.observedAt != null && now - last.observedAt >= 0 && now - last.observedAt <= 4 * minute;
  const gap = ride.trip.leave - now <= 10 * minute ? 3 : ride.trip.leave - now <= 20 * minute ? 4 : 10;
  const next = Math.min(ride.nextCheckAt, ride.lastCheckedAt + gap * minute);
  const points = observations.slice(-30);
  const min = Math.min(0, ...points.map(s => s.delay!));
  const max = Math.max(2, ...points.map(s => s.delay!));
  const x = (at: number) => 36 + (at - (points[0]?.observedAt ?? at)) / Math.max(minute, (points.at(-1)?.observedAt ?? at) - (points[0]?.observedAt ?? at)) * 480;
  const y = (delay: number) => 142 - (delay - min) / (max - min) * 112;
  const buckets = [
    { label: 'Early (over 1 min)', count: observations.filter(s => s.delay! < -1).length },
    { label: 'Near schedule (−1 to <2 min)', count: observations.filter(s => s.delay! >= -1 && s.delay! < 2).length },
    { label: 'Delayed (2+ min)', count: observations.filter(s => s.delay! >= 2).length },
  ];
  const completed = [ride, ...history].filter(r => r.arrived && r.left);
  const action = !ride.started ? 'prepare' : !ride.left ? 'leave' : !ride.boarded ? 'board' : 'arrive';
  const labels: Record<string, string> = { prepare: 'I’m starting now', leave: 'I’m out the door', board: 'I’m on the bus', arrive: 'I’ve arrived' };
  return <section className="tracking-view">
    <div className="morning-heading"><p className="eyebrow">TRACK RIDE · {ride.active ? 'AUTOMATIC CHECKS ON' : 'ENDED'}</p><h1>Your ride, as it changes.</h1><p><span className="route-badge">{ride.commute.code}</span> {ride.commute.stopName} → {ride.commute.alightName}</p></div>
    <section className="plan" aria-live="polite">
      <div className="plan-top"><strong>{fresh ? 'Fresh provider prediction' : plan ? 'Live prediction not confirmed' : 'Trip needs attention'}</strong><span className="small-label">{ride.active ? `Every ${gap} min` : 'Tracking ended'}</span></div>
      <ArrivalStatus arrive={plan?.arrive} deadline={ride.trip.deadline} buffer={ride.commute.buffer} destination={ride.profile.destination}/>
      <div className="plan-times"><div><small>Leave by</small><strong>{clock(ride.trip.leave)}</strong></div><div><small>{fresh ? 'Bus prediction' : 'Bus estimate'}</small><strong>{plan ? clock(plan.expected) : 'Unavailable'}</strong></div><div><small>Start getting ready</small><strong>{clock(ride.trip.start)}</strong></div></div>
      <p>{ride.journey.reason}</p>
      {plan && now > ride.trip.leave && !ride.left && <p className="notice">Your leave-by time has passed. Catching this bus is no longer assured; review another departure if you have not left.</p>}
      <p className="muted">Checked {clock(ride.lastCheckedAt)}.{last?.observedAt != null ? ` Provider observation ${clock(last.observedAt)}${fresh ? '.' : ' · old; do not treat this as current.'}` : ' No fresh provider observation.'} {ride.active ? `Next check ${clock(next)}${next <= now ? ' · waiting for server' : ''}.` : ride.endedReason}</p>
      {ride.active && <div className="hero-actions"><button className="primary" disabled={busy} onClick={() => onAction(action)}>{labels[action]}</button><button className="text-button" disabled={busy} onClick={() => onAction('stop')}>Stop tracking</button></div>}
      <p className="muted">Checks run on the server even when you close this page. Reports appear here when you return. If phone reminders are enabled and ntfy is configured, delay changes and disruptions also go to your phone. The server must stay running. Tracking ends when you confirm arrival or the tracking window expires.</p>
    </section>
    <section className="tracking-section"><p className="eyebrow">AUTOMATIC REPORT</p><h2>What changed?</h2><p>Delay reports start after two fresh observations show at least a two-minute delay. A change of one minute or more updates the report; unchanged delays stay quiet.</p>
      {ride.reports.length ? <ol className="tracking-reports">{ride.reports.slice(0, 8).map((report, i) => <li key={`${report.at}-${i}`}><time>{clock(report.at)}</time><p>{report.text}</p></li>)}</ol> : <p className="muted">No persistent delay confirmed yet. Monitoring continues.</p>}
    </section>
    <ExaResearchReport research={ride.journey.research}/>
    <p className="muted">Exa checks route conditions at setup, near departure, and when a persistent delay changes, with at least ten minutes between research attempts. During longer rides it rechecks every 30 minutes. Transit predictions refresh separately.</p>
    <section className="tracking-section"><p className="eyebrow">RIDE ANALYSIS</p><h2>Prediction history</h2><p>Minutes ahead of or behind the bus schedule. These are provider predictions, not measured bus arrival times.</p>
      {points.length ? <figure className="tracking-chart"><svg viewBox="0 0 550 185" role="img" aria-label={`Bus prediction delay across ${points.length} fresh observations, from ${Math.round(min)} to ${Math.round(max)} minutes.`}>
        <line x1="36" x2="516" y1={y(0)} y2={y(0)} className="chart-baseline"/>
        <text x="4" y="32">{Math.round(max)}m</text><text x="4" y="145">{Math.round(min)}m</text>
        <polyline points={points.map(s => `${x(s.observedAt!)},${y(s.delay!)}`).join(' ')} className="chart-line"/>
        {points.map(s => <circle key={s.observedAt} cx={x(s.observedAt!)} cy={y(s.delay!)} r="4" className="chart-point"><title>{clock(s.observedAt!)}: {s.delay!.toFixed(1)} minutes relative to schedule</title></circle>)}
        <text x="36" y="175">{clock(points[0].observedAt!)}</text><text x="516" y="175" textAnchor="end">{clock(points.at(-1)!.observedAt!)}</text>
      </svg><figcaption>{observations.length} fresh observations for this trip. Repeated cached predictions are counted once.</figcaption></figure> : <p className="tracking-empty">Waiting for fresh predictions. The chart will fill automatically as this ride is checked.</p>}
      <h3>Observed prediction percentages</h3>
      {buckets.map(bucket => { const percent = observations.length ? Math.round(bucket.count / observations.length * 100) : null; return <div className="tracking-bar-row" key={bucket.label}><div><span>{bucket.label}</span><strong>{percent === null ? '—' : `${percent}%`} <small>({bucket.count}/{observations.length})</small></strong></div><div className="tracking-bar"><span style={{ width: `${percent ?? 0}%` }}/></div></div>; })}
      <p className="muted">Share of fresh prediction snapshots for this one ride. These observations are related to each other; they are not independent rides or your probability of arriving on time.</p>
      <div className="tracking-probability"><strong>Chance of arriving on time: unavailable</strong><p>A reliable percentage needs verified outcomes across independent rides and a validated model. Fogline does not yet have that evidence.</p></div>
      <h3>Your recorded times</h3><dl className="tracking-durations"><div><dt>Getting ready</dt><dd>{duration(ride.started, ride.left)}</dd></div><div><dt>Door to destination</dt><dd>{duration(ride.left, ride.arrived)}</dd></div><div><dt>Boarding to destination</dt><dd>{duration(ride.boarded, ride.arrived)}</dd></div></dl>
      <p className="muted">Based on your check-ins. Boarding to destination includes any walk after getting off.</p>
      {completed.length > 0 && <><h3>Completed tracked rides</h3><div className="tracking-table"><table><thead><tr><th>Ride</th><th>Route</th><th>Door to destination</th></tr></thead><tbody>{completed.map(r => <tr key={r.id}><td>{new Date(r.createdAt).toLocaleDateString('en-US', {timeZone:'America/Los_Angeles',month:'short',day:'numeric'})}</td><td>{r.commute.code}</td><td>{duration(r.left, r.arrived)}</td></tr>)}</tbody></table></div></>}
      <details><summary>View prediction observations</summary><div className="tracking-table"><table><thead><tr><th>Observed</th><th>Bus estimate</th><th>Delay</th></tr></thead><tbody>{observations.slice(-30).map(s => <tr key={s.observedAt}><td>{clock(s.observedAt!)}</td><td>{clock(s.expected!)}</td><td>{s.delay!.toFixed(1)} min</td></tr>)}</tbody></table></div></details>
    </section>
  </section>;
}
