# ROADMAP.md — PetLand v22

> **منبع حقیقت multi-tenant:** `.ai/AI_CONTEXT.md`. این فایل مال فروشگاه تکی v22 است.

## Current Status
The core bot functionality is complete. Priorities below are based on identified gaps in the source code.

---

## High Priority (Critical)

### 1. Persian PDF Invoice
- **Why:** PDFKit does not render Persian text correctly (characters are not connected)
- **Work:** Replace with `pdfmake` (RTL support) — requires `npm install pdfmake`, run locally, commit new `package-lock.json`
- **Note:** Previous attempt failed due to Liara timeout (npm install without lock file)

### 2. Prisma Migration Files
- **Why:** Currently only `db:push` is used — no DB change history or rollback possible
- **Work:** Migrate to `prisma migrate dev` and maintain migration files

### 3. Error Handling Improvement
- **Why:** A crash in the polling loop takes the entire bot offline
- **Work:** try/catch in polling loop, graceful restart, structured logging

---

## Medium Priority

### 4. Webhook Implementation
- **Why:** Long polling requires a persistent process — webhook is more reliable
- **Work:** Activate `src/bot/webhook.js` and connect to Express router

### 5. Remove Unused Dependency
- **Why:** `axios` is installed but not used
- **Work:** `npm uninstall axios`

### 6. Rate Limiting
- **Why:** No limit on the number of incoming messages per user
- **Work:** Per-user request rate limiting

---

## Low Priority (Nice to Have)

### 7. Automated Tests
- **Why:** No tests exist
- **Work:** Unit tests for `utils/price.js`, `utils/order.js`, mock Bale API

### 8. Dockerfile / Docker Compose
- **Work:** Containerization for consistent deployment

### 9. PM2 Config
- **Work:** `ecosystem.config.js` for automatic restart on crash

### 10. Admin Command for profitPercent Change
- **Why:** Currently only possible via direct DB access
- **Work:** Add admin command like `JMK-001 PROFIT 25` in `handleAdmin`

### 11. Colleague Code Security
- **Why:** Single shared code for all colleagues — revoking one colleague is not possible
- **Work:** Per-colleague unique codes or whitelist system

### 12. Structured Logging
- **Work:** Integration with a logging service (e.g. structured `console.log` or Sentry)

---

## Unknown Priority

| Item | Notes |
|------|-------|
| Online payment gateway | Replacement or complement for manual payment |
| Coupon / discount system | Unknown — needs analysis |
| Multi-language support | Unknown |
