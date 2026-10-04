import { useEffect, useRef, useState } from 'react';

type NtfyStatus = {
  configured: boolean;
  server?: string;
  topic?: string;
  url?: string;
  error: string | null;
};

async function request(path: string, signal?: AbortSignal, data?: object) {
  const response = await fetch(path, {
    method: data === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: { 'X-Fogline-Client': '1', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : `Request failed (${response.status}).`);
  if (!result) throw new Error('Fogline returned an unexpected response. Try again.');
  return result;
}

export function PhoneNotifications() {
  const [status, setStatus] = useState<NtfyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [sending, setSending] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [testError, setTestError] = useState('');
  const [copyResult, setCopyResult] = useState('');
  const [copyError, setCopyError] = useState('');
  const pending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    setStatus(null);
    void request('/api/agent/integrations', controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (typeof result.ntfy?.configured !== 'boolean') throw new Error('Notification settings are unavailable. Try again.');
      setStatus(result.ntfy);
    }).catch(error => {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Could not load notification settings.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [refresh]);

  const copy = async (label: string, value: string) => {
    setCopyResult('');
    setCopyError('');
    try {
      await navigator.clipboard.writeText(value);
      setCopyResult(`${label} copied.`);
    } catch {
      setCopyError(`Could not copy ${label.toLowerCase()}. Select the value in its field and copy it manually.`);
    }
  };

  const sendTest = async () => {
    if (pending.current) return;
    pending.current = true;
    setSending(true);
    setTestResult('');
    setTestError('');
    try {
      const result = await request('/api/agent/notifications/test', undefined, {});
      if (result.accepted !== true) throw new Error('Fogline could not confirm the test was accepted. Check your phone before trying again.');
      setTestResult('ntfy accepted the test notification. Check your phone to confirm it appeared.');
    } catch (error) {
      setTestError(error instanceof Error ? error.message : 'The test could not be confirmed. Check your phone before trying again.');
    } finally {
      pending.current = false;
      setSending(false);
    }
  };

  const configured = status?.configured && Boolean(status.server && status.topic);
  return <section className="journey-card" aria-labelledby="phone-notifications-title">
    <div className="section-title">
      <h2 id="phone-notifications-title">Phone notifications</h2>
      <button type="button" className="text-button" disabled={loading || sending} onClick={() => {
        setTestResult(''); setTestError(''); setCopyResult(''); setCopyError(''); setRefresh(value => value + 1);
      }}>Refresh setup</button>
    </div>
    {loading && <p role="status">Checking notification setup…</p>}
    {loadError && <p role="alert">{loadError} Use “Refresh setup” to try again.</p>}
    {!loading && status && !configured && <>
      <p>Phone notifications need server setup.</p>
      {status.error && <p role="alert">{status.error}</p>}
      <p className="muted">Set a private, hard-to-guess NTFY_TOPIC in the server settings, then restart Fogline and refresh setup.</p>
    </>}
    {!loading && configured && <>
      <p>Your server is configured. Connect your phone next:</p>
      <ol className="pair-steps">
        <li>Install ntfy for <a href="https://apps.apple.com/us/app/ntfy/id1625396347" target="_blank" rel="noopener noreferrer">iPhone</a> or <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener noreferrer">Android</a>, and allow notifications.</li>
        <li>Add a subscription in ntfy using this exact server and topic.</li>
      </ol>
      <label>ntfy server
        <input readOnly value={status!.server!} onFocus={event => event.currentTarget.select()} spellCheck={false} />
      </label>
      <button type="button" className="text-button" onClick={() => void copy('Server', status!.server!)}>Copy server</button>
      <label>ntfy topic
        <input readOnly value={status!.topic!} onFocus={event => event.currentTarget.select()} spellCheck={false} />
      </label>
      <button type="button" className="text-button" onClick={() => void copy('Topic', status!.topic!)}>Copy topic</button>
      {copyResult && <p role="status">{copyResult}</p>}
      {copyError && <p role="alert">{copyError}</p>}
      <p className="muted">Keep this topic private; anyone who knows it can read or send notifications unless access is restricted on the ntfy server.</p>
      <p>Once subscribed, send a test to check your phone.</p>
      <button type="button" className="primary" disabled={sending} onClick={() => void sendTest()}>{sending ? 'Sending test…' : 'Send test notification'}</button>
      {testResult && <p role="status">{testResult}</p>}
      {testError && <p role="alert">{testError}</p>}
      <p className="muted">Automatic alerts require reminders enabled above and the Fogline server awake and running. Phone receipt is only confirmed when you see the notification.</p>
      <a className="text-button" href="https://docs.ntfy.sh/subscribe/phone/" target="_blank" rel="noopener noreferrer">ntfy phone setup help</a>
    </>}
  </section>;
}
