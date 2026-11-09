# SOLVI real-money monetization setup

## Overview

SOLVI uses two separate Paymentwall projects because each Paymentwall Widget API project is configured for one API type:

1. **Virtual Currency (VC)** sells SOLVI tokens. Paymentwall sends the purchased virtual-currency amount in a signed pingback. SOLVI credits only that amount.
2. **Digital Goods (DG)** sells individual store items and 30-day VIP/Premium subscriptions. SOLVI creates a server-priced one-time checkout for the selected item and grants it only after a signed pingback.

The storefront stays fail-closed until the matching project credentials and HTTPS URL are configured. The browser success redirect never credits an account.

## 1. Paymentwall project for token top-ups

1. Create a Paymentwall merchant account and complete merchant/business verification.
2. Create a project configured as **Widget API – Virtual Currency**.
3. Set the virtual currency name to SOLVI tokens and configure regional exchange rates.
4. In Price Points, add the payment methods and amounts you want to sell. Start with price points which credit exactly **500**, **1,500**, and **5,000 SOLVI tokens** (the resulting VC amount, after any bonuses, must match the values you intend to grant).
5. Set the project's pingback URL to https://solvi-chat-next.onrender.com/api/billing/paymentwall/pingback.
6. Add these variables to Render:
   - PAYMENTWALL_VC_PUBLIC_KEY — VC project's public key.
   - PAYMENTWALL_VC_PRIVATE_KEY — VC project's private key.
   - PAYMENTWALL_VC_WIDGET_CODE — the VC project's widget code, e.g. p1_1.
   - PAYMENTWALL_DISPLAY_CURRENCY — display label in SOLVI (defaults to RUB). This does not force the payment method or settlement currency.
   - APP_PUBLIC_URL — https://solvi-chat-next.onrender.com.

   For backward compatibility, the VC integration also accepts PAYMENTWALL_PUBLIC_KEY, PAYMENTWALL_PRIVATE_KEY, and PAYMENTWALL_WIDGET_CODE. Do not reuse these generic keys for the Digital Goods project.

The VC webhook uses Paymentwall's Virtual Currency convention: **type=0** is a successful token top-up; **type=2** is a refund/chargeback. It validates the signature, matches the user by public ID, and stores the transaction reference before crediting. Repeated references do not credit twice. A type=2 pingback subtracts the tokens originally credited.

## 2. Paymentwall project for direct store purchases

1. Create a second Paymentwall project configured as **Widget API – Digital Goods**. This project must have its own project keys and widget code; do not point it at the VC project's keys.
2. Create a widget in the project (e.g. p1).
3. Set the pingback URL to https://solvi-chat-next.onrender.com/api/billing/paymentwall/goods-pingback.
4. Add these Render variables:
   - PAYMENTWALL_GOODS_PUBLIC_KEY — Digital Goods project's public key.
   - PAYMENTWALL_GOODS_PRIVATE_KEY — Digital Goods project's private key.
   - PAYMENTWALL_GOODS_WIDGET_CODE — Digital Goods widget code, e.g. p1.
5. In the SOLVI owner panel → Monetization → Catalog and prices, set a direct cash price and enable **За деньги** for each catalogue item you want to sell. These prices are separate from token prices. The storefront and owner-panel defaults use RUB; EUR and USD remain selectable per item and advertising campaign. 30-day VIP/Premium use BILLING_CURRENCY (defaults to RUB) and VIP_PRICE_MINOR / PREMIUM_PRICE_MINOR (defaults RUB 499.00 / RUB 899.00; override these values before launch). RUB display/pricing does not guarantee that Paymentwall will accept RUB or settle proceeds in RUB; confirm supported merchant currencies and payout currency with the approved merchant account.
6. Users enter a billing email in the store. SOLVI creates an order with a server-generated reference and passes the exact price, currency, product name, email, and callback URL to Paymentwall.
7. Paymentwall's signed Digital Goods pingback uses **type=0** for successful delivery and **type=2** for refund/chargeback. SOLVI verifies goodsid, user ID, signature, and unique ref; then it places the item in the user's inventory or extends the paid subscription. A repeated pingback cannot grant the product twice. A type=2 callback revokes delivered store items or reduces the paid subscription.

The two checkout types use separate pingback endpoints and separate private keys. No card number is collected or stored by SOLVI.

## 3. Direct sponsored advertising

The owner panel supports sponsor placements inside the SOLVI store. Create a campaign with advertiser, copy, HTTPS destination, price, currency, and dates. It starts paused and unpaid. Confirm the advertiser's payment outside the app (invoice/bank transfer), mark it paid, and activate it. Only campaigns marked paid/comped, active, and within their date range are served. SOLVI counts impressions and clicks.

This is a direct-sold ad placement, not an automatic advertising network. Google AdSense or another network needs a separate approved publisher account, publisher/ad-unit IDs, consent configuration, and policy review before its script can be enabled.

## 4. Reporting, refunds, and settlement

The owner panel reports token credits/reversals, direct-store orders and their order prices, current catalogue pricing, and direct sponsor campaign totals. Virtual Currency pingbacks contain the number of virtual tokens purchased rather than the fiat amount charged, so exact top-up gross, local currency, provider fees, reserves, refunds, and net proceeds must be reconciled against Paymentwall Merchant Dashboard.

Paymentwall's public payout support page lists international bank transfer and SEPA bank transfer and notes an automatic payout threshold, but the permitted settlement currency depends on the merchant account and receiving bank. Do not assume RUB settlement is available; confirm accepted buyer currencies, conversion rules, fees, reserve/chargeback terms, exact payout currency and bank route with Paymentwall after merchant approval. Keep the app's display currency separate from the provider's actual charge and settlement currency.

Test both projects using Paymentwall's Test Payment Method and Test Pingback Tool. Verify correct successful callback type (VC type=0, DG type=0), duplicate-reference handling, wrong-signature rejection, and type=2 reversal. Then submit both projects for Paymentwall's technical and business review before accepting live payments.

Do not put bank details, private keys, or merchant credentials in source control, chat messages, or the frontend.
