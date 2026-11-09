# Database Schema — SOVLI v1.1.0

SQLite database: `data/orbit.sqlite`. Schema is created and migrated during server start. SQL statements use prepared parameters. Transactions wrap purchases, token grants, promo redemption and active-minute credits.

## Core tables

- `users`: internal ID, public ID, unique normalized username, password hash, account type, description, avatar/avatar file, role, subscription, tokens, settings, guest expiry, suspension and timestamps.
- `sessions`: JWT JTI, user ID, creation/expiry and revocation timestamp.
- `matches`: two user IDs, status, creation/end metadata, `active_seconds`, `credited_minutes`, `last_tick_at`.
- `messages`: match/sender/client id, content, media type, sticker, attachments JSON, reply target, delivered/read timestamps.
- `message_reactions`: user/message/emoji, unique per user+message+emoji.
- `media_files`: media IDs and stored metadata scoped to a match and owner.
- `blocks`, `favorites`, `reports`, `reports_status`, `moderation_actions`.

## Economy and collections

- `token_transactions`: immutable token ledger (chat minute, purchase, membership, promo, admin adjustment).
- `token_earning_daily`: aggregate earned tokens by user and UTC day; reporting aggregate only, not a daily reward.
- `store_inventory`: user/item ownership, source and acquisition timestamp.
- `store_equipped`: one selected item per user/slot.
- `store_purchases`: purchase events and token price.
- `store_price_overrides`: owner-controlled price and enabled state.
- `promo_codes`: code, reward tokens/item/subscription, max uses, use count, active flag and validity dates.
- `promo_redemptions`: one redemption per user/code with timestamp.
- `admin_audit`: owner action ledger and safe metadata.

## Economy invariant

New registered users and guests are inserted with `tokens = 0`. No welcome/daily bonus route exists. Each completed active minute in a match increments each participant by exactly one token, and writes one ledger row per user. Old account balances are preserved; no retroactive reset is applied.

## Migration and backup

Before update, stop the server and copy `data/` and `.env`. Never remove `data/.jwt-secret`. SQLite migration leaves old account token balances intact. A pre-migration backup is made for the native-SQLite transition if required by the existing database state.
