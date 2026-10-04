export function arrivalStatus(arrive: number, deadline: number, buffer: number) {
  const spare = (deadline - arrive) / 60000;
  if (spare < 0) return { tone: 'late', text: `Estimated ${Math.ceil(-spare)} min late`, late: Math.ceil(-spare) };
  if (spare < buffer) return { tone: 'tight', text: `Within deadline, but ${Math.ceil(buffer - spare)} min short of your arrival buffer`, late: 0 };
  return { tone: 'fits', text: `Estimated ${Math.floor(spare)} min before your deadline · ${buffer} min buffer covered`, late: 0 };
}
const time = (at: number) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date(at));
export function ArrivalStatus({ arrive, deadline, buffer, destination }: { arrive?: number; deadline: number; buffer: number; destination: string }) {
  const status = arrive == null ? null : arrivalStatus(arrive, deadline, buffer);
  return <div className={`arrival-status ${status?.tone ?? 'unknown'}`} role="status">
    <span className="eyebrow">ESTIMATED ARRIVAL AT {destination}</span>
    <strong className="arrival-time">{arrive == null ? 'Unavailable' : time(arrive)}</strong>
    <p>Need to arrive by <strong>{time(deadline)}</strong></p>
    <p><strong>{status?.text ?? 'Arrival time cannot currently be confirmed.'}</strong></p>
    <small>Includes the walk after getting off. Estimates can change; this is not an on-time guarantee.</small>
  </div>;
}
