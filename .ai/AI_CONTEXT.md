# AI_CONTEXT.md — PetLand
> این فایل را در شروع هر چت جدید بخوان. حافظهٔ پروژه است تا کار در پنجرهٔ دیگر ادامه پیدا کند.

---

## وضعیت همین الان (۱۴۰۵/۰۶/۰۶)

کیف پول اعتباری همکار در پنل فروشگاه: «📒 کیف پول اعتباری» فقط موجودی + قانون؛ «📋 دفتر تراکنش‌ها» دکمه جدا. موجودی فیلد جدا نیست = SUM از `CreditTransaction`. متن: «اعتبار این کیف پول فقط برای استفاده از خدمات مجاز پلتفرم قابل استفاده میباشد.» با `Wallet` بازاریابی مادر قاطی نشود. ردیف دفتر UPDATE/DELETE نمی‌شود.

Payment Engine فاکتور خدمات: پیش‌فاکتور پیش‌فرض تماماً نقدی است. دکمه «💳 استفاده از اعتبار کیف پول» پیش‌فاکتور را با کسر اعتبار تا سقف فاکتور دوباره نشان می‌دهد (نقدی / اعتباری / ترکیبی). با «تایید پیش فاکتور» فاکتور صادر می‌شود؛ اعتبار فوراً قطعی نمی‌شود: `CREDIT_RESERVE` منفی (Available→Reserved). اگر نقدی مانده، مثل سبد مادر اسکرین‌شات می‌خواهد و نوتیف به ادمین مادر می‌رود. اگر نقدی صفر باشد مستقیم `WAITING_APPROVAL`. تایید موجود (`approveInvoice`) رزرو را Consumed می‌کند (`CREDIT_RELEASE` + `SERVICE_PAYMENT`). رد موجود رزرو را Refunded می‌کند. پنل ادمین «فاکتور خدمات همکاران» در این فاز عوض نشد.

کمپین طلایی با اولین تبدیل به همکار (`ColleagueGoldenPeriod.startedAt`). چهار مقدار از پنل ادمین مادر → «⚙️ تنظیمات ساخت اعتبار» (`CreditCampaignSettings`) برای **فاکتورهای جدید همه همکاران** (قدیمی و جدید) زنده اعمال می‌شود: ساعات پنجره از `startedAt + goldenHours`، سقف و درصد ویژه/عادی از تنظیمات فعلی. `startedAt` عوض نمی‌شود. ادمین مادر (`ADMIN`) هم همکار خریدار است: قیمت عمده، شروع گلدن، ساخت اعتبار. ملاک پنجره زمان ارسال اسکرین‌شات (`OrderReceipt.uploadedAt`) است. اعتبار هنگام تایید فاکتور **کالای مادر** ساخته می‌شود. **فقط `PL-`**؛ فاکتور خدمات `SI-` اعتبار نمی‌سازد.

ساخت ربات: هر فروشگاه یک ربات + فاکتور راه‌اندازی INITIAL باید توسط ادمین مادر `APPROVED` باشد. تا تایید، توکن گرفته نمی‌شود.

خرید اشتراک: تا آخرین فاکتور خدمات `APPROVED` یا `REJECTED` نشود اشتراک جدید صادر نمی‌شود (`WAITING_PAYMENT` / `WAITING_APPROVAL` قفل است). رد ادمین مادر از «فاکتور خدمات همکاران» با `REJECTED` (نه `approveOrder`). فاکتور بعدی همان `periodStart`/`periodEnd` فاکتور ردشده را می‌گیرد؛ `lastPeriodEnd` فقط فاکتورهای `APPROVED` است. ثبت/رسید فاکتور خدمات از ربات تننت با `notifyMother` به ادمین مادر می‌رسد. تایید/رد همان فاکتور و نوتیف افزایش اعتبار خرید همکار با `notifyShop` روی ربات فروشگاه همکار می‌رود (اگر ربات فروشگاه نباشد، مادر). در ربات تننت دکمه «ارسال رسید» روی فاکتور خدمات نباید به رسید سفارش فروشگاه (`promptReceipt`) برود.

