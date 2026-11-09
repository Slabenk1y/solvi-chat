# Deployment — SOVLI v1.3.0

## Render Free + Neon

The project uses the existing synchronous SQLite runtime and an external Neon PostgreSQL snapshot store. The Render filesystem is treated as temporary. Neon stores the complete SQLite table snapshot in one JSONB row named `sovli_persistent_state`; the app restores it during startup and updates it after database writes.

This avoids a risky rewrite of every synchronous route and Socket.IO handler. It is intended for one Render instance and small beta traffic, not horizontal scaling. It is a persistence bridge, not a normalized PostgreSQL query layer.

### Required Render environment variables

- `DATABASE_URL`: the pooled PostgreSQL connection string from Neon. Keep the SSL parameters supplied by Neon. Never commit or share this value.
- `JWT_SECRET`: a stable random secret. Keep it unchanged across restarts and deploys.
- `OWNER_PUBLIC_ID`: the Public ID of the permanent owner account.
- `PUBLIC_MODE`, `PUBLIC_MATCHING`, `PUBLIC_TEST_CODE`: set according to the intended access mode.

The service intentionally refuses to start on Render when `DATABASE_URL` is missing. That prevents an accidental deployment using a temporary local-only database.

### Deploy steps

1. In Neon, use the project's **pooled** connection string. The string is a PostgreSQL URL beginning with `postgresql://`; keep it private.
2. In Render → service → Environment, add `DATABASE_URL` with that string. Add a stable `JWT_SECRET` if one is not already configured, and set `OWNER_PUBLIC_ID` to the account's current Public ID.
3. Deploy the code from the repository's `main` branch (or use the Blueprint after providing the secret environment variables).
4. Wait for a successful deploy, then open `/api/health`. Expected fields include `persistentStorage: true` and `storage: "node:sqlite+neon-persistent-snapshot"`.
5. Sign in to the owner account and open `/owner`.

On the first start with an empty Neon snapshot, SOVLI seeds Neon from the local SQLite database available to that deploy. On subsequent starts it restores the saved snapshot before running the normal migrations and temporary-chat cleanup. Existing user IDs and owner assignment therefore remain stable after the first successful snapshot.

### Snapshot behavior

- Every database write marks the local SQLite state as changed. A debounced snapshot is sent to Neon shortly afterward.
- On a normal SIGINT/SIGTERM shutdown, the app tries to save one final snapshot.
- User avatar files are included in the snapshot (up to 2 MB per file and 48 MB total).
- Active messages and chat media are intentionally cleared at server restart by the existing retention policy. Accounts, profile settings, token balances, store inventory, sessions, reports and admin audit data are retained.
- A brief abrupt termination during the short save delay or while Neon is unreachable can leave the very latest change unsaved. Monitor Render logs and Neon Usage.
- One running service only. Do not scale the Render service horizontally; each instance would hold its own local SQLite copy.

### Free-tier limitations

Render Free Web Services have an ephemeral filesystem and cannot attach persistent disks. They spin down after 15 minutes without inbound traffic and may take about one minute to wake on the next request. Free instances can also be restarted by Render. Neon keeps the saved snapshot outside that filesystem, so SQLite data is restored on the next boot.

Neon Free also has storage and compute allowances. Check the current usage in the Neon Console before public launch. This design is a small beta deployment, not a production uptime guarantee.

References:
- Render free instance limits: https://render.com/docs/free
- Neon connection guide: https://neon.com/docs/get-started/connect-neon

## Local Windows / LAN

1. Install Node.js >=22.16.
2. Extract the project and run `start.bat`.
3. Open `http://localhost:3000`; on a phone in the same Wi-Fi use the LAN IP printed by the BAT.
4. Keep the server window open. Stop with Ctrl+C.

Without `DATABASE_URL`, local mode uses the local SQLite file under `data/`.

## Cloudflare Quick Tunnel

`start-public.bat` can launch a Cloudflare Quick Tunnel for temporary testing. It depends on the host computer staying online and does not replace persistent hosting.

## Owner controls

The `/owner` panel uses the same owner-only APIs. `OWNER_PUBLIC_ID` must match the registered account's Public ID exactly. Keep `JWT_SECRET` stable so existing sessions remain valid.

## Backup and migration

The Neon JSONB snapshot is a restore point for this application, not an independent backup history. Export a separate copy before major changes. A local SQLite database can seed Neon on the first run only when that database file is present at startup.
