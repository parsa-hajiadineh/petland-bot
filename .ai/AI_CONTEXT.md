# AI_CONTEXT.md — PetLand
> این فایل را در شروع هر چت جدید بخوان. حافظهٔ پروژه است تا کار در پنجرهٔ دیگر ادامه پیدا کند.

---

## وضعیت همین الان (۱۴۰۵/۰۶/۰۶ — کمپین ۴۸ساعته طلایی)

کیف پول اعتباری: موجودی از جمع دفتر `CreditTransaction`. در پنل فروشگاه دکمه «کیف پول اعتباری» فقط موجودی و قانون را نشان می‌دهد؛ «دفتر تراکنش‌ها» دکمه جدا است. منوی پنل ادمین فروشگاه دو دکمه در هر ردیف.

کمپین طلایی با تبدیل User به همکار شروع می‌شود (`ColleagueGoldenPeriod`): ۴۸ ساعت، سقف خرید ۱۰ میلیون، `golden_multiplier = 5` یعنی اعتبار دوره طلایی ۵ برابر مبلغ (۵۰۰٪). بعد از سقف یا بعد از ۴۸ ساعت: ۱۰٪. ملاک پنجره طلایی زمان ارسال اسکرین‌شات رسید است (`OrderReceipt.uploadedAt`)، نه ثبت سفارش و نه تایید ادمین. اعتبار هنگام تایید فاکتور مادر ساخته می‌شود و روی مجموع خریدهای واجد شرایط حساب می‌شود نه جداگانه برای هر فاکتور.

متن کیف: «اعتبار این کیف پول فقط برای استفاده از خدمات مجاز پلتفرم قابل استفاده میباشد.» با `Wallet` بازاریابی مادر قاطی نشود. ردیف دفتر UPDATE/DELETE نمی‌شود. روی `Order` موقع استارت ALTER نزن. توکن را لاگ نکن.

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

سفارش تننت: `TS-` + `Order.tenantId`. مادر فقط `PL-`.

کیف پول اعتباری تننت: `CreditWallet` (یک فروشگاه = یک کیف) + دفتر `CreditTransaction`. موجودی = SUM مبلغ‌های دفتر. `Wallet` مادر = پورسانت بازاریابی و قابل برداشت است؛ جدا بماند.

---

## Engine

- `index.js`: اول `engine.start()` (poll)، بعد `ensureMotherCatalog()`
- تننت‌ها poll هستند؛ قبل از poll `deleteWebhook` با توکن همان ربات
- `getUpdates(offset, ctx.token)` — توکن را صریح بده
- بعد از `getOrCreateUser` دوباره `runWithContext(ctx)` وگرنه پاسخ تست با توکن مادر می‌رود
- `router.js` تننت را **lazy** `require('./tenantShop')` می‌کند تا خطای لود مادر را نخواباند
- روی جدول `Order` موقع استارت `ALTER` نزن (قفل → هر دو ربات ساکت)

---

## فایل‌ها

```
src/bot/engine.js            poll + processUpdate(update, ctx)
src/handlers/router.js       مادر vs تننت
src/handlers/tenantShop.js   منوی فروشگاه همکار
src/handlers/tenantOrder.js  سبد/تسویه/رسید/پیگیری مالک
src/handlers/tenantAdmin.js  پنل مالک + کیف پول اعتباری
src/services/shopCart.js     SQL خام
src/services/shopProvision.js جدول‌های runtime + گیت فاکتور راه‌اندازی
src/services/creditLedger.js دفتر اعتبار همکار (بدون فیلد موجودی)
src/services/goldenCampaign.js کمپین ۴۸ساعته؛ زمان رسید؛ سقف تجمعی ۱۰M
src/handlers/products.js     مادر + showTenantProducts
src/services/servicePackages.js جدول و seed پکیج خدمات
src/handlers/adminServices.js  ادمین مادر: CRUD پکیج + تایید فاکتور خدمات
src/handlers/colleague.js      پروفایل همکار، گیت ساخت ربات
src/handlers/serviceBilling.js ویزارد پکیج → خدمت → فاکتور
src/services/serviceInvoices.js فاکتور خدمات با snapshot قیمت
```

منوی تننت: محصولات، سبد، سفارشات من، راهنما. مالک: مدیریت فروشگاه + سفارش‌های فروشگاه.
سفارش‌های فروشگاه: اول «سفارشات باز» / «سفارشات بسته». باز = همه جز `REJECTED` و `SHIPPED`. بسته = همان دو وضعیت. لیست اینلاین مثل قبل.
محصولات تننت: **همیشه اول دسته‌ها**، بعد اینلاین ۱۰تایی.

قدم‌های تننت: `TSC:` دسته، `TCK:QTY` تعداد، `TCK:NAME`… تسویه، `TCK:RECEIPT` رسید، `TS:` پنل مالک، `TS:CREDIT` کیف اعتبار، `TS:CREDIT_LEDGER` دفتر.

گیت ساخت ربات: `colleague.gateShopBotCreate` + `provisionShop` (`NEED_SETUP_INVOICE` / `NEED_APPROVED_SETUP` / `ALREADY_HAS_BOT`).
تایید فاکتور خدمات: پنل ادمین مادر → «فاکتور خدمات همکاران» (`sinv:`). دکمه تایید سفارش فروشگاهی (`approveOrder`) را برای این فاکتورها صدا نزن.

کمپین طلایی: با اولین تبدیل به همکار. `multiplier=5` یعنی ۵۰۰٪. سقف ۱۰M روی مجموع مبلغ خریدهایی که رسیدشان داخل ۴۸ ساعت است. تایید دیرهنگام سقف را از بین نمی‌برد. ثبت سفارش در طلایی ولی رسید بعد از آن = ۱۰٪. فاکتور مادر عمده `PL-`؛ سفارش تننت نه. روی `Order` ستون نساز؛ زمان رسید در `OrderReceipt`.

انواع دفتر اعتبار (عنوان فارسی روی هر ردیف قفل می‌شود):
`GOLDEN_REWARD` پاداش دوره طلایی، `PURCHASE_REWARD` پاداش خرید استاندارد، `SERVICE_PAYMENT` پرداخت فاکتور خدمات، `REFUND` بازگشت اعتبار.

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
9. سفارش تننت `TS-`؛ مادر `PL-`.
10. موجودی اعتبار را در فیلد جدا ذخیره نکن؛ از Ledger جمع بزن. ردیف دفتر را UPDATE/DELETE نکن.

---

## کار بعدی
1. خرج اعتبار برای فاکتور خدمات پلتفرم
2. آپلود رسید پرداخت برای فاکتور خدمات
3. ادمین مادر: خاموش/روشن Bot، TenantMessage
4. TENANT_RESELL
5. تیکت داخل ربات تننت

`.ai/CURRENT_STATUS.md` و `ROADMAP.md` مال v22 تکی‌اند و قدیمی‌اند.
