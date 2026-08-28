const PRODUCT_CATEGORIES = [
  {
    btn: "🐱 غذای خشک گربه",
    subMenus: [
      "رویال کنین (Royal Canin)",
      "مونژه (Monge)",
      "جمون (Gemon)",
      "سیمبا (Simba)",
    ],
  },
  {
    btn: "🐶 غذای خشک سگ",
    subMenus: [
      "رویال کنین (Royal Canin)",
      "مونژه (Monge)",
      "جمون (Gemon)",
    ],
  },
  {
    btn: "🩺 غذاهای درمانی و رژیمی",
    subMenus: [
      "رویال کنین (Royal Canin)",
      "مونژه (Monge)",
    ],
  },
  {
    btn: "🥫 کنسرو، پوچ و ووم",
    subMenus: [
      "رویال کنین (Royal Canin)",
      "مونژه (Monge)",
      "جمون (Gemon)",
      "سیمبا (Simba)",
      "جیم کت (GimCat)",
      "جیم داگ (GimDog)",
      "ونپی (Wanpy)",
      "گورمت (Gourmet)",
      "ویسکاس (Whiskas)",
      "فلیکسی (Flexi)",
      "لئو (Leo)",
      "وینستون (Winston)",
    ],
  },
  {
    btn: "🍖 تشویقی، اسنک و مکمل غذایی",
    subMenus: [
      "جیم کت (GimCat)",
      "ونپی (Wanpy)",
      "جوسرا (Josera)",
      "دریمیز (Dreamies)",
      "تریکسی (Trixie)",
      "وینستون (Winston)",
      "جوسی (Josi)",
      "نالرز (Nalers)",
      "سایر تشویقی‌ها",
    ],
  },
  {
    btn: "💊 مکمل، دارو و محصولات درمانی",
    subMenus: [
      "Vet Expert",
      "Beaphar",
      "Bravecto",
      "Vetmedin",
      "Apoquel",
      "سایر محصولات درمانی",
    ],
  },
  {
    btn: "🧴 شامپو و محصولات بهداشتی",
    subMenus: [
      "Vet Expert",
      "سایر محصولات بهداشتی",
    ],
  },
  {
    btn: "🎾 اسباب‌بازی سگ و گربه",
    subMenus: [
      "اسباب‌بازی گربه",
      "اسباب‌بازی سگ",
      "اسباب‌بازی مشترک سگ و گربه",
    ],
  },
  {
    btn: "🚗 حمل و سفر",
    subMenus: [
      "کوله و باکس حمل",
      "قمقمه و آبخوری سفری",
      "لوازم سفر",
    ],
  },
  {
    btn: "🍽️ ظروف غذا و آب",
    subMenus: [
      "آبخوری اتوماتیک",
      "فیلتر آبخوری",
      "ظروف و زیرانداز غذا",
    ],
  },
  {
    btn: "🏠 لوازم نگهداری و خانه حیوان",
    subMenus: [
      "توالت و لوازم خاک",
      "پارک و استراحت",
      "قلاده و لوازم جانبی",
    ],
  },
  {
    btn: "✂️ نظافت و آرایش",
    subMenus: [
      "پرزگیر",
      "برس و فرمیناتور",
      "لوازم نظافت",
    ],
  },
];

