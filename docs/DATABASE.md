# DATABASE.md — PetLand v20

## نوع پایگاه داده
- **DBMS:** PostgreSQL
- **ORM:** Prisma 6
- **Migration strategy:** `prisma db push` (بدون migration files)

## اتصال
```
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

---

## Enum ها

### UserRole
```
CUSTOMER    — مشتری معمولی
ADMIN       — مدیر سیستم
COLLEAGUE   — همکار (خرید عمده)
```

### ProductStatus
```
AVAILABLE     — موجود
UNAVAILABLE   — ناموجود
```

### OrderStatus (چرخه کامل سفارش)
```
WAITING_PAYMENT    → در انتظار پرداخت (ثبت اولیه)
WAITING_APPROVAL   → در انتظار تأیید (رسید آپلود شده)
APPROVED           → تأیید شده
PACKAGING          → در حال بسته‌بندی
SHIPPED            → ارسال شده
DELIVERED          → تحویل داده شده
REJECTED           → رد شده
```

### TicketStatus
```
OPEN       — باز
ANSWERED   — پاسخ داده شده
CLOSED     — بسته شده
```

---

## مدل‌های داده

### User
```prisma
model User {
  id              String    @id @default(cuid())
  baleId          String    @unique     // شناسه یکتای Bale
  firstName       String?
  lastName        String?
  username        String?
  role            UserRole  @default(CUSTOMER)
  
  // وضعیت مکالمه (State Machine)
  orderStep       String?               // مرحله جاری فرم سفارش
  adminStep       String?               // مرحله جاری پنل ادمین
  pendingOrderId  String?               // سفارش در حال پردازش
  
  // فیلدهای موقت فرم آدرس
  tempName        String?
  tempPhone       String?
  tempProvince    String?
  tempCity        String?
  tempAddress     String?
  tempPostal      String?
  tempNotes       String?
  
  // UI state
  lastMessageId   Int?                 // آخرین پیام ربات (برای حذف)
  
  orders          Order[]
  tickets         Ticket[]
  cart            Cart?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}
