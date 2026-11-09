# SOLVI

A random chat for meeting new people through shared languages and interests.

## v1.9.1

- Private idea/bug tickets with owner replies, filters, status handling and close action.
- 50 ✦ registration bonus.
- Completed chat archives in Favorites.
- Free/VIP/Premium photo and voice limits.
- Owner-managed social links displayed as branded footer buttons.
- Reward tasks and sponsored placements with manual proof review and auditable token payouts.
- Stripe Checkout for 30-day paid VIP and Premium subscriptions (disabled until Render secrets are configured).
- VIP/Premium cosmetic bundles require a verified paid subscription. A membership bought only with tokens does not unlock them.
- Styled SOLVI dialogs replace native browser confirmation/prompt popups for app actions.

## Production

- App: https://solvi-chat.onrender.com
- Repository: https://github.com/Slabenk1y/solvi-chat
- Hosting: Render
- Persistent snapshot: Neon

The current hostname already matches SOLVI. Keep it for launch; attach a custom domain later if you buy and verify one.

## Payments

The app uses Stripe Checkout; SOLVI never collects or stores card numbers. Initial suggested monthly prices are VIP €4.99 and Premium €8.99. They are editable in BILLING_PRODUCTS in server.js. Before taking live payments:
1. Create/verify a Stripe merchant account and confirm your business/tax obligations.
2. Add STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and APP_PUBLIC_URL=https://solvi-chat.onrender.com to Render Environment.
3. Register https://solvi-chat.onrender.com/api/billing/stripe/webhook in Stripe for checkout.session.completed.
4. Test with Stripe test keys and a successful test card; then switch to live credentials.

The owner panel also supports manual reconciliation of a payment that has already arrived. This requires an actual amount and unique payment reference; it is not a substitute for a hosted checkout or verified bank transfer.

## Tasks and rewards

Owners can configure creator/social links and sponsor campaigns. Users submit an HTTPS proof link; the owner reviews it and approves/rejects. Tokens are credited only after approval. A public social link alone cannot verify a subscription, so instant rewards are intentionally not automatic. Sponsor tasks should have a defined budget, max-claim count and clear completion criteria.

## Run locally

Node.js 22.16 or newer.

```bash
yarn install
yarn start
yarn check
yarn test
yarn verify
```
