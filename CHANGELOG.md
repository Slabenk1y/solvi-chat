# Changelog

## v1.9.1 — SOLVI payments and growth hardening (2026-11-09)

- Added Stripe Checkout for 30-day VIP (€4.99) and Premium (€8.99) subscriptions.
- Added signed Stripe webhook verification with timestamp tolerance, amount/currency/metadata validation and unique payment references to prevent duplicate activation.
- Added a persistent payment ledger visible in the owner growth workspace; webhook payments and owner-verified manual receipts are recorded separately by provider.
- Paid status is distinct from token-earned status. VIP/Premium cosmetic bundles require a current paid entitlement.
- Added user-facing checkout cards with disabled states until Stripe keys and the canonical HTTPS return URL are configured.
- Expanded owner payment reconciliation to require a payment reference and amount.
- Improved owner ticket inbox with search, status/category filters and open-ticket counters.
- Added URL editing for existing social links and payment totals to the owner growth workspace.
- Bumped static asset cache to v24.

## v1.9.0 — SOLVI growth and monetization foundation

- Added owner-managed social links, owner-created reward tasks and manual task-proof review.
- Added max reward counts, rate limits and audited token payouts.
- Improved tickets with open-ticket limits, close action and live reply events.
- Replaced native browser confirmation dialogs with branded SOLVI dialogs.
