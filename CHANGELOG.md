# Changelog

## v1.8.0 — SOLVI community launch preparation (2026-11-09)

- Standardized public-facing branding to **SOLVI** across the main app, owner console, page titles and PWA manifests. Existing `solvi-chat` hostname already matches and is retained.
- Added private support tickets for ideas and bug reports, with user threads and an owner-only inbox, replies and status changes.
- Added a 50 ✦ registration welcome credit with a ledger entry.
- Completed-chat favorites now require explicit user confirmation and preserve transcript text/stickers. Temporary photo and audio media is still deleted when a chat ends.
- Updated media limits: Free 3 photos / 30 seconds voice; VIP 5 photos / 45 seconds; Premium 10 photos / 60 seconds.
- Tuned voice capture for speech: mono, noise suppression, echo cancellation, automatic gain control and compact Opus recording bitrate.
- Added two themed cosmetic sets: VIP “Звёздный след” (five collectible items) and Premium “Квантовый портал” (five mythic items). Each set is a tier-gated one-time purchase.
- Added server-side enforcement for attachment counts, ticket ownership and bundle eligibility.
- Added a guarded one-time user reset that keeps the verified permanent owner account and writes an audit marker. Run only after verifying the production owner.
- Neon snapshot created before reset; existing owner account, password and owner identifier are preserved. No manual destructive Neon SQL is required.
