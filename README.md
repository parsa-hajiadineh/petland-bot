# PetLand Bot

A shopping bot for pet products built on the [Bale](https://bale.ai) messaging platform — an Iranian messenger with a Telegram-compatible API. The entire user interface is driven by bot keyboards inside Bale; there is no web frontend.

## Features

- **Product catalog** — 130+ products across 14+ categories with photo support
- **Shopping cart** — add items, review cart, and proceed to checkout
- **Multi-step checkout** — 7-step order form with saved delivery addresses (up to 3 per user)
- **Manual payment** — card-to-card or IBAN wire transfer with receipt upload and admin verification
- **Order tracking** — unique tracking codes in `PL-YYYYMMDD-####` format, full order lifecycle management
- **Wholesale mode** — separate pricing tier for registered colleague accounts
- **Admin panel** — order approval/rejection, shipment dispatch (Snapp or Post), PDF invoice generation
- **Support tickets** — in-bot customer support ticket system
- **Referral & wallet** — referral deep links, 5% commission on approved orders, withdrawal requests
- **Monthly sales reports** — admin-accessible archive for up to 6 months

## Screenshots

| Main Menu | Product Catalog | Order Tracking |
|-----------|----------------|----------------|
| ![Main Menu](docs/assets/screenshot-menu.png) | ![Products](docs/assets/screenshot-products.png) | ![Order](docs/assets/screenshot-order.png) |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (CommonJS) |
| HTTP | Express 5 (health check only) |
| Database | PostgreSQL + Prisma 6 ORM |
| Messaging | Bale Bot API (long polling) |
| PDF | PDFKit |
| Deployment | Liara (Iranian PaaS) |

## Installation

```bash
# Install dependencies
npm install

# Copy and configure environment variables
cp .env.example .env

# Generate Prisma client
npm run build

# Push schema to the database
npm run db:push

# Seed the product catalog
npm run seed

# Start the bot
npm start
```

For local development with auto-reload:

```bash
npm run dev
```

## Environment Variables

See [`.env.example`](.env.example) for the full list. Key variables:

| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | Bale bot token *(required)* |
| `DATABASE_URL` | PostgreSQL connection string *(required)* |
| `ADMIN_BALE_IDS` | Comma-separated Bale user IDs with admin access |
| `COLLEAGUE_ACCESS_CODE` | Access code for wholesale (colleague) mode |
| `MARKETING_ACCESS_CODE` | Code to unlock marketing and wallet features |
| `DEFAULT_PROFIT_PERCENT` | Retail markup over cost price (default: `15`) |
| `WHOLESALE_MIN_ORDER` | Minimum wholesale order in Toman (default: `10000000`) |
| `BANK_CARD` | Bank card number for manual payments |
| `BANK_IBAN` | Bank IBAN for wire transfers *(optional)* |
| `BANK_HOLDER` | Account holder name |
| `BANK_NAME` | Bank name |
| `BOT_USERNAME` | Bot username without `@` (used for referral links) |
| `SHOP_NAME` | Shop display name (default: `پت لند`) |

## Project Structure

```
src/
├── index.js                 # Entry point (Express + polling loop)
├── config/index.js          # Environment variable loader
├── database/prisma.js       # Prisma client singleton
├── bot/
│   ├── bale.js              # Bale API client
│   └── messenger.js         # Reply helper functions
├── handlers/
│   ├── router.js            # Message dispatcher
│   ├── start.js             # Main menu
│   ├── products.js          # Product browsing and add-to-cart
│   ├── cart.js              # Cart view
│   ├── order.js             # Checkout, receipts, and order tracking
│   ├── admin.js             # Admin panel and order management
│   ├── colleague.js         # Wholesale mode
│   ├── support.js           # Support ticket system
│   ├── marketing.js         # Referral system
│   └── wallet.js            # Wallet, withdrawals, and commission history
├── keyboards/menus.js       # Bot keyboard definitions
├── utils/
│   ├── price.js             # Retail and wholesale price calculation
│   ├── order.js             # Tracking code generation
│   └── invoice.js           # PDF and text invoice builder
├── data/products.js         # Static product catalog (~130+ items)
└── seed.js                  # Database seeder
prisma/
└── schema.prisma            # Database schema
```

## License

[MIT](LICENSE)