منوی پنل ادمین مادر و پنل ادمین فروشگاه همکار: دو دکمه در هر ردیف. دکمه پکیج مادر: «🛠 تغییر پکیج های خدماتی». پنل تننت: «⚙️ تنظیمات فروشگاه» زیرمنوی لوگو/مشخصات/خوش‌آمد/راهنما/کارت/دسته/کالا؛ «🧾 سفارش‌های مشتریان». سفارشات بسته اینلاین حداکثر ۱۰ تا + «ده سفارش قبلی».

روی `Order` موقع استارت ALTER نزن. توکن را لاگ نکن. روی شل زنده لیارا `prisma generate` نزن.

---

## این پروژه چیست؟
فروشگاه روی **پیام‌رسان بله** (نه وب، نه تلگرام). UI کیبورد فارسی بله است.

```
 Shared Bot Engine  (یک پروسه Node)
              │
      ┌───────┼───────┐
      ▼       ▼       ▼
   Mother   Bot A   Bot B
  (پت‌لند)  (کلینیک) (پت‌شاپ)
```

---

## Tech
Node CommonJS، Express 5 (health)، Prisma 6، PostgreSQL لیارا، long polling `tapi.bale.ai`.

---

## Tenant — سه لایه

1. **Tenant** — برند، نوع، وضعیت، مالک، آدرس/پیج
2. **Bot** — توکن رمزشده، `ACTIVE` + `isEnabled` برای poll. توکن مادر فقط `BOT_TOKEN` است
3. **TenantSettings** — نام، خوش‌آمد، کارت، لوگو (`logoFileId` runtime ALTER)، آدرس، ساعات، متن راهنما

کاتالوگ مادر: `motherCatalogWhere()`. تننت: `Product.tenantId`. دسته: `Category.tenantId`.

سبد تننت: جداول `ShopCart` / `ShopCartItem` با SQL در runtime — **مدل Prisma ندارند**. `Cart` مادر دست نخورد.

سفارش تننت: `TS-` + `Order.tenantId`. مادر فقط `PL-`. فاکتور خدمات: `SI-`.

کیف پول اعتباری: `CreditWallet` (tenantId و/یا userId) + دفتر `CreditTransaction`. `Wallet` مادر = پورسانت بازاریابی قابل برداشت؛ جدا بماند.

---

## Engine

- `index.js`: اول `engine.start()` (poll)، بعد `ensureMotherCatalog()` سپس ensure پکیج/فاکتور خدمات/دفتر اعتبار/کمپین طلایی
- تننت‌ها poll هستند؛ قبل از poll `deleteWebhook` با توکن همان ربات
- `getUpdates(offset, ctx.token)` — توکن را صریح بده
- بعد از `getOrCreateUser` دوباره `runWithContext(ctx)` وگرنه پاسخ تست با توکن مادر می‌رود
- `router.js` تننت را **lazy** `require('./tenantShop')` می‌کند تا خطای لود مادر را نخواباند
- روی جدول `Order` موقع استارت `ALTER` نزن (قفل → هر دو ربات ساکت)

---

## فایل‌ها

```
src/bot/engine.js                 poll + processUpdate(update, ctx)
src/handlers/router.js            مادر vs تننت
src/handlers/tenantShop.js        منوی فروشگاه همکار
src/handlers/tenantOrder.js       سبد/تسویه/رسید/پیگیری مالک
src/handlers/tenantAdmin.js       پنل مالک + کیف اعتبار + دفتر
src/services/shopCart.js          SQL خام
src/services/shopProvision.js     جدول‌های runtime + گیت فاکتور راه‌اندازی
src/services/creditLedger.js      دفتر اعتبار (بدون فیلد موجودی)
src/services/goldenCampaign.js    کمپین طلایی + CreditCampaignSettings
src/handlers/adminCreditSettings.js تنظیمات ساخت اعتبار ادمین مادر
src/handlers/products.js          مادر + showTenantProducts
src/services/servicePackages.js   جدول و seed پکیج خدمات
src/handlers/adminServices.js     CRUD پکیج + تایید/رد فاکتور خدمات (sinv:)
src/handlers/colleague.js         پروفایل همکار، گیت ساخت ربات، شروع گلدن
src/handlers/serviceBilling.js    اشتراک → پیش‌فاکتور → فاکتور → رسید؛ نوتیف مادر با BOT_TOKEN
src/services/serviceInvoices.js   snapshot قیمت؛ WAITING_PAYMENT / WAITING_APPROVAL / APPROVED / REJECTED
src/bot/messenger.js              notifyMother با توکن مادر
src/keyboards/menus.js            همه دکمه‌ها
```