const BTN = {
  PRODUCTS: "🛍 محصولات",
  CART: "🛒 سبد خرید",
  ORDERS: "📦 سفارشات من",
  SUPPORT: "🎫 پشتیبانی",
  HELP: "📖 راهنما",
  COLLEAGUE: "🤝 خرید همکار",
  CREATE_SHOP_BOT: "🤖 ساخت ربات فروشگاهی",
  SHOP_ONLINE: "🌐 آنلاین شاپ",
  SHOP_PHYSICAL: "🏪 فروشگاه حضوری",
  SHOP_BOTH: "🌐🏪 آنلاین و حضوری",
  BACK_QUESTION: "🔙 بازگشت به سوال قبل",
  CONFIRM_PROFILE: "✅ تأیید و ثبت",
  MARKETING: "📣 بازاریابی",
  WALLET: "💰 کیف پول",
  WITHDRAW_NEW: "💳 درخواست برداشت جدید",
  WITHDRAW_HISTORY: "📋 تاریخچه برداشت",
  SEARCH: "🔍 جستجوی سریع",
  BACK_MAIN: "🏠 بازگشت به منوی اصلی",
  BACK_PRODUCTS: "🔙 بازگشت به دسته‌بندی‌ها",
  BACK_PRODUCT_LIST: "🔙 بازگشت به صفحه قبل",
  ADD_CART: "➕ افزودن به سبد",
  CLEAR_CART: "🗑 خالی کردن سبد",
  CHECKOUT: "✅ ثبت سفارش",
  SKIP: "⏭ رد کردن",
  RETAIL_MODE: "👤 بازگشت به خرید عادی",
  UPLOAD_RECEIPT: "📸 ارسال رسید پرداخت",
  NEW_TICKET: "➕ تیکت جدید",
  MY_TICKETS: "📋 تیکت‌های من",
  CLOSE_TICKET: "🔒 بستن تیکت",
  ADMIN_PANEL: "⚙️ پنل ادمین",
  ADMIN_INVOICES: "🧾 فاکتورها",
  ADMIN_PENDING: "🧾 فاکتورهای در انتظار",
  ADMIN_APPROVED: "✅ فاکتورهای تایید شده",
  ADMIN_REJECTED: "❌ فاکتورهای رد شده",
  ADMIN_SHIPPED: "🚚 فاکتورهای ارسال شده",
  ADMIN_TICKETS: "🎫 مدیریت تیکت‌ها",
  TICKET_OPEN: "📭 پاسخ داده نشده",
  TICKET_ANSWERED: "📬 پاسخ داده شده",
  ADMIN_PRODUCTS: "📦 مدیریت محصولات",
  ADMIN_WITHDRAWALS: "💸 درخواست‌های پورسانت",
  ADMIN_SALES: "📊 آمار فروش",
  ADMIN_SERVICES: "🛠 تغییر پکیج های خدماتی",
  ADMIN_SVC_INVOICES: "🧾 فاکتور خدمات همکاران",
  ADMIN_CREDIT_SETTINGS: "⚙️ تنظیمات ساخت اعتبار",
  CREDIT_SET_HOURS: "⏱ زمان گلدن تایم",
  CREDIT_SET_LIMIT: "💰 سقف اعتبار ویژه",
  CREDIT_SET_GOLDEN_PCT: "⭐ درصد اعتبار ویژه",
  CREDIT_SET_STANDARD_PCT: "📈 درصد اعتبار عادی",
  SVC_NEW: "➕ پکیج جدید",
  SVC_EDIT_TITLE: "✏️ نام",
  SVC_EDIT_PRICE: "💰 قیمت",
  SVC_EDIT_DESC: "📝 توضیحات",
  SVC_TOGGLE: "🔁 فعال / غیرفعال",
  SVC_ARCHIVE: "🗄 آرشیو / خروج از آرشیو",
  SVC_DELETE: "🗑 حذف پکیج",
  SVC_CONFIRM: "✅ تأیید انتخاب",
  SVC_SELECT: "☑️ انتخاب سرویس",
  SVC_PROFORMA: "🧾 پیش فاکتور",
  SVC_ISSUE: "🧾 صدور فاکتور",
  SVC_USE_CREDIT: "💳 استفاده از اعتبار کیف پول",
  SVC_PAY_CASH: "💵 پرداخت نقدی",
  SVC_CONFIRM_PROFORMA: "✅ تایید پیش فاکتور",
  SVC_KIND: "📦 نوع پکیج / خدمت",
  SVC_BILLING: "📅 یک‌بار / ماهانه",
  SHOP_SUBSCRIBE: "💳 خرید اشتراک",
  SHOP_SERVICE_INVOICES: "🧾 فاکتور خدمات",
  SHOP_CREDIT_WALLET: "📒 کیف پول اعتباری",
  SHOP_CREDIT_LEDGER: "📋 دفتر تراکنش‌ها",
  SHOP_ADMIN: "⚙️ مدیریت فروشگاه",
  SHOP_SETTINGS: "⚙️ تنظیمات فروشگاه",
  SHOP_PROFILE: "🏪 مشخصات فروشگاه",
  SHOP_LOGO: "🖼 لوگو",
  SHOP_WELCOME: "💬 پیام خوش‌آمد",
  SHOP_HELP: "📖 متن راهنما",
  SHOP_BANK: "💳 کارت بانکی",
  SHOP_CATEGORIES: "📂 دسته‌بندی‌ها",
  SHOP_PRODUCTS: "📦 کالاهای فروشگاه",
  SHOP_ADD_CATEGORY: "➕ دسته جدید",
  SHOP_ADD_PRODUCT: "➕ کالای جدید",
  SHOP_ORDERS: "🧾 سفارش‌های مشتریان",
  SHOP_ORDERS_OPEN: "📬 سفارشات باز",
  SHOP_ORDERS_CLOSED: "📭 سفارشات بسته",
  APPROVE: "✅ تایید فاکتور",
  REJECT: "❌ رد فاکتور",
  PACK: "📦 بسته‌بندی شد",
  SHIP: "🚚 ثبت ارسال",
  SET_IMAGE: "🖼 تنظیم عکس محصول",
  CONFIRM_ADDRESS: "✅ اطلاعات ارسال مورد تایید است",
  DELETE_ADDRESS: "🗑 حذف مشخصات ثبت شده",
  NEW_ADDRESS: "➕ آدرس جدید",
};

