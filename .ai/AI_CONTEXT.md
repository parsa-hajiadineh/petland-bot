# AI_CONTEXT.md — PetLand
> این فایل را در شروع هر چت جدید بخوان. حافظهٔ پروژه است تا کار در پنجرهٔ دیگر ادامه پیدا کند.

---

## این پروژه چیست؟
فروشگاه روی **پیام‌رسان بله** (نه وب، نه تلگرام وب). UI فقط کیبورد فارسی بله است.

الان از یک ربات تکی به این مدل رفته:

```
 Shared Bot Engine  (یک پروسه Node)
              │
      ┌───────┼───────┐
      ▼       ▼       ▼
   Mother   Bot A   Bot B   …
  (پت‌لند)  (کلینیک) (پت‌شاپ)
```

کد فروشگاه **یکی** است. هر ربات فقط `runtime context` خودش را می‌گیرد.

---

## Tech stack
- Node.js **CommonJS** + Express 5 (فقط health)
- PostgreSQL + Prisma 6
- Bale long polling (`tapi.bale.ai`)
- دیپلوی: **Liara**

---

## تنظیمات Tenant — لیست واقعی (نه مثال)

سه لایه جدا، قاطی‌شان نکن:

### 1) `Tenant` — هویت فروشگاه / همکار
مالک و مشخصات کسب‌وکار (از فرم همکار پر می‌شود):

| فیلد | نقش |
|------|------|
| `id` | tenant_id |
| `name` | نام برند |
| `type` | CLINIC / VET / PET_SHOP / ONLINE_SHOP / OTHER |
| `status` | PENDING / ACTIVE / SUSPENDED / INACTIVE — موتور فقط `ACTIVE` را poll می‌کند |
| `ownerName`, `phone` | صاحب |
| `address` / `pageName`+`pageDetails` | حضوری یا صفحه آنلاین |
| `province`, `city`, `postalCode`, `nationalId`, `description` | رزرو |

### 2) `Bot` — هویت ربات بله
یک Tenant = حداکثر یک Bot (`tenantId` unique):

| فیلد | نقش |
|------|------|
| `id` | botId در runtime |
| `token` | AES-256-GCM (هرگز لاگ نشود) |
| `tokenHash` | یکتایی توکن |
| `username`, `baleBotId` | از `getMe` |
| `status` + `isEnabled` | موتور: `ACTIVE` و `isEnabled=true` |
| `activatedAt`, `lastSeenAt` | heartbeat حدود هر ۶۰ ثانیه |

توکن مادر در env است (`BOT_TOKEN`)، در جدول `Bot` نیست.

### 3) `TenantSettings` — ظاهر و پرداخت ربات
این همان چیزی است که Engine موقع پاسخ به مشتری می‌خواند:

| فیلد | نقش |
|------|------|
| `shopName` | نام نمایشی (fallback: `Tenant.name`) |
| `welcomeMessage` | متن خوش‌آمد سفارشی |
| `supportPhone` | راهنما |
| `bankCard`, `bankIban`, `bankHolder`, `bankName` | کارت‌به‌کارت تننت در تسویه همین ربات |
| `profitPercent` | سود فروش کالاهای پت‌لند روی ربات تننت (فاز بعد) |
| `minOrderAmount` | حداقل سفارش |

`logoFileId` در اسکیما **هنوز نیست**؛ در runtime از `settings.logoFileId` خوانده می‌شود و فعلاً `null` است. ستون را وقتی پنل تنظیمات لوگو ساخته شد اضافه کن.

### 4) کاتالوگ (جدا از settings)
| منبع | معنی |
|------|------|
| `catalogMode = MOTHER` | ربات مادر: درخت دسته/برند پت‌لند |
| `catalogMode = TENANT_OWN` | ربات تننت: فقط `Product.tenantId = این tenant` |
| `TenantProduct` | فروش مجدد SKU پت‌لند با قیمت تننت — **هنوز استفاده نشده** |
| `Category.tenantId` | دستهٔ اختصاصی همان فروشگاه همکار |

کالای کلینیک **نباید** در منوی پت‌لند دیده شود. کوئری‌های مادر با `motherCatalogWhere()` فیلتر می‌شوند (`tenantId` مادر یا `null`).

سبد تننت جدول جداست (`ShopCart` / `ShopCartItem`) که در runtime ساخته می‌شود و با SQL خام خوانده می‌شود — داخل schema Prisma نیست تا Client مادر به جدول جدید وابسته نشود. `Cart` مادر دست نخورده می‌ماند.

سفارش تننت: `Order.tenantId` + `botId`، کد پیگیری `TS-YYYYMMDD-XXXX`. مادر فقط `PL-` را در فاکتور/آمار/سفارشات من می‌بیند.

