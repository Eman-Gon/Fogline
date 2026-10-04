import { useState } from 'react';
import type { AccountState, AgentEvent, MorningStage } from './agent-types';

const stageText: Record<MorningStage, string> = {
  planned: 'Planned', unconfirmed: 'Time to start · not confirmed', preparing: 'Getting ready', ready: 'Ready to leave', walking: 'Walking to the stop', riding: 'On the bus', arrived: 'Arrived', skipped: 'Day off',
};
type Reply = { reply: string; replySource: 'model' | 'fallback'; actions: string[]; account: AccountState };

export function AskFogline({ account, ask, onAccount }: { account: AccountState; ask: (text: string) => Promise<Reply>; onAccount: (next: AccountState) => void }) {
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [reply, setReply] = useState<Reply | null>(null);
  const stage = account.briefing?.stage;
  const activity = account.events.filter((e: AgentEvent) => e.actor === 'agent').slice(0, 5);
  return <section className="journey-card" aria-labelledby="ask-fogline">
    <div className="section-title"><h2 id="ask-fogline">Ask Fogline</h2>{stage && <span className="small-label">{stageText[stage]}</span>}</div>
    <form onSubmit={async e => {
      e.preventDefault(); if (busy || !text.trim()) return; setBusy(true); setError('');
      try { const result = await ask(text.trim()); setReply(result); onAccount(result.account); setText(''); }
      catch (err) { setError((err as Error).message); } finally { setBusy(false); }
    }}>
      <label>Running late? Plans changed?<input maxLength={1000} value={text} onChange={e => setText(e.target.value)} placeholder="I’m 10 minutes behind" /></label>
      <button className="primary" disabled={busy || !text.trim()}>{busy ? 'Checking…' : 'Update my morning'}</button>
    </form>
    {reply && <div role="status" aria-live="polite"><p>{reply.reply}</p>{reply.replySource === 'fallback' && <p className="muted">Fogline could not verify the assistant’s wording, so this is the calculated plan.</p>}</div>}
    {error && <p role="alert">{error}</p>}
    <p className="muted">Fogline calculates every time. The assistant only chooses what to check. Estimates are not guarantees.</p>
    {activity.length > 0 && <details><summary>What Fogline did</summary>{activity.map(e => <p key={e.id}><small>{new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small> {e.text}</p>)}</details>}
  </section>;
}