function kb(rows) {
  return {
    keyboard: rows,
    resize_keyboard: true,
  };
}

function inlineKb(rows) {
  return { inline_keyboard: rows };
}

function mainMenu(user) {
  const rows = [
    [{ text: BTN.PRODUCTS }, { text: BTN.SEARCH }],
    [{ text: BTN.CART }, { text: BTN.ORDERS }],
    [{ text: BTN.SUPPORT }, { text: BTN.HELP }],
  ];

  if (user.marketingEnabled) {
    rows.push([{ text: BTN.MARKETING }, { text: BTN.WALLET }]);
  }

  if (user.role === "COLLEAGUE" || user.role === "ADMIN") {
    rows.push([{ text: BTN.CREATE_SHOP_BOT }]);
  }

  if (user.role === "COLLEAGUE") {
    rows.push([{ text: BTN.RETAIL_MODE }]);
  } else if (user.role !== "ADMIN") {
    rows.push([{ text: BTN.COLLEAGUE }]);
  }

  if (user.role === "ADMIN") {
    rows.push([{ text: BTN.ADMIN_PANEL }]);
    rows.push([{ text: BTN.COLLEAGUE }]);
  }

  return kb(rows);
}

function tenantMainMenu(isOwner) {
  const rows = [
    [{ text: BTN.PRODUCTS }, { text: BTN.CART }],
    [{ text: BTN.ORDERS }, { text: BTN.HELP }],
  ];
  if (isOwner) rows.push([{ text: BTN.SHOP_ADMIN }]);
  return kb(rows);
}

function tenantAdminMenu() {
  return kb([
    [{ text: BTN.SHOP_SETTINGS }, { text: BTN.SHOP_ORDERS }],
    [{ text: BTN.SHOP_SUBSCRIBE }, { text: BTN.SHOP_SERVICE_INVOICES }],
    [{ text: BTN.SHOP_CREDIT_WALLET }, { text: BTN.BACK_MAIN }],
  ]);
}

