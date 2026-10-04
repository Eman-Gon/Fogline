import { useEffect, useRef, useState } from 'react';
import { clockInput, type Profile } from './planner';
import type { AccountState, AgentSettings } from './agent-types';

export function ServerMorning({ profile }: { profile: Profile }) {
  const [key, setKey] = useState('');
  const [account, setAccount] = useState<AccountState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [research, setResearch] = useState<{ checkedAt: string; sources: { title: string; url: string; publishedAt: string | null }[] } | null>(null);
  const [services, setServices] = useState<any>(null);
  const [correction, setCorrection] = useState('');
  const [notificationResult, setNotificationResult] = useState('');
  const keyRef = useRef('');
  const pending = useRef(false);
  const accept = (next: AccountState) => setAccount(old => !old || next.revision >= old.revision ? next : old);
  const request = async (path: string, data?: unknown, secret = keyRef.current) => {
    const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${secret}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    return result;
  };
  const action = async (path: string, data?: unknown) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { accept(await request(path, data)); } catch (e) { setError((e as Error).message); } finally { pending.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (!account) return;
    const refresh = () => { const secret = keyRef.current; if (!pending.current && secret) void request('/api/agent/state', undefined, secret).then(next => { if (keyRef.current === secret) accept(next); }).catch(e => { if (keyRef.current === secret) setError(e.message); }); };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [Boolean(account)]);
  const stamp = (iso: string) => new Date(iso).toLocaleString([], { timeZone: account?.settings.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const today = account ? new Intl.DateTimeFormat('en-CA', { timeZone: account.settings.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) : '';
  const ride = account?.rides.find(r => r.date === today);
  return <section className="server-morning">
    <p className="eyebrow">YOUR PERSONAL SERVER</p><h2>A morning shared across your devices.</h2>
    <p>Uses the real clock. Your profile, check-ins, and ride history are saved on this server.</p>
    {!account ? <form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try { const result = await request('/api/agent/state', undefined, key.trim()); keyRef.current = key.trim(); setAccount(result); setKey(''); setServices(await request('/api/agent/integrations', undefined, key.trim())); }
      catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}><label>Personal account key<input type="password" autoComplete="off" required value={key} onChange={e => setKey(e.target.value)} /></label><button className="primary" disabled={busy}>Connect to my account</button><p className="muted">Run <code>npm run account</code> in the server terminal to create your key, then restart the server. Enter the same key on your phone. The key is kept in memory until you close or reload this page.</p></form> : <>
      <div className="section-title"><span>{account.settings.enabled ? 'WEEKDAY CHECKS ON' : 'MANUAL CHECKS'} · {account.settings.timezone}</span><button className="text-button" disabled={busy} onClick={() => { keyRef.current = ''; setAccount(null); setResearch(null); setServices(null); }}>Disconnect</button></div>
      <div className="demo-buttons"><button disabled={busy} onClick={() => void action('/api/agent/check', {})}>{busy ? 'Working…' : 'Check data & revise plan'}</button><button disabled={busy} onClick={() => void action('/api/agent/state')}>Refresh account</button></div>
      {account.briefing && <section className="briefing"><span className="eyebrow">{account.briefing.source === 'live' ? '511 PREDICTIONS · ESTIMATED RIDE' : 'SAMPLE PLAN'} · SEEDED RISK</span><p>{account.briefing.speech}</p><p className="muted">{account.briefing.reason}</p><small>Checked {stamp(account.briefing.checkedAt)}{account.briefing.sourceAt && ` · Feed fetched ${stamp(account.briefing.sourceAt)}`}</small></section>}
      <div className="demo-buttons"><button disabled={busy || Boolean(ride?.acknowledged)} onClick={() => void action('/api/agent/checkin', { action: 'acknowledge' })}>{ride?.acknowledged ? 'Acknowledged' : 'I’m awake · stop escalation'}</button><button disabled={busy || Boolean(ride?.arrived)} onClick={() => void action('/api/agent/checkin', { action: !ride?.started ? 'start' : !ride.left ? 'leave' : 'arrive' })}>{!ride?.started ? 'Start getting ready' : !ride.left ? 'I’m out the door' : !ride.arrived ? 'I’ve arrived' : 'Morning complete'}</button></div>
      <details><summary>Server preferences & alarm briefing</summary><form key={JSON.stringify([account.settings, account.profile])} onSubmit={e => {
        e.preventDefault(); const form = new FormData(e.currentTarget);
        const minutes = (name: string) => String(form.get(name)).split(':').reduce((h, v) => h * 60 + Number(v), 0);
        const settings: AgentSettings = { enabled: form.get('enabled') === 'on', timezone: String(form.get('timezone')), line: String(form.get('line')), headsign: String(form.get('headsign')), wakeStart: minutes('wakeStart'), wakeEnd: minutes('wakeEnd') };
        void action('/api/agent/settings', { revision: account.revision, profile: form.get('copyProfile') === 'on' ? profile : account.profile, settings });
      }}>
        <p>Saved destination: <strong>{account.profile.destination}</strong>. Arrive by {clockInput(account.profile.arriveBy)}; {account.profile.ready} minutes to get ready.</p>
        <label className="check-label"><input type="checkbox" name="copyProfile" /> Copy this device’s Setup preferences to the server</label>
        <label>Timezone<input name="timezone" required defaultValue={account.settings.timezone} /></label>
        <label>511 line<input name="line" required maxLength={20} defaultValue={account.settings.line} /></label>
        <label>Exact destination from the 511 arrival panel<input name="headsign" maxLength={150} defaultValue={account.settings.headsign} /></label>
        <div className="fields"><label>Wake window starts<input name="wakeStart" type="time" required defaultValue={clockInput(account.settings.wakeStart)} /></label><label>Wake window ends<input name="wakeEnd" type="time" required defaultValue={clockInput(account.settings.wakeEnd)} /></label></div>
        <label className="check-label"><input name="enabled" type="checkbox" defaultChecked={account.settings.enabled} /> Check automatically on weekdays; send configured push alerts</label>
        <p className="muted">Checks run every minute, starting 10 minutes before the wake window. 511 data is cached for 10 minutes. Push alerts are sent when ntfy is configured. Phone calls remain previews. Acknowledge or start getting ready to stop escalation.</p><button className="primary" disabled={busy}>Save server preferences</button>
      </form><p>In an alarm-stopped Shortcut, fetch <code>{window.location.origin}/briefing/now</code> with the header <code>Authorization: Bearer YOUR_ACCOUNT_KEY</code>. Read the response’s <code>speech</code> value with Speak Text. Use your server’s HTTPS address on your phone.</p><p className="muted">Stopping the alarm retrieves a briefing. Use “I’m awake” here to stop escalation. The server must be running and reachable.</p></details>
      <section className="briefing">
        <p className="eyebrow">ADJUST TOMORROW · MASTRA GATEWAY</p>
        <form onSubmit={e => { e.preventDefault(); void action('/api/agent/correct', { text: correction }); }}>
          <label>What should change?<input maxLength={1000} required value={correction} onChange={e => setCorrection(e.target.value)} placeholder="I need 45 minutes to get ready tomorrow" /></label>
          <button className="primary" disabled={busy || !correction.trim()}>Update my morning</button>
        </form>
        <p className="muted">Supports a total getting-ready time for tomorrow, or reading the current plan. Your request is sent to Mastra Gateway. Times and estimates are calculated by Fogline.</p>
        {account.readyOverride && <p role="status">Saved for {account.readyOverride.date}: <strong>{account.readyOverride.minutes} minutes</strong> to get ready. Today stays unchanged.</p>}
      </section>
      <section className="briefing"><p className="eyebrow">ROUTE RESEARCH · EXA</p>
        <button disabled={busy} onClick={async () => {
          if (pending.current) return; pending.current = true; setBusy(true); setError('');
          try { setResearch(await request('/api/agent/research', {})); } catch(e) {setError((e as Error).message);} finally { pending.current = false; setBusy(false); }
        }}>Search recent route reports</button>
        <p className="muted">Searches the past two days. Results are unconfirmed and may be unrelated or outdated. They do not change your arrival estimate.</p>
        {research && <><small>Checked {stamp(research.checkedAt)}</small>{research.sources.length ? research.sources.map(r => <p key={r.url}><a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a><br/><small>Reported · unconfirmed{r.publishedAt ? ` · Published ${r.publishedAt.slice(0,10)}` : ' · Publication date unavailable'}</small></p>) : <p>No recent results returned. This does not confirm that the route is clear.</p>}</>}
      </section>
      {services && <p className="muted">Storage: {services.storage === 'neon' ? 'Neon Postgres' : 'local server file'} · Mastra key {services.mastra.configured ? 'configured' : 'missing'} · Exa key {services.exa.configured ? 'configured' : 'missing'}. Key presence alone does not verify a connection.</p>}
      <section className="briefing"><p className="eyebrow">PHONE NOTIFICATIONS · NTFY</p>
        {services?.ntfy?.configured ? <>
          <p>In the ntfy phone app, subscribe using server <strong>{services.ntfy.server}</strong> and topic <code>{services.ntfy.topic}</code>. Allow notifications. Keep this topic private: an unprotected topic can be read or published to by anyone who knows its name.</p>
          <button disabled={busy} onClick={async () => {
            if (pending.current) return; pending.current = true; setBusy(true); setError(''); setNotificationResult('');
            try { await request('/api/agent/notifications/test', {}); setNotificationResult('ntfy accepted the test. Check your phone to confirm it appeared.'); }
            catch(e) { setError((e as Error).message); } finally { pending.current = false; setBusy(false); }
          }}>Send test notification</button>
          {notificationResult && <p role="status">{notificationResult}</p>}
          <p className="muted">Automatic alerts need weekday checks enabled and the server running. Delivery failures appear below and are not automatically retried.</p>
        </> : <p>{services?.ntfy?.error || 'Set NTFY_TOPIC on the server and restart to enable push notifications.'}</p>}
      </section>
      <h3>Your saved rides</h3>{account.rides.some(r => r.started) ? account.rides.filter(r => r.started).slice(0, 14).map(r => <div className="entry" key={r.date}><time>{r.date}</time><p>Started {stamp(r.started!)}{r.left && ` · Left ${stamp(r.left)}`}{r.arrived && ` · Arrived ${stamp(r.arrived)}`}{r.measured !== null && ` · ${r.measured} min getting ready; next estimate ${r.nextReady} min`}</p></div>) : <p className="muted">Your first real check-in starts this history. Demo taps remain on this device.</p>}
      <h3>Agent decisions & escalation preview</h3>{account.events.slice(0, 20).map(e => <div className="entry" key={e.id}><time>{stamp(e.at)}</time><p><strong>{e.delivery ? `PUSH · ${e.delivery.status === 'sending' ? 'DELIVERY UNCERTAIN' : e.delivery.status.toUpperCase()}` : e.dryRun ? `DRY RUN · ${e.kind.toUpperCase()}` : 'PLAN'}</strong><br />{e.text}{e.delivery?.error && <><br />{e.delivery.error}</>}</p></div>)}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
