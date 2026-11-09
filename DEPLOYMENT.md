# Deployment — SOVLI v1.2.0

## Recommended: cloud host (Render)

The user needs a persistent always-on Node web service, HTTP/WebSocket support and filesystem persistence for SQLite and uploads. The supplied `render.yaml` defines a paid Starter web service in Frankfurt with a 1 GB persistent disk mounted at `/var/data`, `DATA_DIR=/var/data`, generated JWT secret and invite code, and `/api/health` health check.

- Deploy from a Git repository through Render Blueprint.
- Build: `npm install --omit=dev --no-audit --no-fund && npm run check && npm run verify`.
- Start: `npm start`.
- Render injects `PORT`, `RENDER_SERVICE_ID` and `RENDER_EXTERNAL_URL`; the app binds `0.0.0.0` and uses the injected port.
- Do not set `npm ci`: this source bundle intentionally has no package-lock.json.
- Keep one instance while SQLite is stored on the attached disk. Render persistent disks attach to one instance and prevent horizontal scaling.

After deploy:

1. Read `PUBLIC_TEST_CODE` in Render Environment and register the first permanent owner account through the public site.
2. Copy that account's Public ID into `OWNER_PUBLIC_ID` in Render Environment and redeploy.
3. Create a Render API key, save it as `RENDER_API_KEY` in Render Environment, then redeploy. Render injects `RENDER_SERVICE_ID` automatically.
4. Open `/owner` from the phone and install the PWA. The Cloud tab can check status, restart, and suspend a running Render service.
5. For a completely suspended service, use Render Dashboard → Resume or GitHub Actions. Configure GitHub repository secrets `RENDER_API_KEY` and `RENDER_SERVICE_ID`, then run `.github/workflows/render-control.yml` with resume/restart/suspend. Set `SOVLI_GITHUB_ACTIONS_URL` so the link appears in the mobile panel.

Detailed phone-only setup: `DEPLOY_FROM_PHONE.md`.

## Local Windows / LAN

1. Install Node.js >=22.16.
2. Extract the project and run `start.bat`.
3. Open `http://localhost:3000`; on a phone in the same Wi-Fi use the LAN IP printed by the BAT.
4. Keep the server window open. Stop with Ctrl+C.

## Cloudflare Quick Tunnel (temporary testing only)

`start-public.bat` and the local owner panel can still launch a Cloudflare Quick Tunnel when a local server is running. This is only a temporary bridge for testing; it depends on the host computer staying online and the tunnel edge staying connected. It is not the recommended public hosting mode and has no uptime guarantee. For a permanent public service use Render or a named Cloudflare Tunnel with a stable host.

## Costs and limitations

Render Starter web service is currently listed at about $7/month; a 1 GB persistent disk adds about $0.25/month. Bandwidth above the included allowance is additional. Verify the current price before confirming the service. Free web services do not provide persistent disks and spin down after inactivity, so they are not appropriate for this SQLite-backed always-on setup.

This SQLite-on-disk design is single-instance. For multi-instance scaling, migrate to managed PostgreSQL and external object storage before increasing instances.

## Migration / backups

Copy the entire `data/` directory and `.env` before updates. Preserve `data/.jwt-secret`. A new cloud deploy starts with a new database; old local accounts do not migrate automatically. Migration requires the original `data/orbit.sqlite`, `.jwt-secret`, `uploads/` and `avatars/` from the former host.