```

### Category
```prisma
model Category {
  id        String    @id @default(cuid())
  title     String    @unique
  products  Product[]
  createdAt DateTime  @default(now())
}
```

### Product
```prisma
model Product {
  id            String        @id @default(cuid())
  code          String        @unique   // مثال: JMK-001
  name          String
  description   String?
  costPrice     Int                     // قیمت خرید (تومان)
  profitPercent Float?                  // درصد سود (override DEFAULT_PROFIT_PERCENT)
  status        ProductStatus @default(AVAILABLE)
  imageUrl      String?                 // Bale file_id (نه URL واقعی)
  categoryId    String
  category      Category      @relation(...)
  orderItems    OrderItem[]
  cartItems     CartItem[]
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}
```

### Cart
```prisma
model Cart {
  id        String     @id @default(cuid())
  userId    String     @unique
  user      User       @relation(...)
  items     CartItem[]
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
}
```

### CartItem
```prisma
model CartItem {
  id        String   @id @default(cuid())
  cartId    String
  productId String
  quantity  Int      @default(1)
  cart      Cart     @relation(...)
  product   Product  @relation(...)
  
  @@unique([cartId, productId])
}
```

### Order
```prisma
model Order {
  id            String      @id @default(cuid())
  trackingCode  String      @unique   // PL-YYYYMMDD-####
  userId        String
  user          User        @relation(...)
  items         OrderItem[]
  
  // اطلاعات تحویل
  recipientName String
  phone         String
  province      String
  city          String
  address       String
  postalCode    String
  notes         String?
  
  totalAmount   Int                   // مجموع (تومان)
  isWholesale   Boolean  @default(false)
  status        OrderStatus @default(WAITING_PAYMENT)
  
  // پرداخت
  receiptImage  String?               // Bale file_id رسید
  
  // ارسال
  shipmentInfo  String?               // اطلاعات ارسال از ادمین
  rejectReason  String?               // دلیل رد سفارش
  
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

### OrderItem
```prisma
model OrderItem {
  id        String  @id @default(cuid())
  orderId   String
  productId String
  quantity  Int
  unitPrice Int             // قیمت لحظه‌ای (snapshot)
  order     Order   @relation(...)
  product   Product @relation(...)
}
```

### Ticket
```prisma
model Ticket {
  id        String         @id @default(cuid())
  userId    String
  user      User           @relation(...)
  title     String
  status    TicketStatus   @default(OPEN)
  messages  TicketMessage[]
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt
}
```

### TicketMessage
```prisma
model TicketMessage {
  id         String   @id @default(cuid())
  ticketId   String
  ticket     Ticket   @relation(...)
  senderType String             // "USER" یا "ADMIN"
  message    String
  createdAt  DateTime @default(now())
}
```

---

## نکات مهم

### قیمت‌گذاری محصول
- `costPrice` = قیمت خرید (ذخیره در DB)
- قیمت فروش خرده = `costPrice + floor(costPrice * profitPercent / 100)`
- `profitPercent` اگر روی محصول null باشد از `DEFAULT_PROFIT_PERCENT` (env) خوانده می‌شود
- قیمت عمده (COLLEAGUE) = `costPrice` (بدون سود)
- محصولاتی که `costPrice = 0` دارند → وضعیت `UNAVAILABLE`

### imageUrl
- مقدار این فیلد یک Bale `file_id` است، نه یک URL عادی
- برای نمایش عکس باید از API Bale استفاده شود

### کد رهگیری
- فرمت: `PL-YYYYMMDD-####`
- مثال: `PL-20250623-4521`
- تولید در: `src/utils/order.js`

### مهاجرت
- فایل migration وجود ندارد
- schema با `prisma db push` اعمال می‌شود
- برای بازسازی DB: `npm run db:push && npm run seed`

### Seed
- `npm run seed` دسته‌بندی‌ها و ~130 محصول را upsert می‌کند
- منبع داده: `src/data/products.js`

---

## چندمستأجری (Additive — بدون اثر روی منطق فعلی ربات)

این بخش فقط مدل داده را برای مرحلهٔ بعد آماده می‌کند. جدول‌ها و ستون‌های جدید به داده‌های موجود وابسته نیستند، فیلدهای جدید روی `Order` اختیاری‌اند، و هیچ handlerای هنوز از آن‌ها استفاده نمی‌کند.

**قاعده ایمنی:** جدول‌های فعلی (`User`, `Product`, `Order`, ...) حذف یا اجباری نشده‌اند. کاربران، سفارش‌ها و محصولات فعلی با `tenantId = null` همان ربات مادر باقی می‌مانند.

### نقش‌ها در مدل

| موجودیت | معنی |
|---------|------|
| ربات مادر (PetLand) | سفارش‌ها و کاربران با `tenantId` خالی |
| `Tenant` | هر پت‌شاپ / کلینیک / دامپزشکی / فروشگاه آنلاین همکار |
| `User` | هویت Bale (بدون ستون جدید؛ روابط فقط از سمت جدول‌های جدید) |
| `Customer` | پرونده اطلاعاتی خریدار (خرد، همکار، یا مشتریِ همکار) |
| `Bot` | ربات اختصاصی هر Tenant (توکن مادر همچنان در env است) |

### Enum های جدید

```
TenantType:           CLINIC | VET | PET_SHOP | ONLINE_SHOP | OTHER
TenantStatus:         PENDING | ACTIVE | SUSPENDED | INACTIVE
BotStatus:            PENDING | ACTIVE | DISABLED | EXPIRED
TenantMemberRole:     OWNER | ADMIN | STAFF
CustomerType:         RETAIL | COLLEAGUE | TENANT_CUSTOMER
SubscriptionStatus:   PENDING | ACTIVE | PAST_DUE | CANCELLED | EXPIRED
```

### Tenant
هر همکار پس از ورود کد دسترسی، در مرحلهٔ بعد یک Tenant می‌شود.

```prisma
model Tenant {
  id          String       @id @default(cuid())
  name        String
  type        TenantType   @default(PET_SHOP)
  status      TenantStatus @default(PENDING)

  ownerName   String?
  phone       String?
  province    String?
  city        String?
  address     String?
  postalCode  String?
  nationalId  String?
  description String?
  pageName    String?          // نام/مشخصات پیج (آنلاین شاپ)
  pageDetails String?

  ownerUserId String?  @unique   // User همکار مالک
  ownProducts Product[]          // کاتالوگ اختصاصی Tenant (هر محصولی، نه لزوماً کاتالوگ مادر)
  ...
}
```

### TenantMember — ارتباط Tenant با User
عضویت کارکنان/مالک در پنل ادمین ربات Tenant.

```prisma
model TenantMember {
  role     TenantMemberRole @default(STAFF)
  tenantId String
  userId   String
  @@unique([tenantId, userId])
}
```

### Customer
پروندهٔ مشتری جدا از هویت `User`:

| type | tenantId | معنی |
|------|----------|------|
| `RETAIL` | `null` | خریدار خرد از ربات مادر |
| `COLLEAGUE` | Tenant خود همکار | همکار؛ خرید عمده از ربات مادر + پرونده کسب‌وکار |
| `TENANT_CUSTOMER` | id کلینیک | مشتریِ ربات همان کلینیک |

فیلدهای پروفایل (نام، تلفن، آدرس، نام فروشگاه) برای ثبت اطلاعات بعد از فعال‌سازی حالت همکار اینجا ذخیره می‌شوند.

### TenantProduct و Product.tenantId
کاتالوگ مادر (`Product` با `tenantId = null`) دست‌نخورده است.

ربات Tenant لزوماً از محصولات مادر پر نیست؛ هر Tenant می‌تواند محصول خودش را با `Product.tenantId` بسازد.

`TenantProduct` فقط برای حالتی است که Tenant بخواهد محصول مادر را هم در فروشگاهش بفروشد.

```prisma
model Product {
  tenantId String?   // null = کاتالوگ مادر ؛ مقدار = محصول اختصاصی همان Tenant
}

model TenantProduct {
  isActive      Boolean @default(true)
  retailPrice   Int?
  profitPercent Int?
  tenantId      String
  productId     String
  @@unique([tenantId, productId])
}
```

### Order (ستون‌های اختیاری جدید)
فیلدهای قبلی سفارش تغییر نکرده‌اند. سه FK اختیاری اضافه شده:

- `tenantId` — اگر سفارش روی ربات Tenant ثبت شود؛ برای سفارش‌های فعلی مادر `null` است
- `customerId` — پیوند به پرونده `Customer` در صورت وجود
- `botId` — رباتی که سفارش از آن آمده

Handlerهای فعلی این فیلدها را نمی‌فرستند → Prisma مقدار `null` می‌گذارد → رفتار فعلی حفظ می‌شود.

### TenantSettings
تنظیمات هر ربات Tenant (نام فروشگاه، پیام خوش‌آمد، حساب بانکی، درصد سود، حداقل سفارش). تنظیمات ربات مادر همچنان از env خوانده می‌شود و به این جدول منتقل نشده است.

### Bot
ربات اختصاصی Tenant. ربات مادر در `BOT_TOKEN` env می‌ماند و ردیفی در این جدول ندارد.

- `token` به صورت AES-256-GCM رمزنگاری می‌شود (کلید: `BOT_TOKEN_ENCRYPTION_KEY`)
- `tokenHash` هش SHA-256 برای یکتایی، بدون نگهداری متن خام
- هر Bot متعلق به دقیقاً یک Tenant است (`tenantId` یکتا)

### اشتراک (آماده‌سازی تخفیف حجمی)

- `TenantSubscription` — هزینه فعال‌سازی، حق اشتراک ماهانه، درصد تخفیف دوره، حجم خرید ماهانه از مادر (`lastPurchaseVolume`)
- `SubscriptionDiscountTier` — پله‌های تخفیف سراسری بر اساس حداقل خرید ماهانه از ربات مادر (مثلاً ۲۰ میلیون → X٪)

هنوز هیچ منطق محاسبه‌ای در کد نیست؛ فقط محل ذخیره داده است.

### TenantMessage
لاگ پیام‌های ارسالی از پنل ادمین مادر به Tenantها.

### آنچه عمداً تغییر نکرد
- هیچ فیلد اجباری روی `User` / `Product` / `Cart` / `Order` (به‌جز FKهای nullable روی Order)
- `User.role` و ورود با `COLLEAGUE_ACCESS_CODE` حفظ شده؛ بعد از کد، اطلاعات همکار گرفته می‌شود
- `Cart` همچنان 1:1 با User است (سبد Tenant در مرحلهٔ بعد جدا طراحی می‌شود)
- Cascade حذف روی داده‌های فعلی تعریف نشده است