### 5) پیام‌ها
| منبع | معنی |
|------|------|
| `TenantSettings.welcomeMessage` | کپی داخل ربات فروشگاه |
| `TenantMessage` | پیام مادر → تننت (پنل مادر، فاز بعد) |

### Runtime object (`src/bot/context.js`)
هر آپدیت داخل `AsyncLocalStorage` این را دارد:

```
isMother, tenantId, botId, token, catalogMode
identity  { tenantId, botId, name, username }
branding  { name, welcomeMessage, supportPhone, logoFileId }
payment   { bank{card,iban,holder,name}, profitPercent, minOrderAmount }
+ alias تخت: name, username, welcomeMessage, supportPhone, bank, …
```

## ساخت خودکار فروشگاه (وقتی Token ارسال شد)

```
Token → Validate → Ensure Tenant → Create Bot → Load Default Settings
      → Set Webhook (یا Poll) → Activate
```

کد: `src/services/shopProvision.js`

- پروفایل همکار باید از قبل Tenant را ساخته باشد (نام برند، تلفن، آدرس/پیج). بعد از پروفایل، همان لحظه توکن خواسته می‌شود.
- Validate: `getMe` — توکن مادر و توکن تکراری رد می‌شوند.
- Default settings: `shopName`, `welcomeMessage`, `supportPhone`, `profitPercent`.
- Webhook: مسیر `/webhook/bot/:botId` هست؛ فعلاً تننت‌ها **long polling** می‌شوند (`deleteWebhook` + `getUpdates`) تا اگر `PUBLIC_BASE_URL` به بله نرسد ربات ساکت نماند.
- مادر همیشه long polling است.
- پیام تحویل: «فروشگاه آماده است، @username را /start کنید».

---

## فایل‌های Engine

```
src/index.js              Express + /webhook/bot/:botId + engine.start()
src/bot/engine.js         poller مادر + poll یا webhook تننت
src/bot/context.js        ALS + تنظیمات runtime
src/bot/bale.js           API بله با توکن context + setWebhook
src/services/shopProvision.js  Validate → Bot → Settings → Webhook → Activate
src/handlers/router.js    اگر !isMother() → tenantShop
src/handlers/tenantShop.js فروشگاه تننت (کاتالوگ + سبد + تسویه)
src/handlers/tenantOrder.js سبد/تسویه/رسید/پیگیری تننت + فاکتور مالک
src/handlers/tenantAdmin.js پنل مدیریت فروشگاه همکار
src/services/shopCart.js     سبد جدا per tenant
src/handlers/colleague.js پروفایل همکار + توکن → provisionShop
src/handlers/products.js  کاتالوگ مادر (فیلتر شده) + showTenantProducts
src/utils/tokenCrypto.js  encrypt / decrypt / hash
src/database/prisma.js    ensureMotherCatalog + getMotherTenantId()
```

مادر: handlerهای قبلی (سبد، سفارش، ادمین، همکار، بازاریابی) دست نخورده می‌مانند.
تننت: منوی `tenantMainMenu` — محصولات، سبد، سفارشات من، راهنما. مالک **⚙️ مدیریت فروشگاه** و **🧾 سفارش‌های فروشگاه** هم دارد. پرداخت از کارت `TenantSettings` است، نه `BANK_*` مادر.

---

## چه چیزی کار می‌کند (نشکن)

### ربات مادر
- دسته → برند → لیست اینلاین ۱۰تایی → جزئیات (عکس با fallback متن) → سبد → تسویه / رسید
- پاک کردن همهٔ پیام‌های اینلاین با برگشت / منو / محصولات / سبد / جستجو / راهنما / پشتیبانی / سفارش‌ها
- `select` صریح روی Product
- ادمین نباید دکمهٔ منوی اصلی را به‌عنوان کد سفارش قورت بدهد
- همکار: کد دسترسی → نام، تلفن، برند، آنلاین/حضوری/هر دو → تأیید → `Tenant` (اگر ستون `ownerUserId`/`pageName` روی لیارا نباشد، بدون آن‌ها ذخیره و با TenantMember وصل می‌شود) + Customer + TenantSettings + TenantMember OWNER
- بعد از تأیید موفق، همان لحظه توکن BotFather خواسته می‌شود
- ارسال Token باید همیشه جواب داشته باشد (در حال بررسی / نامعتبر / آماده تحویل). اگر جدول `Bot` روی لیارا نبود، ساخته می‌شود
- `🤖 ساخت ربات فروشگاهی` → اگر Tenant باشد توکن؛ وگرنه پروفایل → توکن → `provisionShop`
- `loadProductByCode` باید **بعد از** `module.exports = async function productsHandler` ست شود

