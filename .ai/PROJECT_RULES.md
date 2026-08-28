# PROJECT_RULES.md — PetLand v22

## Development Rules

### Language
- Programming language: **JavaScript (CommonJS)**
- TypeScript is not used
- All user-facing text: **Persian (Farsi)**
- Variable, function, and file names: **English**

### Module System
- Module system: **CommonJS** (`require` / `module.exports`)
- `"type": "commonjs"` is set in `package.json`
- Do not use `import/export`

### Database
- All schema changes go through `prisma/schema.prisma`
- Run `npm run db:push` to sync schema
- Migration files are not created (a deliberate project decision)
- Seed data is sourced from `src/data/products.js`

### Bale Bot
- All Bale communication goes through `src/bot/bale.js`
- Long polling is active — Webhook is not implemented
- Use reply helpers from `src/bot/messenger.js` for sending messages
- Delete previous bot message before sending a new one (clean UX)

### Handlers
- Each handler must own a single, independent business domain
- Routing happens only in `src/handlers/router.js`
- User conversation state is managed via `orderStep` and `adminStep`

### Keyboard / UI
- All keyboard buttons are defined in `src/keyboards/menus.js`
- Button text is in Persian with emoji

### Pricing
- Prices are always stored in **Toman** (integer)
- Price calculation only via `src/utils/price.js`
- Wholesale price = `costPrice` (no markup)
- Retail price = `costPrice * (1 + profitPercent/100)`

### Admin
- Admin IDs are defined in the `ADMIN_BALE_IDS` env variable
- Admin role is assigned during `getOrCreateUser`
- There is no way to elevate a role through the bot (except Colleague)

### Security
- `BOT_TOKEN` and `DATABASE_URL` must never be hardcoded
- Sensitive variables only in `.env` (which must be in `.gitignore`)
- No sensitive information in logs
- Multi-tenant isolation: never query/update Order, Product, Category, ShopCart, ServiceInvoice, or CreditWallet across shops. Tenant queries require `ctx.tenantId`. Do not create `TS-` orders without `tenantId`. Do not fall back to unscoped `{ code }` / `{ title }` / `{ trackingCode startsWith TS- }`. See `.ai/AI_CONTEXT.md` Isolation.

### Deployment
- Use `npm run build` for Liara (with Iran mirror)
- Execution order: `build` → `db:push` → `seed` → `start`
- Service must run as a persistent process (long polling)

### Dependencies
- Verify a real need exists before adding a new package
- `axios` is unused and should be removed
- Prefer `node-fetch` (already installed) for HTTP calls

---

## AI / Agent Rules

- Do not modify any source file without an explicit instruction
- If information is not extractable from source, write `Unknown`
- Generate documentation from actual source, not assumptions
- Prisma schema changes must be fully coordinated
- Re-seeding data may overwrite existing records
