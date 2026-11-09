# Architecture — SOVLI v1.3.0

## Runtime

Express HTTP API + Socket.IO realtime server + synchronous built-in `node:sqlite` runtime. Node.js >=22.16. Frontend is a responsive static HTML/CSS/JavaScript application served by Express.

## Persistent state

Render's local filesystem is ephemeral, so the SQLite database is treated as a per-process working copy. When `DATABASE_URL` is configured, `lib/postgres-snapshot.cjs` connects to Neon PostgreSQL using `pg`.

The module stores a full JSONB table snapshot in `sovli_persistent_state` and avatar binaries separately in `sovli_avatar_files`:
- On boot, it restores existing tables and avatar files into the local SQLite database before the usual migrations and restart cleanup.
- If no snapshot exists, it seeds Neon from the SQLite database available at first boot.
- Database writes mark the state dirty. A debounced save replaces the JSONB snapshot after writes; SIGINT/SIGTERM attempts a final save.
- SQLite tables remain the runtime query engine. Neon is a snapshot store, not yet a normalized PostgreSQL schema used by each application query.

This bridge is deliberately single-instance. Do not horizontally scale SOVLI. A future production migration should replace the snapshot bridge with normalized PostgreSQL tables and object storage.

## Modules

- `server.js`: configuration, SQLite schema/migrations, auth, matching, chat, media, store, moderation, owner-only APIs and Neon snapshot lifecycle.
- `lib/postgres-snapshot.cjs`: snapshot capture, restore, avatar file backup and Neon persistence.
- `public/index.html`, `public/app.js`, `public/styles.css`: responsive client application.
- `public/owner.html`, `public/owner.js`, `public/owner.css`: owner dashboard.
- `scripts/doctor.cjs`: preflight diagnostics.
- `scripts/owner-console.cjs`: management CLI over owner-only APIs.
- `test/persistence.test.js`: snapshot and restore tests.
- `test/integration.test.js`: two-client API and Socket.IO integration scenarios.

## Authentication and authorization

Passwords are stored as password hashes. JWT contains user ID and session JTI; every API and Socket.IO connection checks the database session. Owner authority comes only from `OWNER_PUBLIC_ID`, checked server-side.

Keep `JWT_SECRET` stable across deploys to preserve existing login sessions.

## Matching and economy

One active match per user. Queue candidates are checked for blocks and supported preference filters. The 5-second server ticker measures elapsed time only if both participants remain connected to the same match. Full active minutes are credited transactionally. Disconnected time is never inferred.

## Data lifecycle

Account/profile/store data is persisted in Neon snapshots. Active conversations, messages and temporary media are intentionally removed during server restart cleanup. Avatar image files are stored separately in Neon and uploaded only when created or changed (maximum 2 MB per file).

## Owner tooling

The CLI and web panel call the same owner-only server APIs. They do not access SQLite directly or expose private chat transcripts.
