# SOLVI

SOLVI is a lightweight random chat for meeting new people and having conversations by shared languages and interests.

## v1.8.0 highlights

- Ideas and bug reports through private support tickets, with an owner inbox and threaded replies.
- 50 ✦ welcome credit for every new registered account.
- Completed conversations can be saved to Favorites after the user confirms. Transcript text and stickers are retained; temporary image/audio files are deleted when a chat ends.
- Media limits: Free — 3 photos and 30-second voice notes; VIP — 5 photos and 45 seconds; Premium — 10 photos and 60 seconds.
- Speech recording uses mono input, echo cancellation, noise suppression, auto gain control and compact Opus encoding.
- VIP and Premium members can buy exclusive five-piece cosmetic sets: “Звёздный след” and “Квантовый портал”.
- The owner console includes a private ticket inbox.

## Run locally

Requirements: Node.js 22.16 or newer.

```bash
yarn install
yarn start
```

Copy `.env.example` to `.env` and configure the settings that apply to your deployment. Set `OWNER_PUBLIC_ID` to the permanent account's public ID so the owner console can identify it.

## Production services

- App: https://solvi-chat.onrender.com
- Repository: https://github.com/Slabenk1y/solvi-chat
- Hosting: Render
- Persistent snapshot: Neon

The current hostname already matches the SOLVI brand. Keep it for launch; a custom domain can be added later after it is purchased and verified.

## Data safety and reset

A Neon snapshot was created before the v1.8.0 user reset. The reset is guarded by `SOLVI_PURGE_NON_OWNER_USERS=1` and proceeds only when `OWNER_PUBLIC_ID` matches a permanent registered account. It preserves that owner's account, password and public identifier, deletes other user accounts and user data, then writes an audit marker so later restarts do not repeat it. Enable this flag only after checking the production health fields `ownerConfigured` and `ownerAccountPresent`; turn it back off after the reset has completed.

## Quality checks

```bash
yarn check
yarn test
yarn verify
```
