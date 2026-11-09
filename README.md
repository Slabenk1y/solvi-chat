# SOLVI

A random chat for meeting new people through shared languages and interests.

## v1.9.0

- Private idea/bug tickets with owner replies and close status.
- 50 ✦ registration bonus.
- Completed chat archives in Favorites.
- Free/VIP/Premium photo and voice limits.
- Owner-managed social links displayed in the app footer.
- Reward tasks and sponsored actions with manual proof review and auditable token payouts.
- VIP/Premium cosmetic collections require an explicitly verified real-money subscription.
- Branded app/owner confirmation dialogs.

## Production

- App: https://solvi-chat.onrender.com
- Repository: https://github.com/Slabenk1y/solvi-chat
- Hosting: Render
- Persistent snapshot: Neon

The current hostname matches the SOLVI brand and should remain in use. A custom domain can be attached after purchasing and verifying it.

## Payments

The app currently supports manually reconciling a real payment in the owner panel; it does not yet process cards automatically. Before enabling automated checkout, choose a payment provider, supported country/currency, legal merchant details and configure its secret keys/webhook. Never collect card data directly in SOLVI.

## Tasks and rewards

Owners can configure links and campaigns. Users submit an HTTPS proof link; the owner reviews it and approves/rejects. Tokens are credited only after approval. A platform's public link alone cannot prove that someone subscribed, so automated instant rewards are intentionally not used.

## Run locally

Node.js 22.16 or newer.

```bash
yarn install
yarn start
yarn check
yarn test
yarn verify
```
