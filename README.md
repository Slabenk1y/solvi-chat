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


## Matching modes and age assurance (v1.10.1)

SOLVI has three separate queues: standard Chat, Flirt 18+, and Roleplay 18+. Standard Chat keeps the existing language and interest filters and adds reciprocal desired-gender matching. Roleplay uses the two intentions “Ищу сюжет” and “Предлагаю сюжет”; only opposite intentions are paired. Flirt and Roleplay have separate topic lists.

Both adult queues require a fresh explicit 18+ self-attestation for each queue entry; guest accounts are excluded. This is a self-declaration timestamp, not document or identity-based age verification. Before public promotion of an adult area, add an age-verification provider and jurisdiction-specific legal review.

### Store currency

Stripe store currency and prices are configurable through `BILLING_CURRENCY`, `VIP_PRICE_MINOR`, and `PREMIUM_PRICE_MINOR`. Keep `BILLING_CURRENCY=eur` for the current €4.99/€8.99 defaults. For RUB, configure RUB and prices in kopeks (for example RUB 499.00 is 49900). Stripe charge currency and payout currency are not necessarily the same; configure a supported settlement bank account in Stripe Dashboard before switching. Do not assume RUB proceeds can be paid out to a Russian bank account.

Default public links are Telegram https://t.me/ChatSolvi and TikTok https://www.tiktok.com/@slabenk1y_armagedon. Owner edits remain available in the panel.


## AI matchmaking fallback

After 25 seconds in the standard Chat queue, SOLVI can connect a Gemini-powered AI character if no human match was found. The character is always visibly labelled **ИИ-собеседник**; AI sessions do not inflate the real online-user count and are not stored as human accounts. The fallback uses the user's selected interests and gender preference to choose a fitting persona. Adult queues (Flirt 18+ and Roleplay 18+) do not use AI fallback.

To enable it, create a Gemini Developer API key in Google AI Studio and add it in Render → service → Environment as `GEMINI_API_KEY`. Optionally set `GEMINI_MODEL=gemini-2.5-flash`. Never commit the API key or paste it into client-side code. The Gemini API has separate quotas and terms from a consumer Gemini subscription. If no API key is configured, users remain in the human queue and see that AI fallback is not enabled. AI sessions currently support text and stickers; photo and voice attachments remain human-chat features.