منوی تننت: محصولات، سبد، سفارشات من، راهنما. مالک: مدیریت فروشگاه.
سفارش‌های مشتریان: «سفارشات باز» / «سفارشات بسته». باز = همه جز `REJECTED` و `SHIPPED`. بسته = ۱۰تایی اینلاین + `tcld:` ده سفارش قبلی.
محصولات تننت: **همیشه اول دسته‌ها**، بعد اینلاین ۱۰تایی.

قدم‌های تننت: `TSC:` دسته، `TCK:` تسویه/رسید، `TS:` پنل مالک، `TS:SETTINGS` تنظیمات فروشگاه، `TS:CREDIT` / `TS:CREDIT_LEDGER`، `TS:SUB:` خرید اشتراک، `TS:SINV:` لیست/جزئیات فاکتور خدمات.

گیت ساخت ربات: `gateShopBotCreate` + `provisionShop` (`NEED_SETUP_INVOICE` / `NEED_APPROVED_SETUP` / `ALREADY_HAS_BOT`).
تایید فاکتور خدمات مادر: «فاکتور خدمات همکاران» (`sinv:` تایید/رد). با `approveOrder` قاطی نشود. رسید خدمات با توکن مادر به ادمین مادر می‌رسد نه ربات تننت.

کمپین طلایی: رسید داخل پنجره زنده = سهم تا سقف تنظیم‌شده با درصد ویژهٔ فعلی؛ مازاد و رسید بعد از پنجره = درصد عادی فعلی. تایید دیر ادمین پنجره را خراب نمی‌کند. روی `Order` ستون نساز. ادمین مادر هم اعتبار همکار می‌گیرد.

انواع دفتر: `GOLDEN_REWARD` پاداش دوره طلایی، `PURCHASE_REWARD` پاداش خرید استاندارد، `CREDIT_RESERVE` رزرو، `CREDIT_RELEASE` آزادسازی رزرو، `SERVICE_PAYMENT` مصرف قطعی، `REFUND` بازگشت اعتبار.

---

## قوانین چت بعد

1. مادر (سبد، تسویه، ادمین، عمده) را نشکن.
2. تننت درخت پت‌لند / همکار / ادمین مادر را نبیند.
3. اول `module.exports = function` بعد export کمکی در products.js.
4. روی شل زنده لیارا `prisma generate` نزن.
5. کاتالوگ مادر با `motherCatalogWhere`. select صریح.
6. توکن را لاگ نکن.
7. اسکیما additive. ShopCart را به Prisma برنگردان مگر db:push در دسترس باشد.
8. `setWebhook` و `getUpdates` روی یک توکن همزمان نه.
9. سفارش تننت `TS-`؛ مادر `PL-`؛ خدمات `SI-`.
10. موجودی اعتبار را در فیلد جدا ذخیره نکن؛ از Ledger جمع بزن. ردیف دفتر را UPDATE/DELETE نکن.
11. از فاکتور خدمات اعتبار نساز.

---

## کار بعدی
1. پنل ادمین مادر: فاکتور خدمات همکاران با جزئیات نقد/اعتبار و رد با علت
2. ادمین مادر: خاموش/روشن Bot، TenantMessage
3. TENANT_RESELL
4. تیکت داخل ربات تننت

`.ai/CURRENT_STATUS.md` و `ROADMAP.md` مال v22 تکی‌اند و قدیمی‌اند. منبع حقیقت همین فایل است.
