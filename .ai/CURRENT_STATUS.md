# CURRENT_STATUS.md — PetLand

> **منبع حقیقت multi-tenant:** `.ai/AI_CONTEXT.md` را بخوان. این فایل مال فروشگاه تکی v22 است و برای ربات همکار / کیف اعتبار / کمپین طلایی / فاکتور خدمات به‌روز نیست.

## Overall Status
مادر روی لیارا جواب می‌دهد. ربات تست تا فیکس `QTY_STEP` در `tenantOrder.js` روی `/start` خطا می‌داد («فروشگاه الان پاسخ نداد»). بعد از دپلوی آن فیکس باید خوش‌آمد فروشگاه بیاید.

---

## Implemented Features ✅

| Feature | Status |
|---------|--------|
| Bale message polling (long polling) | ✅ Complete |
| Main menu and navigation | ✅ Complete |
| Product category listing | ✅ Complete |
| Product detail view + photo | ✅ Complete |
| Shopping cart (add, view) | ✅ Complete |
| Order form (7 steps) | ✅ Complete |
| Saved addresses at checkout (max 3) | ✅ Complete |
| Manual card-to-card + IBAN payment | ✅ Complete |
| Payment receipt upload | ✅ Complete |
| Order detail view with tracking code | ✅ Complete |
| Resume payment for WAITING_PAYMENT orders | ✅ Complete |
| Admin notification on new order | ✅ Complete |
| callback_query handling (inline buttons) | ✅ Complete |
| Admin panel — order management | ✅ Complete |
| Order approval / rejection by admin | ✅ Complete |
| Order shipment (Snapp or Post) | ✅ Complete |
| PDF invoice sent to admin on approval | ✅ Complete |
| Monthly sales stats in admin panel (6 months) | ✅ Complete |
| Support ticket management | ✅ Complete |
| Colleague (wholesale) mode | ✅ Complete |
| Product seed (~130+ items) | ✅ Complete |
| Health check endpoint | ✅ Complete |
| Marketing system and referral link (behind access code) | ✅ Complete |
| Referrer registration for new users (deep link) | ✅ Complete |
| User wallet (behind access code) | ✅ Complete |
| 5% commission to referrer on order approval | ✅ Complete |
| Wallet withdrawal request | ✅ Complete |
| Withdrawal request management in admin panel | ✅ Complete |
| Withdrawal tracking code notification to user | ✅ Complete |
| Automatic previous message deletion (clean chat) | ✅ Complete |
| `/start ref_xxx` referral deep link support | ✅ Complete |

---

## Incomplete / Partial ⚠️

| Item | Notes |
|------|-------|
| Persian PDF invoice | PDFKit does not render Persian correctly — needs pdfmake or puppeteer |
| PDF to customer | PDF invoice only goes to admin |
| Webhook | `src/bot/webhook.js` exists but is a stub |
| `axios` | present in `package.json` but not used |
| `profitPercent` change | only possible via direct DB access |

---

## Missing ❌

| Item | Priority |
|------|---------|
| `.gitignore` | High — risk of pushing `.env` |
| `README.md` | Medium |
| Prisma migration files | High — rollback not possible |
| Automated tests | High |
| Rate limiting | Medium |
| Structured logging | Medium |

---

## File Statistics

| Stat | Value |
|------|-------|
| Source files | **30 files** |
| DB models | **12 models** |
| Product catalog | **~130+ items in 14+ categories** |
| Environment variables | **14 variables** |
