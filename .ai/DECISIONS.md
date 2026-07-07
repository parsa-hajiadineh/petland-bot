# DECISIONS.md — PetLand v22
Architecture and technical decisions recorded for future reference.
Decisions inferred from source code (not explicitly documented) are marked with `[inferred]`.

---

### ADR-001: Bale over Telegram
- **Decision:** Use the Bale messenger platform (tapi.bale.ai)
- **Reason:** Target market is Iran. Bale is an Iranian messenger and is not subject to filtering restrictions.
- **Consequence:** Similar to Telegram API but separate endpoint — `tapi.bale.ai` instead of `api.telegram.org`

---

### ADR-002: Long Polling over Webhook
- **Decision:** Use long polling to receive updates
- **Reason:** `[inferred]` Easier for local development, no SSL required
- **Consequence:** Requires a persistent process — serverless is not possible. `webhook.js` remains as a stub.

---

### ADR-003: Prisma db:push over Migrations
- **Decision:** Use `prisma db push` without migration files
- **Reason:** `[inferred]` Simplicity during early development
- **Consequence:** No DB change history, rollback not possible

---

### ADR-004: Conversation State in Database
- **Decision:** `orderStep`, `adminStep`, and temp fields are stored on the `User` model in the DB
- **Reason:** `[inferred]` Simplest solution for persistence across messages — in-memory state doesn't survive restarts
- **Consequence:** Every incoming message triggers at least one DB read+write
- **Note:** `adminStep = "VIEW_MY_ORDERS"` is used to bypass admin handler when admin views their own orders

---

### ADR-005: Static Product Catalog + Seed
- **Decision:** Products defined statically in `src/data/products.js`, imported to DB via `seed.js`
- **Reason:** `[inferred]` Products change infrequently — no CMS needed
- **Consequence:** Changing the catalog requires editing the JS file and re-running seed

---

### ADR-006: JavaScript CommonJS over TypeScript
- **Decision:** Project written in plain JavaScript (CommonJS)
- **Reason:** `[inferred]` Faster development, small team
- **Consequence:** No type safety, no interfaces — requires more care in naming

---

### ADR-007: Liara as Deployment Platform
- **Decision:** Deploy to Liara (Iranian PaaS)
- **Reason:** The `build` script uses `PRISMA_ENGINES_MIRROR=https://prisma.storage.iran.liara.space`
- **Consequence:** Requires Iran mirror to download Prisma engines

---

### ADR-008: Cost-Plus Pricing
- **Decision:** Selling price = cost price + profit margin (default 20%)
- **Reason:** `[inferred]` Simple business model
- **Consequence:** Changing the selling price requires updating `costPrice` or `profitPercent` in the DB

---

### ADR-009: Bale-ID Based Authentication
- **Decision:** No login/password — identification is based on user's `baleId`
- **Reason:** Users are already verified through Bale
- **Consequence:** Anyone who messages the bot becomes a customer. Security depends on the user's Bale account security.

---

### ADR-010: Manual Payment (Card / IBAN)
- **Decision:** No online payment gateway — user uploads a receipt, admin confirms
- **Reason:** `[inferred]` Simpler implementation, no payment gateway needed
- **Consequence:** Manual process — admin must review each order
- **Update:** `BANK_IBAN` added to env and `buildPaymentInfo()` — user can also transfer via IBAN

---

### ADR-011: Inline Keyboard and callback_query for Interactive UI
- **Decision:** Product lists, orders, invoices, and tickets are displayed with inline keyboards instead of plain text
- **Reason:** Better UX — user navigates by clicking, no typing required
- **Consequence:** `index.js` processes both `message` and `callback_query`. `handleCallbackQuery` added to `router.js`. `answerCallbackQuery` implemented in `bale.js`. `inlineKb()` added to `menus.js`.
- **callback_data conventions:**
  - `product:CODE` — show product
  - `PL-...` — show user order
  - `ordr:UUID` — show invoice for admin
  - `rej_more:N` / `shipd_more:N` — invoice pagination
  - `ship:snapp:UUID` / `ship:post:UUID` — select shipment type
  - `tkt:view:UUID` / `tkt:more:N` — admin tickets
  - `cat:back` / `main:back` — back navigation
  - `addr:view:<id>` / `addr:new` — saved address selection

---

### ADR-012: Shipment Flow (Snapp / Post)
- **Decision:** Admin selects the transport type when recording a shipment (Snapp or Post)
- **Reason:** Shipment info differs per type and must be communicated to the customer
- **Consequence:** Two new adminSteps: `SHIP_SNAPP` (number + plate + model) and `SHIP_POST` (tracking code). `shipmentInfo` stored in DB with `اسنپ |` or `پست |` prefix.

---

### ADR-013: Referral Marketing System
- **Decision:** Each user has a unique referral link (`/start ref_<baleId>`)
- **Reason:** Organic growth through referrals — financial incentive (commission)
- **Consequence:**
  - `referrerId` self-relation on `User` model — set once on first login, never changes
  - Users who join without a referral link remain permanently without a referrer
  - `index.js` parses `/start ref_xxx` parameter and passes it to `getOrCreateUser`

---

### ADR-014: Wallet and Commission System
- **Decision:** 5% of each approved invoice is credited to the referrer's wallet
- **Reason:** Financial incentive for marketing — affiliate marketing model
- **Consequence:**
  - `Wallet` and `Withdrawal` models added to schema
  - `Wallet` is one-to-one with `User` — created on first need via `upsert`
  - Commission calculated and credited in `approveOrder` (admin.js) when status changes to PACKAGING
  - Withdrawal: min 50,000, max 10,000,000 Toman — admin must approve

---

### ADR-016: Saved Addresses at Checkout
- **Decision:** After a successful order, the delivery address is saved in `SavedAddress` (max 3)
- **Reason:** Reduce friction for repeat orders — user does not need to re-enter address
- **Consequence:**
  - `SavedAddress` model added with `fullName`, `phone`, `province`, `city`, `address`, `postalCode`
  - `tempAddressId String?` on User for tracking selected address in inline menu
  - `startCheckout` checks saved addresses first — shows inline selection if any exist

---

### ADR-017: Marketing and Wallet Behind Access Code
- **Decision:** Marketing and Wallet buttons in the main menu are hidden by default
- **Reason:** These features are not suitable for all users — only marketers should have access
- **Consequence:**
  - `marketingEnabled Boolean @default(false)` added to User
  - User gains access by sending `MARKETING_ACCESS_CODE` (default: `petland-vip`)
  - `mainMenu()` shows buttons only if `user.marketingEnabled === true`
  - Access is one-way — revocation requires direct DB access

---

### ADR-018: Monthly Sales Report Archive
- **Decision:** Sales stats stored as monthly archives in `MonthlySalesReport`
- **Reason:** Live calculation over orders works for the current month, but snapshots are better for long-term archive
- **Consequence:**
  - `MonthlySalesReport` model with `yearMonth`, `totalRevenue`, `totalProfit`, `totalCommission`, `orderCount`
  - Archive updated when admin opens the stats page (lazy archiving)
  - Maximum 6 months retained — older entries are deleted
  - Current month is always calculated live
