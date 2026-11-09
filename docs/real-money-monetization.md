# SOLVI real-money monetization setup

## 1. Payment gateway: Paymentwall Virtual Currency

The application integration is provider-backed but fail-closed: checkout stays disabled until the project credentials and public HTTPS URL are configured. Tokens are credited only from a signed Paymentwall server pingback. The browser return URL is informational and never changes a balance.

1. Create a Paymentwall merchant account and complete the business/KYC review. Use the actual person or legal entity that will own SOLVI and receive settlements.
2. Create a SOLVI project and choose **Widget API – Virtual Currency**. Set a widget code (the sample/default code is p1_1).
3. In Virtual Currency Product Inventory, add packs that issue exactly **500**, **1,500**, and **5,000 SOLVI tokens**. Choose and publish the retail prices in the Paymentwall dashboard. The same token amounts are shown in the app; do not publish different amounts in the merchant inventory.
4. Set the pingback URL to https://solvi-chat-next.onrender.com/api/billing/paymentwall/pingback. Ensure server pingbacks are enabled for the project.
5. Add these environment variables to the Render service:
   - PAYMENTWALL_PUBLIC_KEY — project/public key.
   - PAYMENTWALL_PRIVATE_KEY — project secret; keep it private.
   - PAYMENTWALL_WIDGET_CODE — the widget code, e.g. p1_1.
   - PAYMENTWALL_DISPLAY_CURRENCY — currency label shown in the app, e.g. EUR.
   - APP_PUBLIC_URL — https://solvi-chat-next.onrender.com.
6. Test with Paymentwall's Test Payment Method and Test Pingback Tool. Verify one successful credit, duplicate ref delivery, wrong-signature rejection, and type=2 chargeback reversal. Then submit the project for Paymentwall's technical and business review before going live.

The server handles:
- type=0: credit the virtual-currency amount sent in the signed pingback.
- Duplicate reference IDs: acknowledge without crediting twice.
- type=2: reverse the previously credited token amount and add a negative ledger entry. If the user already spent those tokens, the balance can become negative until earned tokens cover the reversal.
- Guest and owner accounts cannot start a token purchase.

**Important:** Paymentwall's Virtual Currency pingback reports the amount of virtual currency to credit, not the exact fiat charge. The owner panel therefore reports paid top-up count and delivered/reversed tokens; exact gross sales, processor fees, reserves, refunds, and net settlement must be reconciled against the Paymentwall Merchant Dashboard until a reporting API is connected.

## 2. Store sales

Store items, bundles, and VIP/Premium packages continue to use SOLVI tokens. Once the Paymentwall top-up is live, users can buy those tokens with real money and spend them in the existing store. Prices inside the store are still token prices; they are not per-item card prices.

## 3. Direct sponsor advertising

The owner panel now supports sponsored placements in the store. Create a campaign with advertiser, copy, HTTPS destination, booked price, and dates. The campaign starts paused and unpaid. Confirm the advertiser's bank transfer/invoice outside the app, mark the campaign paid in the owner panel, and then activate it. Only paid/comped, active, in-date campaigns are served. Impressions and clicks are counted by SOLVI.

This is direct-sold advertising, not an automatic ad network. A network such as Google AdSense requires its own approved publisher account, publisher/ad-unit identifiers, site review, consent configuration, and policy checks before its script can be enabled.

## 4. Payouts and settlement

Paymentwall currently documents international bank transfer and SEPA bank transfer among its payout routes, plus other methods, and says the payout currency depends on the processing currency and the receiving bank account's denomination. Its public payout FAQ describes a USD 100 minimum for automatic payouts and normally one or two payouts per month, subject to compliance approval, reserves, refunds, and chargebacks. Do not assume a RUB payout is available; confirm the account's permitted settlement currencies with Paymentwall before relying on it.

Do not put bank details, private keys, or merchant credentials in source control, chat messages, or the frontend.