### تننت
- بعد از Token، فروشگاه با تنظیمات پیش‌فرض فعال می‌شود (webhook یا poll)
- `/start` با `shopName` / `welcomeMessage` / لوگو / آدرس / ساعات اگر تنظیم شده باشند
- مالک: پنل مدیریت داخل همان ربات — مشخصات، لوگو، پیام خوش‌آمد، **متن راهنما**، کارت بانکی، دسته (افزودن/حذف)، کالا
- ستون `Product.tenantId` اگر روی لیارا نباشد در استارت با ALTER اضافه می‌شود؛ بدون آن کالا ثبت و خوانده نمی‌شود
- دکمه **محصولات** همیشه اول دسته‌بندی‌ها را نشان می‌دهد (حتی اگر یک دسته باشد)؛ بعد از انتخاب دسته، کالاها اینلاین ۱۰تایی
- سبد جدا (`ShopCart`) → تعداد → تسویه آدرس → کارت همان فروشگاه → رسید → اطلاع به مالک
- مشتری: **سفارشات من** فقط `TS-` همین فروشگاه. مالک: تایید / رد / بسته‌بندی / ارسال
- جداول `ShopCart` / `ShopCartItem` اگر روی لیارا نباشند در `ensureShopRuntimeTables` ساخته می‌شوند. مدل Prisma برایشان نیست؛ `db:push` برای سبد لازم نیست.

---

## Liara / Prisma — حیاتی

- **هرگز** داخل کانتینر در حال اجرا `prisma generate` نزن → `EROFS` روی `node_modules`.
- Generate فقط در **build**: `"build": "prisma generate"`.
- `db:push` از **کنسول اپ لیارا** (`petshop-db`). ویندوز به هاست داخلی نمی‌رسد.
- آینهٔ مرده `prisma.storage.iran.liara.site` استفاده نشود.
- بعد از تغییر اسکیما: `db:push` روی لیارا، بعد **redeploy**.

---

## Env

```
BOT_TOKEN
BOT_TOKEN_ENCRYPTION_KEY   # برای decrypt توکن تننت؛ بی‌دلیل عوض نکن
DATABASE_URL
ADMIN_BALE_IDS
COLLEAGUE_ACCESS_CODE
MARKETING_ACCESS_CODE
DEFAULT_PROFIT_PERCENT
WHOLESALE_MIN_ORDER
BANK_*   SHOP_NAME   BOT_USERNAME
PUBLIC_BASE_URL            # مثلا https://YOUR-APP.liara.run — اگر خالی باشد تننت‌ها poll می‌شوند
```

---

## محدودیت session کاربر

`User.baleId` سراسری است. یک نفر در مادر و ربات کلینیک **یک ردیف User** دارد (`orderStep`, `pendingOrderId`). سبدها جدا هستند (`Cart` مادر / `ShopCart` تننت). قدم‌های تننت با پیشوند `TCK:` / `TSC:` / `TS:` هستند تا با checkout مادر قاطی نشوند؛ اگر وسط ثبت سفارش بین دو ربات جابه‌جا شود ممکن است state تداخل کند.

---

## کار بعدی (انجام نشده)

1. اشتراک ماهانه + تخفیف حجمی خرید از مادر
2. ادمین مادر: خاموش/روشن کردن Bot، پیام به تننت‌ها (`TenantMessage`)
3. حالت `TENANT_RESELL` از روی `TenantProduct` (اختیاری)
4. تیکت پشتیبانی داخل ربات تننت

---

## قوانین برای چت بعدی

1. فروشگاه مادر (سبد، تسویه، ادمین، عمده) را نشکن.
2. ربات تننت هرگز درخت محصول / منوی همکار / ادمین پت‌لند را نبیند.
3. اول `module.exports = function`، بعد exportهای کمکی (`loadProductByCode`, `clearProductListMessages`, …).
4. روی شل زندهٔ لیارا `prisma generate` نزن.
5. کاتالوگ مادر را با `motherCatalogWhere` فیلتر کن. سبد/سفارش/فاکتور ادمین هم `select` صریح بدون `tenantId` (`src/database/selects.js`).
6. توکن ربات را لاگ نکن.
7. اسکیما را additive نگه دار مگر اینکه صریحاً خواسته شود.
8. `setWebhook` و `getUpdates` روی یک توکن همزمان استفاده نشود.
9. سفارش تننت کد `TS-` دارد؛ فاکتور/آمار/رسید مادر فقط `PL-` را لمس کند.

---

## Docs دیگر
- `.ai/CURRENT_STATUS.md` و `ROADMAP.md` مربوط به v22 تکی هستند و **قدیمی‌اند**؛ این فایل منبع حقیقت است.
- `docs/DATABASE.md` اسکیما را تا حدی پوشش می‌دهد.
