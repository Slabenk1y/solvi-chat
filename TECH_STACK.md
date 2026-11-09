# Tech Stack — SOVLI v1.1.0

- Node.js >=22.16 (native `node:sqlite`).
- Express 5 HTTP API.
- Socket.IO 4 realtime transport.
- SQLite for accounts, sessions, matches, messages, media metadata, inventory and ledger.
- bcryptjs password hashing; jsonwebtoken session tokens.
- helmet and express-rate-limit for HTTP hardening/rate limits.
- Native HTML/CSS/JavaScript client, Web Audio UI sounds, MediaRecorder for voice capture, browser camera/file input where supported.
- Windows BAT launchers and optional Cloudflare Quick Tunnel for closed invite testing.

The stack is intentionally a single-server modular monolith. Redis/PostgreSQL/object storage/SFU are deferred until measurements show the need. Native SQLite reduces first-run complexity but is not a substitute for a managed production database under multi-instance load.
