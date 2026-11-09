# Architecture — SOVLI v1.1.0

## Runtime

A modular monolith: Express HTTP API + Socket.IO realtime server + built-in `node:sqlite` persistence. Node.js >=22.16. The frontend is a responsive static HTML/CSS/JavaScript application served by Express. No Docker or separate database server is required for closed testing.

## Modules

- `server.js`: configuration, SQLite schema/migrations, auth, matching, chat, media, store, moderation and owner-only APIs.
- `public/index.html`: page structure and application panels.
- `public/app.js`: client state, navigation, auth, WebSocket lifecycle, chat, media, profile, settings, store and inventory.
- `public/styles.css`: design system, responsive layouts, store previews and SVG mascot animation.
- `public/sw.js`: static asset cache with explicit version key.
- `scripts/doctor.cjs`: preflight diagnostics independent of the app runtime.
- `scripts/owner-console.cjs`: interactive management CLI over authenticated owner-only APIs.
- `test/integration.test.js`: two-client and API integration scenarios.

## Authentication and authorization

Passwords are stored as password hashes. JWT contains user ID and session JTI; every API and Socket.IO connection checks the corresponding database session. Owner authority comes only from `OWNER_PUBLIC_ID`, which is compared server-side with the account Public ID. Browser state cannot grant owner permissions.

## Matching and economy

One active match per user. Queue candidates are checked for blocks and supported preference filters. An active match assigns the match ID to connected sockets. The 5-second server ticker measures elapsed time only if both participants still have a socket connected to the same match. Full minutes are credited to both accounts once and ledgered transactionally. A disconnected pair earns no tokens; time while server is stopped is never inferred or credited.

## Data lifecycle

Messages/media belong to a temporary active match and are removed by the existing end-of-match retention workflow. Account/profile/store ownership persists. Backups and secret files are local operator responsibilities.

## Owner tooling

The CLI calls the same server API as the owner dashboard and does not access SQLite directly. It supports user/economy/promo/store/role/moderation/session functions. It shows only match metadata, not private chat transcripts. All material adjustments are recorded in `admin_audit`.
