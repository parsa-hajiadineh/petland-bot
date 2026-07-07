# AI_CONTEXT.md — PetLand v22
> Project management summary for AI chat sessions. Load this file at the start of each conversation.

---

## What is this project?
**PetLand** is a shop bot on the **Bale** messenger (Iranian Telegram alternative) that sells pet products. This is **not** a traditional web app — the entire UI is driven by Bale bot keyboards.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | JavaScript (Node.js, CommonJS) |
| HTTP | Express 5 (health check only) |
| Database | PostgreSQL + Prisma 6 ORM |
| Messaging | Bale Bot API (long polling) |
| PDF | PDFKit (Persian rendering incomplete) |
| Deployment | Liara (Iranian PaaS) |
| UI | Bale inline + reply keyboards — fully in Persian |

---

## Code Structure (30 files)

```
src/
  index.js          ← entry point (Express + polling loop)
  config/index.js   ← env variables
  database/prisma.js← Prisma singleton
  bot/
    bale.js         ← Bale API client (sendMessage, getUpdates, ...)
    messenger.js    ← reply helpers
    webhook.js      ← stub (unused)
  handlers/
    router.js       ← message dispatcher
    start.js        ← main menu
    products.js     ← browse & add to cart
    cart.js         ← cart view
    order.js        ← checkout & receipts
    admin.js        ← admin panel
    colleague.js    ← wholesale mode
    support.js      ← tickets
    help.js         ← help text
    marketing.js    ← referral system & marketing info
    wallet.js       ← wallet, withdrawal request & history
  keyboards/menus.js← Persian keyboard buttons
  utils/
    price.js        ← retail vs wholesale pricing
    order.js        ← tracking code generation
    invoice.js      ← PDF invoice + text invoice builder
  data/products.js  ← static catalog (~130+ products, 14 categories)
  seed.js           ← DB seeder
prisma/schema.prisma← DB schema
setup-assets.js     ← one-time script for font/logo setup
```

---

## Database (12 models)

| Model | Key Role |
|-------|---------|
| `User` | user + state machine + `referrerId` + `marketingEnabled` + `tempAddressId` |
| `Category` | product categories |
| `Product` | unique code, `costPrice`, `profitPercent`, Bale `file_id` for photo |
| `Cart` / `CartItem` | one-to-one cart with User |
| `Order` / `OrderItem` | order with full status lifecycle |
| `Ticket` / `TicketMessage` | support tickets |
| `Wallet` | user wallet (commission balance) |
| `Withdrawal` | wallet withdrawal requests |
| `SavedAddress` | saved delivery addresses (max 3) |
| `MonthlySalesReport` | monthly sales archive (max 6 months) |

**Order lifecycle:**
```
WAITING_PAYMENT → WAITING_APPROVAL → APPROVED → PACKAGING → SHIPPED → DELIVERED
                                          ↘ REJECTED
```

---

## User Roles

| Role | Authentication |
|------|---------------|
| `CUSTOMER` | any Bale user (automatic) |
| `ADMIN` | `baleId` in `ADMIN_BALE_IDS` env |
| `COLLEAGUE` | entering `COLLEAGUE_ACCESS_CODE` |

---

## Key Business Logic

- **Retail price** = `costPrice × (1 + profitPercent/100)` (default 20% from env)
- **Wholesale price** = `costPrice` (no markup, for COLLEAGUE)
- **Minimum wholesale order** = 10,000,000 Toman (configurable)
- **Payment** = manual, card-to-card or IBAN wire, receipt upload in bot
- **Tracking code** = format `PL-YYYYMMDD-####`
- **PDF invoice** = PDFKit — sent to admin on order approval
- **Marketing** = referral link `/start ref_<baleId>` — referrer is permanently recorded
- **Commission** = 5% of approved invoice amount credited to referrer's wallet
- **Withdrawal** = min 50,000 Toman, max 10,000,000 Toman — admin must approve
- **Saved addresses** = after first order, address is saved; shown inline at next checkout (max 3)
- **Marketing/wallet** = hidden behind `MARKETING_ACCESS_CODE` — default `petland-vip`
- **Sales stats** = monthly auto-archive in admin panel (max 6 months)

---

## Environment Variables

```env
BOT_TOKEN              # Bale bot token (required)
DATABASE_URL           # PostgreSQL connection string (required)
PORT                   # default 3000
ADMIN_BALE_IDS         # comma-separated Bale admin IDs
COLLEAGUE_ACCESS_CODE  # wholesale access code (default: petland1404)
MARKETING_ACCESS_CODE  # marketing+wallet unlock code (default: petland-vip)
DEFAULT_PROFIT_PERCENT # default: 20
WHOLESALE_MIN_ORDER    # default: 10000000
BANK_CARD              # bank card number
BANK_IBAN              # IBAN number (optional)
BANK_HOLDER            # account holder name
BANK_NAME              # bank name
BOT_USERNAME           # bot username without @ (for referral links)
SHOP_NAME              # default: پت لند
```

---

## Setup Scripts

```bash
npm run build    # prisma generate (with Iran mirror)
npm run db:push  # sync schema
npm run seed     # load products
npm start        # run (persistent process)
node setup-assets.js  # copy logo and font (run once)
```

---

## Known Gaps

| Gap | Severity |
|-----|---------|
| Persian PDF invoice | PDFKit does not render Persian correctly |
| PDF sent to admin only | not delivered to customer after approval |
| `webhook.js` is a stub | unused |
| `axios` installed but unused | |
| No tests | |
| No rate limiting | |
| `profitPercent` change requires direct DB access | no admin bot command |

---

## AI Rules

1. **Do not modify any source file without an explicit instruction**
2. Only answer based on actual source — do not guess
3. If information is unavailable, write `Unknown`
4. Schema change = edit `prisma/schema.prisma` + run `db:push`
5. Products come from `src/data/products.js` — catalog change = edit file + `npm run seed`
6. Documentation files are in `docs/`

---

## Detailed Documentation
- `docs/PROJECT.md` — project overview
- `docs/ARCHITECTURE.md` — architecture and diagrams
- `docs/DATABASE.md` — full schema
- `docs/API.md` — endpoints and bot flow