function shopSettingsMenu() {
  return kb([
    [{ text: BTN.SHOP_PROFILE }, { text: BTN.SHOP_LOGO }],
    [{ text: BTN.SHOP_WELCOME }, { text: BTN.SHOP_HELP }],
    [{ text: BTN.SHOP_BANK }, { text: BTN.SHOP_CATEGORIES }],
    [{ text: BTN.SHOP_PRODUCTS }, { text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function shopCreditMenu() {
  return kb([
    [{ text: BTN.SHOP_CREDIT_LEDGER }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function shopOrdersMenu() {
  return kb([
    [{ text: BTN.SHOP_ORDERS_OPEN }],
    [{ text: BTN.SHOP_ORDERS_CLOSED }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function tenantProfileMenu() {
  return kb([
    [{ text: "✏️ نام فروشگاه" }],
    [{ text: "✏️ توضیحات" }],
    [{ text: "✏️ شماره تماس" }],
    [{ text: "✏️ آدرس" }],
    [{ text: "✏️ ساعات کاری" }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function tenantBankMenu() {
  return kb([
    [{ text: "✏️ شماره کارت" }],
    [{ text: "✏️ شبا" }],
    [{ text: "✏️ صاحب حساب" }],
    [{ text: "✏️ نام بانک" }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function tenantProductsMenu() {
  return kb([
    [{ text: BTN.SHOP_ADD_PRODUCT }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function tenantCategoriesMenu() {
  return kb([
    [{ text: BTN.SHOP_ADD_CATEGORY }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function backMain() {
  return kb([[{ text: BTN.BACK_MAIN }]]);
}

function productDetailMenu(product) {
  const rows = [];

  if (product.status === "AVAILABLE") {
    rows.push([{ text: BTN.ADD_CART }]);
  }
  rows.push([{ text: BTN.CART }]);

  rows.push(
    [{ text: BTN.BACK_PRODUCT_LIST }],
    [{ text: BTN.BACK_PRODUCTS }],
    [{ text: BTN.BACK_MAIN }]
  );

  return kb(rows);
}

function cartMenu() {
  return kb([
    [{ text: BTN.CHECKOUT }],
    [{ text: BTN.CLEAR_CART }],
    [{ text: BTN.PRODUCTS }],
    [{ text: BTN.BACK_MAIN }],
  ]);
}

function checkoutSkipMenu() {
  return kb([
    [{ text: BTN.SKIP }],
    [{ text: BTN.BACK_MAIN }],
  ]);
}

function paymentMenu() {
  return kb([
    [{ text: BTN.UPLOAD_RECEIPT }],
    [{ text: BTN.BACK_MAIN }],
  ]);
}

function walletMenu() {
  return kb([
    [{ text: BTN.WITHDRAW_NEW }],
    [{ text: BTN.WITHDRAW_HISTORY }],
    [{ text: BTN.BACK_MAIN }],
  ]);
}

function adminMenu() {
  return kb([
    [{ text: BTN.ADMIN_INVOICES }, { text: BTN.ADMIN_TICKETS }],
    [{ text: BTN.ADMIN_PRODUCTS }, { text: BTN.ADMIN_SERVICES }],
    [{ text: BTN.ADMIN_SVC_INVOICES }, { text: BTN.ADMIN_WITHDRAWALS }],
    [{ text: BTN.ADMIN_SALES }, { text: BTN.ADMIN_CREDIT_SETTINGS }],
    [{ text: BTN.BACK_MAIN }],
  ]);
}

function adminServicesMenu() {
  return kb([
    [{ text: BTN.SVC_NEW }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function adminServiceDetailMenu() {
  return kb([
    [{ text: BTN.SVC_EDIT_TITLE }, { text: BTN.SVC_EDIT_PRICE }],
    [{ text: BTN.SVC_EDIT_DESC }],
    [{ text: BTN.SVC_TOGGLE }],
    [{ text: BTN.SVC_KIND }],
    [{ text: BTN.SVC_BILLING }],
    [{ text: BTN.SVC_ARCHIVE }],
    [{ text: BTN.SVC_DELETE }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function adminServiceInvoiceActions() {
  return kb([
    [{ text: BTN.APPROVE }, { text: BTN.REJECT }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function adminInvoicesMenu() {
  return kb([
    [{ text: BTN.ADMIN_PENDING }, { text: BTN.ADMIN_APPROVED }],
    [{ text: BTN.ADMIN_REJECTED }, { text: BTN.ADMIN_SHIPPED }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function adminCreditSettingsMenu() {
  return kb([
    [{ text: BTN.CREDIT_SET_HOURS }, { text: BTN.CREDIT_SET_LIMIT }],
    [{ text: BTN.CREDIT_SET_GOLDEN_PCT }, { text: BTN.CREDIT_SET_STANDARD_PCT }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function adminBackMenu() {
  return kb([[{ text: BTN.BACK_PRODUCT_LIST }]]);
}

function adminOrderActions() {
  return kb([
    [{ text: BTN.APPROVE }, { text: BTN.REJECT }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function adminApprovedActions() {
  return kb([
    [{ text: BTN.PACK }],
    [{ text: BTN.SHIP }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function adminTicketsMenu() {
  return kb([
    [{ text: BTN.TICKET_OPEN }, { text: BTN.TICKET_ANSWERED }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function supportMenu() {
  return kb([
    [{ text: BTN.NEW_TICKET }],
    [{ text: BTN.MY_TICKETS }],
    [{ text: BTN.BACK_MAIN }],
  ]);
}

function activeTicketMenu() {
  return kb([
    [{ text: BTN.BACK_MAIN }],
  ]);
}

function confirmAddressMenu() {
  return kb([
    [{ text: BTN.CONFIRM_ADDRESS }],
    [{ text: BTN.DELETE_ADDRESS }],
    [{ text: BTN.BACK_MAIN }],
  ]);
}

function productCategoriesMenu() {
  const rows = PRODUCT_CATEGORIES.map((cat) => [{ text: cat.btn }]);
  rows.push([{ text: BTN.BACK_MAIN }]);
  return kb(rows);
}

function subMenuKb(subMenuItems) {
  const rows = subMenuItems.map((item) => [{ text: item }]);
  rows.push([{ text: BTN.BACK_PRODUCTS }]);
  rows.push([{ text: BTN.BACK_MAIN }]);
  return kb(rows);
}

module.exports = {
  BTN,
  PRODUCT_CATEGORIES,
  inlineKb,
  mainMenu,
  tenantMainMenu,
  tenantAdminMenu,
  shopSettingsMenu,
  shopCreditMenu,
  shopOrdersMenu,
  tenantProfileMenu,
  tenantBankMenu,
  tenantProductsMenu,
  tenantCategoriesMenu,
  backMain,
  productDetailMenu,
  productCategoriesMenu,
  subMenuKb,
  cartMenu,
  checkoutSkipMenu,
  paymentMenu,
  walletMenu,
  adminMenu,
  adminServicesMenu,
  adminServiceDetailMenu,
  adminServiceInvoiceActions,
  adminInvoicesMenu,
  adminCreditSettingsMenu,
  adminBackMenu,
  adminOrderActions,
  adminApprovedActions,
  adminTicketsMenu,
  supportMenu,
  activeTicketMenu,
  confirmAddressMenu,
  kb,
};
