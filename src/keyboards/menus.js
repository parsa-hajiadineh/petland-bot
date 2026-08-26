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

  if (user.role === "COLLEAGUE") {
    if (user.ownedTenant) {
      rows.push([{ text: BTN.CREATE_SHOP_BOT }]);
    }
    rows.push([{ text: BTN.RETAIL_MODE }]);
  } else {
    rows.push([{ text: BTN.COLLEAGUE }]);
  }

  if (user.role === "ADMIN") {
    rows.push([{ text: BTN.ADMIN_PANEL }]);
  }

  return kb(rows);
}

function backMain() {
  return kb([[{ text: BTN.BACK_MAIN }]]);
}

function productDetailMenu(product) {
  const rows = [];

  if (product.status === "AVAILABLE") {
    rows.push([{ text: BTN.ADD_CART }]);
  }

  rows.push(
    [{ text: BTN.CART }],
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
    [{ text: BTN.ADMIN_PENDING }],
    [{ text: BTN.ADMIN_APPROVED }],
    [{ text: BTN.ADMIN_REJECTED }],
    [{ text: BTN.ADMIN_SHIPPED }],
    [{ text: BTN.ADMIN_TICKETS }],
    [{ text: BTN.ADMIN_PRODUCTS }],
    [{ text: BTN.ADMIN_WITHDRAWALS }],
    [{ text: BTN.ADMIN_SALES }],
    [{ text: BTN.BACK_MAIN }],
  ]);
}

function adminOrderActions() {
  return kb([
    [{ text: BTN.APPROVE }, { text: BTN.REJECT }],
    [{ text: BTN.ADMIN_PANEL }],
  ]);
}

function adminApprovedActions() {
  return kb([
    [{ text: BTN.PACK }],
    [{ text: BTN.SHIP }],
    [{ text: BTN.ADMIN_PANEL }],
  ]);
}

function adminTicketsMenu() {
  return kb([
    [{ text: BTN.TICKET_OPEN }, { text: BTN.TICKET_ANSWERED }],
    [{ text: BTN.ADMIN_PANEL }],
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
  backMain,
  productDetailMenu,
  productCategoriesMenu,
  subMenuKb,
  cartMenu,
  checkoutSkipMenu,
  paymentMenu,
  walletMenu,
  adminMenu,
  adminOrderActions,
  adminApprovedActions,
  adminTicketsMenu,
  supportMenu,
  activeTicketMenu,
  confirmAddressMenu,
  kb,
};
