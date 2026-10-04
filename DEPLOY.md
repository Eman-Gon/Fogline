# Deploying Fogline for one friend

Fogline is a single-account app. One deployment serves one person. Give the friend their own deployment, account key, ntfy topic and database. Do not point their deployment at your own Neon account data.

Nothing here has been run. No hosting account, app, database or notification topic has been created.

## What the deployment needs

- One always-on process (the scheduler runs inside the server). Never run two machines against one account.
- HTTPS, so the key and briefings are not sent in clear text. Fly provides the certificate and `fly.toml` forces HTTPS.
- A Neon database (`DATABASE_URL`). The container's disk is not durable, so the local-file fallback must not be used in production.
- Secrets set on the host, never baked into the image or committed: `FOGLINE_ACCOUNT_TOKEN`, `SF511_API_KEY`, `DATABASE_URL`, `NTFY_TOPIC` (plus optional `MASTRA_GATEWAY_API_KEY`, `EXA_API_KEY`, `NTFY_TOKEN`). `.dockerignore` excludes `.env` and `data/`.

## Fly.io steps (you run these; hosting is paid, so confirm cost first)

```sh
# 1. Create a separate Neon project/branch for the friend and copy its pooled connection string.
# 2. Generate fresh secrets:
openssl rand -hex 32      # FOGLINE_ACCOUNT_TOKEN
openssl rand -hex 16      # long random ntfy topic, e.g. fogline-<hex>
# 3. Edit fly.toml: set a unique app name.
fly launch --no-deploy --copy-config
fly secrets set FOGLINE_ACCOUNT_TOKEN=... SF511_API_KEY=... DATABASE_URL=... NTFY_TOPIC=...
fly deploy
fly scale count 1
```

Then check `https://<app>.fly.dev/` loads, `GET /api/agent/integrations` with the bearer key reports `storage: "neon"`, and the ntfy section is configured.

## Friend's first run

1. Friend installs the ntfy app and subscribes to `https://ntfy.sh` with the topic. Treat the topic as a password; anyone who knows it can read and publish to it. Use `NTFY_SERVER` plus `NTFY_TOKEN` for a protected topic.
2. Friend opens the app URL, chooses **Server morning**, and enters the key.
3. Press **Send test notification** once and confirm it appears on the phone. This sends a real notification.
4. Complete setup as described in the README, then use **Check data & revise plan**.

## Limits to tell the friend up front

- **Short prediction window.** 511 stop predictions cover only the next few trips. On stop 17166 (T line) a mid-day check returned three trips over about 30 minutes. A person who starts getting ready 45 to 60 minutes before leaving will often get no live plan for their trip. Fogline then says "Sample plan, not a live travel recommendation" and uses a built-in sample timetable, which does not reflect their real train. Treat any message with that wording as a placeholder.
- **No calibrated risk.** A saved commute shows estimates and a buffer, not a percentage; arrival accuracy is not yet measured. Ride duration is whatever the friend typed.
- **Ask Fogline spends model credits** (Mastra Gateway) per message, needs `MASTRA_GATEWAY_API_KEY`, and has only been tested with a mock model.
- **Calls are not real.** Only the push is delivered. Call escalations are log entries.
- **Fresh data lags.** 511 data is cached for up to 10 minutes.
- **Setup is technical.** The friend must enter an exact line and destination string as 511 reports it. Expect to sit with them for first-time setup.
- **Key lives in page memory.** Reloading the page requires re-entering the key.
- **iPhone Shortcut is untested.** A delivered ntfy alert is also not proof the phone made a sound; verify on the device, including Focus and silent modes.
- **Public transit endpoints.** `/api/transit*` need no key. They are bounded (128 cached feeds, 60 upstream loads per 10 minutes) but a stranger can use that budget and delay fresh data.

## Operating

- Rotate access by changing `FOGLINE_ACCOUNT_TOKEN` (`fly secrets set`), which restarts the app. Rides are kept.
- Logs: `fly logs`. Back up the Neon database, not the container.
