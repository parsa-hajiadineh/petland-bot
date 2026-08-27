# AI_CONTEXT.md — PetLand
> این فایل را در شروع هر چت جدید بخوان. حافظهٔ پروژه است تا کار در پنجرهٔ دیگر ادامه پیدا کند.

---

## وضعیت همین الان (۱۴۰۵/۰۶/۰۶ — فیکس سفارش/رسید تننت)

ستون `Order.tenantId` روی دیتابیس لیارا ممکن است نباشد (ALTER استارت ممنوع است چون کل پروسه قفل می‌شود). کوئری با `tenantId` در `where`/`select` خطا می‌دهد.

برای همین قبلاً:
1. «سفارش‌های فروشگاه» → «خواندن سفارش‌ها ممکن نشد»
2. ارسال عکس رسید → `handleReceiptPhoto` false می‌شد → «عکس دریافت شد ولی در این مرحله نیاز نیست»

فیکس: `findTsOrders` / `findTsOrder` اول با `tenantId`، بعد با `items.product.tenantId`، بعد فقط `TS-`. رسید را با `ORDER_WITH_ITEMS_SELECT` (بدون `tenantId`) آپدیت کن. روی `Order` موقع استارت ALTER نزن.

بعد از دپلوی تست کن: پنل مالک → سفارش‌های فروشگاه؛ خرید → پیش‌فاکتور → ارسال رسید → باید «در انتظار تایید» شود.

اگر باز خطا بود لاگ لیارا: `SHOP ORDERS LIST:` / `TENANT RECEIPT:` / `TENANT ORDERS QUERY SKIP:`. توکن ربات را لاگ نکن.

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
src/handlers/tenantAdmin.js  پنل مالک
src/services/shopCart.js     SQL خام
src/services/shopProvision.js جدول‌های runtime
src/handlers/products.js     مادر + showTenantProducts
```

منوی تننت: محصولات، سبد، سفارشات من، راهنما. مالک: مدیریت فروشگاه + سفارش‌های فروشگاه.
سفارش‌های فروشگاه: اول «سفارشات باز» / «سفارشات بسته». باز = همه جز `REJECTED` و `SHIPPED`. بسته = همان دو وضعیت. لیست اینلاین مثل قبل.
محصولات تننت: **همیشه اول دسته‌ها**، بعد اینلاین ۱۰تایی.

قدم‌های تننت: `TSC:` دسته، `TCK:QTY` تعداد، `TCK:NAME`… تسویه، `TCK:RECEIPT` رسید، `TS:` پنل مالک.

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

---

## کار بعدی
1. دپلوی فیکس لیست سفارش + رسید و تست در ربات تست
2. اشتراک ماهانه + تخفیف حجمی از مادر
3. ادمین مادر: خاموش/روشن Bot، TenantMessage
4. TENANT_RESELL
5. تیکت داخل ربات تننت

`.ai/CURRENT_STATUS.md` و `ROADMAP.md` مال v22 تکی‌اند و قدیمی‌اند.
