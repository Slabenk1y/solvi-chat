# Security Notes — SOVLI v1.1.0

## Current safeguards

- Password hashes, never plaintext passwords.
- JWT session JTI is validated against SQLite for HTTP and Socket.IO.
- Owner permissions derive from server environment variable `OWNER_PUBLIC_ID`.
- Owner APIs are protected by authentication and owner middleware.
- Rate limits/Helmet are used for sensitive routes.
- Nicknames are normalized and unique.
- Media and avatars validate actual signatures/MIME and enforce size limits.
- Chat messages are scoped to active match; reply target and media ownership are checked by the server.
- Sticker sends are validated against base stickers and the currently equipped server-recorded sticker pack.
- Economy changes are performed on the server and recorded in token ledger.
- Purchases, membership, promo redemptions and minute credits use database transactions.
- Owner actions are audited. The CLI exposes match metadata, not hidden transcript reading.

## Critical release limitations

- DOB is not collected and no effective age verification is implemented. Do not expose open random matching to the general public.
- Invite-only mode limits access but is not age assurance.
- Moderation/report flows are early-stage. No full operational grooming, sextortion, child-safety or emergency response program is present.
- No E2EE claim: chat is not end-to-end encrypted.
- No security audit or penetration test has been performed.
- HTTPS is provided by Cloudflare Quick Tunnel for temporary testing; production needs a managed domain/TLS setup.
- Local SQLite and backups require filesystem access control and backup protection.

## Owner console safety

- Owner role is set only by matching the configured `OWNER_PUBLIC_ID`.
- Keep `.env`, `data/.jwt-secret`, and database files private.
- Token and role adjustments are logged.
- Active dialog administration is limited to metadata and ending the dialog. There is no hidden full-message reader.
- Complaint context is user-submitted and should be handled only for moderation purposes.

## Operator checklist

1. Use a strong, unique password for owner account.
2. Configure `OWNER_PUBLIC_ID` locally; never commit `.env`.
3. Back up `data/` before each upgrade.
4. Restrict Node.js through Windows Firewall to the intended network.
5. Use only invite-only public tests until age/safety requirements are complete.
6. Do not claim E2EE, full age verification, or production-scale capacity.

## Cloud control plane (v1.2)

- Render API credentials are read only from server-side environment (`RENDER_API_KEY`) and are never serialized to the owner UI.
- `/api/admin/platform/render*` endpoints require both a valid session and the server-side owner identity.
- GitHub Actions uses repository secrets `RENDER_API_KEY` and `RENDER_SERVICE_ID`; neither is stored in the repository or workflow YAML.
- The owner panel can restart or suspend the Render service. Suspending makes the panel unavailable; resumption must be initiated from Render Dashboard or GitHub Actions.
- Do not add API keys, tunnel tokens, database files or JWT secrets to issues, screenshots, frontend bundles or source control.
