const prisma = require("../database/prisma");
const { reply, replyPhoto } = require("../bot/messenger");
const { getBotContext } = require("../bot/context");
const { ensureShopRuntimeTables, findOwnedTenant } = require("../services/shopProvision");
const { formatPrice } = require("../utils/price");
const {
  BTN,
  kb,
  inlineKb,
  tenantAdminMenu,
  shopSettingsMenu,
  shopCreditMenu,
  tenantProfileMenu,
  tenantBankMenu,
  tenantProductsMenu,
  tenantCategoriesMenu,
  backMain,
} = require("../keyboards/menus");
const tenantSupport = require("./tenantSupport");

const STEP_PREFIX = "TS:";

const PROFILE_FIELDS = {
  "✏️ نام فروشگاه": { step: "TS:NAME", prompt: "نام نمایشی فروشگاه را بفرستید:" },
  "✏️ توضیحات": { step: "TS:DESC", prompt: "توضیحات فروشگاه را بفرستید:" },
  "✏️ شماره تماس": { step: "TS:PHONE", prompt: "شماره تماس فروشگاه را بفرستید:" },
  "✏️ آدرس": { step: "TS:ADDRESS", prompt: "آدرس فروشگاه را بفرستید:" },
  "✏️ ساعات کاری": { step: "TS:HOURS", prompt: "ساعات کاری را بفرستید:" },
};

const BANK_FIELDS = {
  "✏️ شماره کارت": { step: "TS:BANK_CARD", prompt: "شماره کارت را بفرستید:" },
  "✏️ شبا": { step: "TS:BANK_IBAN", prompt: "شماره شبا را بفرستید:" },
  "✏️ صاحب حساب": { step: "TS:BANK_HOLDER", prompt: "نام صاحب حساب را بفرستید:" },
  "✏️ نام بانک": { step: "TS:BANK_NAME", prompt: "نام بانک را بفرستید:" },
};

function isTenantAdminStep(step) {
  return Boolean(step && String(step).startsWith(STEP_PREFIX));
}

function parseAmount(text) {
  const map = {
    "۰": "0",
    "۱": "1",
    "۲": "2",
    "۳": "3",
    "۴": "4",
    "۵": "5",
    "۶": "6",
    "۷": "7",
    "۸": "8",
    "۹": "9",
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
  };
  const normalized = String(text || "")
    .replace(/[۰-۹٠-٩]/g, (d) => map[d] || d)
    .replace(/[^\d]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

async function setStep(user, step, extras = {}) {
  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: step, ...extras },
  });
  user.adminStep = step;
}

async function isShopOwner(user, tenantId) {
  if (!user?.id || !tenantId) return false;
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { ownerUserId: true },
    });
    if (tenant?.ownerUserId === user.id) return true;
  } catch (err) {
    console.error("OWNER LOOKUP SKIP:", err.message);
  }
  try {
    const member = await prisma.tenantMember.findFirst({
      where: { userId: user.id, tenantId },
    });
    if (member) return true;
  } catch (err) {
    console.error("MEMBER OWNER SKIP:", err.message);
  }
  try {
    const owned = await findOwnedTenant(user.id);
    if (owned?.id === tenantId) return true;
  } catch (err) {
    console.error("OWNED TENANT MATCH SKIP:", err.message);
  }
  return false;
}

async function loadShopView(tenantId) {
  let tenant = null;
  let settings = null;
  try {
    tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  } catch (err) {
    console.error("SHOP TENANT LOAD:", err.message);
  }
  try {
    settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
    });
  } catch (err) {
    console.error("SHOP SETTINGS LOAD:", err.message);
  }
  return {
    name: settings?.shopName || tenant?.name || "فروشگاه",
    welcomeMessage: settings?.welcomeMessage || "",
    phone: settings?.supportPhone || tenant?.phone || "",
    address: settings?.shopAddress || tenant?.address || "",
    description: settings?.shopDescription || tenant?.description || "",
    openingHours: settings?.openingHours || "",
    helpMessage: settings?.helpMessage || "",
    logoFileId: settings?.logoFileId || null,
    bankCard: settings?.bankCard || "",
    bankIban: settings?.bankIban || "",
    bankHolder: settings?.bankHolder || "",
    bankName: settings?.bankName || "",
  };
}

function shopIntroText(shop) {
  const lines = [`🌿 ${shop.name}`];
  if (shop.description) lines.push("", shop.description);
  if (shop.welcomeMessage) lines.push("", shop.welcomeMessage);
  if (shop.phone) lines.push("", `📞 ${shop.phone}`);
  if (shop.address) lines.push(`📍 ${shop.address}`);
  if (shop.openingHours) lines.push(`🕐 ${shop.openingHours}`);
  lines.push("", "از منوی زیر استفاده کنید:");
  return lines.join("\n");
}

async function patchSettings(tenantId, data) {
  try {
    await prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
    return true;
  } catch (err) {
    console.error("SETTINGS PATCH:", err.message);
    const allowed = [
      "shopName",
      "welcomeMessage",
      "supportPhone",
      "bankCard",
      "bankIban",
      "bankHolder",
      "bankName",
      "logoFileId",
      "shopDescription",
      "shopAddress",
      "openingHours",
      "helpMessage",
    ];
    const slim = {};
    for (const key of allowed) {
      if (data[key] !== undefined) slim[key] = data[key];
    }
    try {
      await prisma.tenantSettings.update({
        where: { tenantId },
        data: slim,
      });
      return true;
    } catch (err2) {
      console.error("SETTINGS PATCH SLIM:", err2.message);
      return false;
    }
  }
}

async function patchTenant(tenantId, data) {
  try {
    await prisma.tenant.update({
      where: { id: tenantId },
      data,
    });
  } catch (err) {
    console.error("TENANT PATCH SKIP:", err.message);
  }
}

function profileSummary(shop) {
  return `🏪 مشخصات فروشگاه
━━━━━━━━━━━━━━━━━━
🏷 نام: ${shop.name || "—"}
📝 توضیحات: ${shop.description || "—"}
📞 تلفن: ${shop.phone || "—"}
📍 آدرس: ${shop.address || "—"}
🕐 ساعات کاری: ${shop.openingHours || "—"}

برای ویرایش یکی از دکمه‌ها را بزنید.`;
}

function bankSummary(shop) {
  return `💳 اطلاعات کارت‌به‌کارت
━━━━━━━━━━━━━━━━━━
💳 کارت: ${shop.bankCard || "—"}
🏦 شبا: ${shop.bankIban || "—"}
👤 صاحب حساب: ${shop.bankHolder || "—"}
🏛 بانک: ${shop.bankName || "—"}

برای ویرایش یکی از دکمه‌ها را بزنید.`;
}

async function showShopSettings(user, chatId) {
  await setStep(user, "TS:SETTINGS");
  await reply(
    user,
    chatId,
    "⚙️ تنظیمات فروشگاه\n\nظاهر فروشگاه، دسته‌ها و کالاها را از اینجا تنظیم کنید.",
    shopSettingsMenu()
  );
}

async function showAdminHome(user, chatId) {
  await ensureShopRuntimeTables();
  await setStep(user, "TS:MENU");
  await reply(
    user,
    chatId,
    "⚙️ مدیریت فروشگاه\n\nاز منو اشتراک، سفارش مشتریان و تنظیمات فروشگاه را مدیریت کنید.",
    tenantAdminMenu()
  );
}

async function showCreditWallet(user, chatId, tenantId) {
  const creditLedger = require("../services/creditLedger");
  await setStep(user, "TS:CREDIT");
  let view;
  try {
    view = await creditLedger.getWalletHome({
      tenantId,
      userId: user.id,
    });
  } catch (err) {
    console.error("CREDIT WALLET VIEW:", err);
    await reply(
      user,
      chatId,
      "خواندن کیف پول اعتباری ممکن نشد.",
      tenantAdminMenu()
    );
    return;
  }
  await reply(user, chatId, view.text, shopCreditMenu());
}

async function showCreditLedger(user, chatId, tenantId) {
  const creditLedger = require("../services/creditLedger");
  await setStep(user, "TS:CREDIT_LEDGER");
  let view;
  try {
    view = await creditLedger.getWalletView({
      tenantId,
      userId: user.id,
    });
  } catch (err) {
    console.error("CREDIT LEDGER VIEW:", err);
    await reply(
      user,
      chatId,
      "خواندن دفتر تراکنش‌ها ممکن نشد.",
      shopCreditMenu()
    );
    return;
  }
  await reply(user, chatId, view.text, shopCreditMenu());
}

async function showProfile(user, chatId, tenantId) {
  const shop = await loadShopView(tenantId);
  await setStep(user, "TS:PROFILE");
  await reply(user, chatId, profileSummary(shop), tenantProfileMenu());
}

async function showBank(user, chatId, tenantId) {
  const shop = await loadShopView(tenantId);
  await setStep(user, "TS:BANK");
  await reply(user, chatId, bankSummary(shop), tenantBankMenu());
}

async function listCategories(tenantId) {
  try {
    return await prisma.category.findMany({
      where: { tenantId },
      orderBy: { title: "asc" },
    });
  } catch (err) {
    console.error("TENANT CATS QUERY:", err.message);
  }
  try {
    const products = await prisma.product.findMany({
      where: { tenantId },
      select: { category: { select: { id: true, title: true } } },
    });
    const seen = new Map();
    for (const row of products) {
      if (row.category?.id) seen.set(row.category.id, row.category);
    }
    return [...seen.values()];
  } catch (err) {
    console.error("TENANT CATS FALLBACK:", err.message);
    return [];
  }
}

async function showCategories(user, chatId, tenantId) {
  const cats = await listCategories(tenantId);
  await setStep(user, "TS:CATS");
  if (!cats.length) {
    await reply(
      user,
      chatId,
      "هنوز دسته‌بندی‌ای ندارید. یک دسته بسازید تا بعداً کالاها را داخل آن بگذارید.",
      tenantCategoriesMenu()
    );
    return;
  }
  const lines = cats.map((c, i) => `${i + 1}. ${c.title}`);
  await reply(
    user,
    chatId,
    `📂 دسته‌بندی‌های فروشگاه\n\n${lines.join("\n")}\n\n✏️ تغییر نام یا 🗑 حذف را از دکمه‌های زیر بزنید.`,
    tenantCategoriesMenu()
  );
  const { sendKeyboard } = require("../bot/bale");
  const rows = cats.map((c) => [
    { text: `✏️ ${c.title}`.slice(0, 32), callback_data: `tcr:${c.id}`.slice(0, 64) },
    { text: `🗑 ${c.title}`.slice(0, 32), callback_data: `tcd:${c.id}`.slice(0, 64) },
  ]);
  await sendKeyboard(chatId, "تغییر نام یا حذف دسته:", inlineKb(rows.slice(0, 15)));
}

async function findOrCreateCategory(tenantId, title) {
  const name = title.trim();
  if (!tenantId || !name) return null;
  try {
    const existing = await prisma.category.findFirst({
      where: { title: name, tenantId },
    });
    if (existing) return existing;
    return await prisma.category.create({
      data: { title: name, tenantId },
    });
  } catch (err) {
    console.error("CATEGORY CREATE TENANT:", err.message);
  }
  try {
    return await prisma.category.findFirst({
      where: { title: name, tenantId },
    });
  } catch (err) {
    console.error("CATEGORY CREATE FALLBACK:", err.message);
    return null;
  }
}

function newProductCode() {
  return `S${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`.toUpperCase();
}

async function listTenantProducts(tenantId) {
  try {
    return await prisma.product.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        code: true,
        title: true,
        costPrice: true,
        status: true,
        category: { select: { title: true } },
      },
    });
  } catch (err) {
    console.error("TENANT ADMIN PRODUCTS:", err.message);
    try {
      return await prisma.product.findMany({
        where: { tenantId },
        take: 40,
        select: {
          code: true,
          title: true,
          costPrice: true,
          status: true,
        },
      });
    } catch (err2) {
      console.error("TENANT ADMIN PRODUCTS FALLBACK:", err2.message);
      return [];
    }
  }
}

async function showProducts(user, chatId, tenantId) {
  const products = await listTenantProducts(tenantId);
  await setStep(user, "TS:PRODUCTS");
  if (!products.length) {
    await reply(
      user,
      chatId,
      "هنوز کالایی ثبت نشده. با «کالای جدید» اولین کالا را اضافه کنید.",
      tenantProductsMenu()
    );
    return;
  }

  const rows = products.map((p) => [
    {
      text: `${p.status === "AVAILABLE" ? "🟢" : "🔴"} ${p.title} | ${formatPrice(
        p.costPrice
      )}`,
      callback_data: `tp:${p.code}`.slice(0, 64),
    },
  ]);

  await reply(
    user,
    chatId,
    `📦 ${products.length} کالا — برای ویرایش روی کالا بزنید.`,
    tenantProductsMenu()
  );
  const { sendKeyboard } = require("../bot/bale");
  await sendKeyboard(
    chatId,
    "کالای مورد نظر را انتخاب کنید:",
    inlineKb(rows.slice(0, 30))
  );
}

async function loadOwnedProduct(code, tenantId) {
  if (!code || !tenantId) return null;
  try {
    return await prisma.product.findFirst({
      where: { code, tenantId },
      select: {
        id: true,
        code: true,
        title: true,
        description: true,
        imageUrl: true,
        costPrice: true,
        status: true,
        category: { select: { title: true } },
      },
    });
  } catch (err) {
    console.error("OWNED PRODUCT:", err.message);
    return null;
  }
}

async function patchOwnedProduct(code, tenantId, data) {
  const owned = await loadOwnedProduct(code, tenantId);
  if (!owned) return null;
  await prisma.product.update({ where: { id: owned.id }, data });
  return owned;
}

function productAdminText(product) {
  return `📦 ${product.title}
🔖 ${product.code}
📂 ${product.category?.title || "—"}
💰 ${formatPrice(product.costPrice)}
${product.status === "AVAILABLE" ? "🟢 موجود" : "🔴 ناموجود"}
📝 ${product.description || "بدون توضیحات"}`;
}

function productAdminKb(code) {
  return inlineKb([
    [
      { text: "💰 قیمت", callback_data: `tpe:price:${code}`.slice(0, 64) },
      { text: "📝 توضیح", callback_data: `tpe:desc:${code}`.slice(0, 64) },
    ],
    [
      { text: "🖼 عکس", callback_data: `tpe:img:${code}`.slice(0, 64) },
      {
        text: "موجودی",
        callback_data: `tpe:stat:${code}`.slice(0, 64),
      },
    ],
    [{ text: "🗑 حذف", callback_data: `tpe:del:${code}`.slice(0, 64) }],
  ]);
}

async function showProductAdmin(user, chatId, product) {
  await setStep(user, "TS:PRODUCTS", { lastProductCode: product.code });
  const { sendKeyboard } = require("../bot/bale");
  if (product.imageUrl) {
    try {
      await replyPhoto(
        user,
        chatId,
        product.imageUrl,
        productAdminText(product),
        tenantProductsMenu()
      );
    } catch (err) {
      console.error("ADMIN PRODUCT PHOTO:", err.message);
      await reply(user, chatId, productAdminText(product), tenantProductsMenu());
    }
  } else {
    await reply(user, chatId, productAdminText(product), tenantProductsMenu());
  }
  await sendKeyboard(chatId, "عملیات کالا:", productAdminKb(product.code));
}

async function startAddProduct(user, chatId, tenantId) {
  const cats = await listCategories(tenantId);
  if (!cats.length) {
    await reply(
      user,
      chatId,
      "اول یک دسته‌بندی بسازید، بعد کالا اضافه کنید.",
      tenantCategoriesMenu()
    );
    await setStep(user, "TS:CATS");
    return;
  }
  await setStep(user, "TS:P_TITLE", {
    tempDescription: null,
    tempProvince: null,
    tempCity: null,
    tempAddress: null,
  });
  await reply(user, chatId, "نام کالا را بفرستید:", kb([[{ text: BTN.BACK_PRODUCT_LIST }]]));
}

async function askProductCategory(user, chatId, tenantId) {
  const cats = await listCategories(tenantId);
  const rows = cats.map((c) => [{ text: c.title }]);
  rows.push([{ text: BTN.BACK_PRODUCT_LIST }]);
  await setStep(user, "TS:P_CAT");
  await reply(user, chatId, "دسته این کالا را انتخاب کنید:", kb(rows));
}

async function saveNewProduct(user, tenantId) {
  await ensureShopRuntimeTables();
  let fresh = user;
  try {
    fresh = (await prisma.user.findUnique({ where: { id: user.id } })) || user;
  } catch (err) {
    console.error("PRODUCT SAVE USER RELOAD:", err.message);
  }
  const title = (fresh.tempDescription || user.tempDescription || "").trim();
  const categoryTitle = (fresh.tempProvince || user.tempProvince || "").trim();
  const price = Number(fresh.tempCity || user.tempCity) || 0;
  const description = (fresh.tempAddress || user.tempAddress || "").trim() || null;
  if (!title || !categoryTitle || price < 1) {
    console.error("PRODUCT SAVE MISSING FIELDS:", {
      title: Boolean(title),
      categoryTitle: Boolean(categoryTitle),
      price,
    });
    return null;
  }

  const category = await findOrCreateCategory(tenantId, categoryTitle);
  if (!category) return null;

  const payload = {
    title,
    description,
    costPrice: price,
    profitPercent: 0,
    status: "AVAILABLE",
    categoryId: category.id,
    tenantId,
  };

  for (let i = 0; i < 5; i += 1) {
    const code = newProductCode();
    try {
      return await prisma.product.create({
        data: { ...payload, code },
      });
    } catch (err) {
      console.error("TENANT PRODUCT CREATE:", err.message);
    }
  }

  try {
    const code = newProductCode();
    const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Product" ("id","code","title","description","costPrice","profitPercent","status","categoryId","tenantId","createdAt")
       VALUES ($1,$2,$3,$4,$5,0,'AVAILABLE'::"ProductStatus",$6,$7,CURRENT_TIMESTAMP)`,
      id,
      code,
      title,
      description,
      price,
      category.id,
      tenantId
    );
    return await prisma.product.findUnique({ where: { id } });
  } catch (err) {
    console.error("TENANT PRODUCT RAW INSERT:", err.message);
    return null;
  }
}

async function handleAdminText(user, chatId, text) {
  const ctx = getBotContext();
  const tenantId = ctx.tenantId;
  if (!(await isShopOwner(user, tenantId))) return false;

  if (text === BTN.SHOP_ADMIN) {
    await showAdminHome(user, chatId);
    return true;
  }

  if (await require("./serviceBilling").handleText(user, chatId, text)) {
    return true;
  }
  if (await tenantSupport.handleOwnerText(user, chatId, text)) {
    return true;
  }

  if (text === BTN.SHOP_SUBSCRIBE) {
    await require("./serviceBilling").startTenantSubscribe(user, chatId, tenantId);
    return true;
  }
  if (text === BTN.SHOP_SERVICE_INVOICES) {
    await require("./serviceBilling").showInvoiceList(user, chatId, tenantId);
    return true;
  }
  if (text === BTN.SHOP_CREDIT_WALLET) {
    await showCreditWallet(user, chatId, tenantId);
    return true;
  }
  if (text === BTN.SHOP_CREDIT_LEDGER) {
    await showCreditLedger(user, chatId, tenantId);
    return true;
  }

  if (text === BTN.BACK_PRODUCT_LIST && isTenantAdminStep(user.adminStep)) {
    if (await tenantSupport.goOwnerBack(user, chatId)) return true;
    if (String(user.adminStep).startsWith("TS:SUB:")) {
      await require("./serviceBilling").goBack(user, chatId);
      return true;
    }
    if (user.adminStep === "TS:ORDERS") {
      await showAdminHome(user, chatId);
      return true;
    }
    if (
      user.adminStep === "TS:ORDERS_OPEN" ||
      user.adminStep === "TS:ORDERS_CLOSED"
    ) {
      const tenantOrder = require("./tenantOrder");
      if (user.pendingOrderId) {
        await tenantOrder.showShopOrderList(
          user,
          chatId,
          user.adminStep === "TS:ORDERS_CLOSED" ? "closed" : "open"
        );
      } else {
        await tenantOrder.showShopOrders(user, chatId);
      }
      return true;
    }
    if (user.adminStep === "TS:O_REJECT" || user.adminStep === "TS:O_SHIP") {
      const tenantOrder = require("./tenantOrder");
      if (user.pendingOrderId) {
        await tenantOrder.showShopOrderDetail(user, chatId, user.pendingOrderId);
      } else {
        await tenantOrder.showShopOrders(user, chatId);
      }
      return true;
    }
    if (user.adminStep === "TS:CREDIT_LEDGER") {
      await showCreditWallet(user, chatId, tenantId);
      return true;
    }
    if (user.adminStep === "TS:SINV:LIST") {
      await showAdminHome(user, chatId);
      return true;
    }
    if (user.adminStep === "TS:SETTINGS") {
      await showAdminHome(user, chatId);
      return true;
    }
    if (
      user.adminStep === "TS:MENU" ||
      user.adminStep === "TS:CREDIT"
    ) {
      await showAdminHome(user, chatId);
      return true;
    }
    if (
      user.adminStep === "TS:CAT_NEW" ||
      user.adminStep === "TS:CAT_RENAME"
    ) {
      await showCategories(user, chatId, tenantId);
      return true;
    }
    if (
      user.adminStep === "TS:PROFILE" ||
      user.adminStep === "TS:BANK" ||
      user.adminStep === "TS:CATS" ||
      user.adminStep === "TS:PRODUCTS" ||
      user.adminStep === "TS:WELCOME" ||
      user.adminStep === "TS:HELP" ||
      user.adminStep === "TS:LOGO"
    ) {
      await showShopSettings(user, chatId);
      return true;
    }
    if (String(user.adminStep).startsWith("TS:P_")) {
      await showProducts(user, chatId, tenantId);
      return true;
    }
    if (String(user.adminStep).startsWith("TS:BANK_")) {
      await showBank(user, chatId, tenantId);
      return true;
    }
    await showProfile(user, chatId, tenantId);
    return true;
  }

  if (text === BTN.SHOP_SETTINGS) {
    await showShopSettings(user, chatId);
    return true;
  }
  if (text === BTN.SHOP_PROFILE) {
    await showProfile(user, chatId, tenantId);
    return true;
  }
  if (text === BTN.SHOP_BANK) {
    await showBank(user, chatId, tenantId);
    return true;
  }
  if (text === BTN.SHOP_CATEGORIES) {
    await showCategories(user, chatId, tenantId);
    return true;
  }
  if (text === BTN.SHOP_PRODUCTS) {
    await showProducts(user, chatId, tenantId);
    return true;
  }
  if (text === BTN.SHOP_ORDERS) {
    await require("./tenantOrder").showShopOrders(user, chatId);
    return true;
  }
  if (text === BTN.SHOP_ADD_CATEGORY) {
    await setStep(user, "TS:CAT_NEW");
    await reply(
      user,
      chatId,
      "نام دسته‌بندی جدید را بفرستید:",
      kb([[{ text: BTN.BACK_PRODUCT_LIST }]])
    );
    return true;
  }
  if (text === BTN.SHOP_ADD_PRODUCT) {
    await startAddProduct(user, chatId, tenantId);
    return true;
  }
  if (text === BTN.SHOP_WELCOME) {
    await setStep(user, "TS:WELCOME");
    const shop = await loadShopView(tenantId);
    await reply(
      user,
      chatId,
      `پیام خوش‌آمد فعلی:\n${shop.welcomeMessage || "—"}\n\nمتن جدید را بفرستید:`,
      kb([[{ text: BTN.BACK_PRODUCT_LIST }]])
    );
    return true;
  }
  if (text === BTN.SHOP_HELP) {
    await setStep(user, "TS:HELP");
    const shop = await loadShopView(tenantId);
    await reply(
      user,
      chatId,
      `متن راهنمای فعلی:\n${shop.helpMessage || "—"}\n\nمتن جدید دکمه «📖 راهنما» را بفرستید:`,
      kb([[{ text: BTN.BACK_PRODUCT_LIST }]])
    );
    return true;
  }
  if (text === BTN.SHOP_LOGO) {
    await setStep(user, "TS:LOGO");
    await reply(
      user,
      chatId,
      "عکس لوگو را همین‌جا ارسال کنید.\nبرای حذف لوگو بنویسید: حذف",
      kb([[{ text: BTN.BACK_PRODUCT_LIST }]])
    );
    return true;
  }

  if (user.adminStep === "TS:PROFILE" && PROFILE_FIELDS[text]) {
    const field = PROFILE_FIELDS[text];
    await setStep(user, field.step);
    await reply(user, chatId, field.prompt, kb([[{ text: BTN.BACK_PRODUCT_LIST }]]));
    return true;
  }

  if (user.adminStep === "TS:BANK" && BANK_FIELDS[text]) {
    const field = BANK_FIELDS[text];
    await setStep(user, field.step);
    await reply(user, chatId, field.prompt, kb([[{ text: BTN.BACK_PRODUCT_LIST }]]));
    return true;
  }

  if (user.adminStep === "TS:NAME") {
    const ok = await patchSettings(tenantId, { shopName: text.trim() });
    await patchTenant(tenantId, { name: text.trim() });
    await reply(user, chatId, ok ? "✅ نام فروشگاه ذخیره شد." : "ذخیره نشد.");
    await showProfile(user, chatId, tenantId);
    return true;
  }
  if (user.adminStep === "TS:DESC") {
    const ok = await patchSettings(tenantId, { shopDescription: text.trim() });
    await patchTenant(tenantId, { description: text.trim() });
    await reply(user, chatId, ok ? "✅ توضیحات ذخیره شد." : "ذخیره نشد.");
    await showProfile(user, chatId, tenantId);
    return true;
  }
  if (user.adminStep === "TS:PHONE") {
    const ok = await patchSettings(tenantId, { supportPhone: text.trim() });
    await patchTenant(tenantId, { phone: text.trim() });
    await reply(user, chatId, ok ? "✅ تلفن ذخیره شد." : "ذخیره نشد.");
    await showProfile(user, chatId, tenantId);
    return true;
  }
  if (user.adminStep === "TS:ADDRESS") {
    const ok = await patchSettings(tenantId, { shopAddress: text.trim() });
    await patchTenant(tenantId, { address: text.trim() });
    await reply(user, chatId, ok ? "✅ آدرس ذخیره شد." : "ذخیره نشد.");
    await showProfile(user, chatId, tenantId);
    return true;
  }
  if (user.adminStep === "TS:HOURS") {
    const ok = await patchSettings(tenantId, { openingHours: text.trim() });
    await reply(user, chatId, ok ? "✅ ساعات کاری ذخیره شد." : "ذخیره نشد.");
    await showProfile(user, chatId, tenantId);
    return true;
  }
  if (user.adminStep === "TS:WELCOME") {
    const ok = await patchSettings(tenantId, { welcomeMessage: text.trim() });
    await reply(user, chatId, ok ? "✅ پیام خوش‌آمد ذخیره شد." : "ذخیره نشد.");
    await showAdminHome(user, chatId);
    return true;
  }
  if (user.adminStep === "TS:HELP") {
    const ok = await patchSettings(tenantId, { helpMessage: text.trim() });
    await reply(user, chatId, ok ? "✅ متن راهنما ذخیره شد." : "ذخیره نشد.");
    await showAdminHome(user, chatId);
    return true;
  }
  if (user.adminStep === "TS:LOGO" && text.trim() === "حذف") {
    await patchSettings(tenantId, { logoFileId: null });
    await reply(user, chatId, "✅ لوگو حذف شد.");
    await showAdminHome(user, chatId);
    return true;
  }

  if (user.adminStep === "TS:BANK_CARD") {
    await patchSettings(tenantId, { bankCard: text.trim() });
    await reply(user, chatId, "✅ شماره کارت ذخیره شد.");
    await showBank(user, chatId, tenantId);
    return true;
  }
  if (user.adminStep === "TS:BANK_IBAN") {
    await patchSettings(tenantId, { bankIban: text.trim() });
    await reply(user, chatId, "✅ شبا ذخیره شد.");
    await showBank(user, chatId, tenantId);
    return true;
  }
  if (user.adminStep === "TS:BANK_HOLDER") {
    await patchSettings(tenantId, { bankHolder: text.trim() });
    await reply(user, chatId, "✅ صاحب حساب ذخیره شد.");
    await showBank(user, chatId, tenantId);
    return true;
  }
  if (user.adminStep === "TS:BANK_NAME") {
    await patchSettings(tenantId, { bankName: text.trim() });
    await reply(user, chatId, "✅ نام بانک ذخیره شد.");
    await showBank(user, chatId, tenantId);
    return true;
  }

  if (user.adminStep === "TS:CAT_NEW") {
    const cat = await findOrCreateCategory(tenantId, text);
    await reply(
      user,
      chatId,
      cat ? `✅ دسته «${cat.title}» اضافه شد.` : "ساخت دسته ممکن نشد."
    );
    await showCategories(user, chatId, tenantId);
    return true;
  }

  if (user.adminStep === "TS:CAT_RENAME" && user.pendingOrderId) {
    const name = String(text || "").trim();
    if (!name) {
      await reply(user, chatId, "نام دسته را بفرستید.", kb([[{ text: BTN.BACK_PRODUCT_LIST }]]));
      return true;
    }
    try {
      const cat = await prisma.category.findUnique({
        where: { id: user.pendingOrderId },
      });
      const owned = cat && cat.tenantId === tenantId;
      if (!owned) {
        await reply(user, chatId, "این دسته پیدا نشد.");
        await showCategories(user, chatId, tenantId);
        return true;
      }
      await prisma.category.update({
        where: { id: cat.id },
        data: { title: name },
      });
      await reply(user, chatId, `✅ نام دسته به «${name}» تغییر کرد.`);
    } catch (err) {
      console.error("CATEGORY RENAME:", err.message);
      await reply(user, chatId, "تغییر نام دسته ممکن نشد.");
    }
    await showCategories(user, chatId, tenantId);
    return true;
  }

  if (user.adminStep === "TS:P_TITLE") {
    await prisma.user.update({
      where: { id: user.id },
      data: { tempDescription: text.trim() },
    });
    user.tempDescription = text.trim();
    await askProductCategory(user, chatId, tenantId);
    return true;
  }

  if (user.adminStep === "TS:P_CAT") {
    const cats = await listCategories(tenantId);
    if (!cats.some((c) => c.title === text.trim())) {
      await reply(user, chatId, "یکی از دسته‌های همین فروشگاه را از دکمه انتخاب کنید.");
      return true;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { tempProvince: text.trim() },
    });
    user.tempProvince = text.trim();
    await setStep(user, "TS:P_PRICE");
    await reply(
      user,
      chatId,
      "قیمت فروش این کالا را به تومان بفرستید (فقط عدد):",
      kb([[{ text: BTN.BACK_PRODUCT_LIST }]])
    );
    return true;
  }

  if (user.adminStep === "TS:P_PRICE") {
    const amount = parseAmount(text);
    if (!amount) {
      await reply(user, chatId, "یک عدد معتبر به تومان بفرستید.");
      return true;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { tempCity: String(amount), tempAddress: "" },
    });
    user.tempCity = String(amount);
    user.tempAddress = "";
    const product = await saveNewProduct(user, tenantId);
    if (!product) {
      await reply(
        user,
        chatId,
        "ثبت کالا در دیتابیس ممکن نشد. دوباره از «کالای جدید» تلاش کنید."
      );
      return true;
    }
    await setStep(user, "TS:P_DESC", { lastProductCode: product.code });
    user.lastProductCode = product.code;
    await reply(
      user,
      chatId,
      `✅ کالا ثبت شد.\n🔖 ${product.code}\n💰 ${formatPrice(amount)}\n\nتوضیحات کالا را بفرستید یا «رد کردن» را بزنید.`,
      kb([[{ text: BTN.SKIP }], [{ text: BTN.BACK_PRODUCT_LIST }]])
    );
    return true;
  }

  if (user.adminStep === "TS:P_DESC") {
    if (user.lastProductCode && text !== BTN.SKIP) {
      try {
        await patchOwnedProduct(user.lastProductCode, tenantId, {
          description: text.trim(),
        });
      } catch (err) {
        console.error("PRODUCT DESC AFTER CREATE:", err.message);
      }
    }
    await setStep(user, "TS:P_PHOTO", {
      lastProductCode: user.lastProductCode,
    });
    await reply(
      user,
      chatId,
      "اگر عکس دارید همین‌جا بفرستید، وگرنه «رد کردن» را بزنید.",
      kb([[{ text: BTN.SKIP }], [{ text: BTN.BACK_PRODUCT_LIST }]])
    );
    return true;
  }

  if (user.adminStep === "TS:P_PHOTO" && text === BTN.SKIP) {
    await reply(user, chatId, "کالا بدون عکس ذخیره شد.");
    await showProducts(user, chatId, tenantId);
    return true;
  }

  if (user.adminStep === "TS:P_EDIT_PRICE") {
    const amount = parseAmount(text);
    if (!amount || !user.lastProductCode) {
      await reply(user, chatId, "عدد معتبر بفرستید.");
      return true;
    }
    try {
      await patchOwnedProduct(user.lastProductCode, tenantId, {
        costPrice: amount,
        profitPercent: 0,
      });
      await reply(user, chatId, "✅ قیمت به‌روز شد.");
    } catch (err) {
      console.error("PRODUCT PRICE UPDATE:", err.message);
      await reply(user, chatId, "تغییر قیمت ممکن نشد.");
    }
    await showProducts(user, chatId, tenantId);
    return true;
  }

  if (user.adminStep === "TS:P_EDIT_DESC") {
    if (!user.lastProductCode) {
      await showProducts(user, chatId, tenantId);
      return true;
    }
    try {
      await patchOwnedProduct(user.lastProductCode, tenantId, {
        description: text === BTN.SKIP ? null : text.trim(),
      });
      await reply(user, chatId, "✅ توضیحات به‌روز شد.");
    } catch (err) {
      console.error("PRODUCT DESC UPDATE:", err.message);
      await reply(user, chatId, "تغییر توضیحات ممکن نشد.");
    }
    await showProducts(user, chatId, tenantId);
    return true;
  }

  if (isTenantAdminStep(user.adminStep)) {
    await reply(
      user,
      chatId,
      "لطفاً از دکمه‌های همین بخش استفاده کنید یا متن خواسته‌شده را بفرستید.",
      tenantAdminMenu()
    );
    return true;
  }

  return false;
}

async function handleAdminPhoto(user, chatId, photo) {
  const ctx = getBotContext();
  const tenantId = ctx.tenantId;
  if (!(await isShopOwner(user, tenantId))) return false;
  const fileId = photo[photo.length - 1]?.file_id;
  if (!fileId) return false;

  if (user.adminStep === "TS:LOGO") {
    const ok = await patchSettings(tenantId, { logoFileId: fileId });
    await reply(user, chatId, ok ? "✅ لوگو ذخیره شد." : "ذخیره لوگو ممکن نشد.");
    await showAdminHome(user, chatId);
    return true;
  }

  if (user.adminStep === "TS:P_PHOTO" || user.adminStep === "TS:P_EDIT_IMG") {
    if (!user.lastProductCode) return false;
    try {
      await patchOwnedProduct(user.lastProductCode, tenantId, {
        imageUrl: fileId,
      });
      await reply(user, chatId, "✅ عکس کالا ذخیره شد.");
    } catch (err) {
      console.error("PRODUCT IMAGE UPDATE:", err.message);
      await reply(user, chatId, "ذخیره عکس ممکن نشد.");
    }
    await showProducts(user, chatId, tenantId);
    return true;
  }

  return false;
}

async function handleAdminCallback(user, chatId, data) {
  const ctx = getBotContext();
  const tenantId = ctx.tenantId;
  if (!(await isShopOwner(user, tenantId))) return false;

  if (data.startsWith("tcr:")) {
    const categoryId = data.slice(4);
    const cat = await prisma.category.findUnique({
      where: { id: categoryId },
    });
    const owned = cat && cat.tenantId === tenantId;
    if (!owned) {
      await reply(user, chatId, "این دسته پیدا نشد.", tenantCategoriesMenu());
      return true;
    }
    await setStep(user, "TS:CAT_RENAME", { pendingOrderId: categoryId });
    user.pendingOrderId = categoryId;
    await reply(
      user,
      chatId,
      `نام جدید دسته «${cat.title}» را بفرستید:`,
      kb([[{ text: BTN.BACK_PRODUCT_LIST }]])
    );
    return true;
  }

  if (data.startsWith("tcd:")) {
    const categoryId = data.slice(4);
    const cat = await prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!cat || cat.tenantId !== tenantId) {
      await reply(user, chatId, "این دسته پیدا نشد.", tenantCategoriesMenu());
      return true;
    }
    const { sendKeyboard } = require("../bot/bale");
    await sendKeyboard(
      chatId,
      "اگر این دسته حذف شود، کالاهای همین دسته هم از فروشگاه حذف می‌شوند. تأیید می‌کنید؟",
      inlineKb([
        [
          { text: "✅ بله، حذف شود", callback_data: `tcy:${categoryId}`.slice(0, 64) },
        ],
      ])
    );
    return true;
  }

  if (data.startsWith("tcy:")) {
    const categoryId = data.slice(4);
    const catCheck = await prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!catCheck || catCheck.tenantId !== tenantId) {
      await reply(user, chatId, "این دسته پیدا نشد.", tenantCategoriesMenu());
      return true;
    }
    try {
      const products = await prisma.product.findMany({
        where: { tenantId, categoryId },
        select: { id: true },
      });
      const ids = products.map((p) => p.id);
      if (ids.length) {
        try {
          await prisma.cartItem.deleteMany({
            where: { productId: { in: ids } },
          });
        } catch (err) {
          console.error("CAT DELETE CART ITEMS:", err.message);
        }
        try {
          await require("../services/shopCart").deleteItemsForProducts(ids);
        } catch (err) {
          console.error("CAT DELETE SHOP CART ITEMS:", err.message);
        }
        await prisma.product.deleteMany({
          where: { tenantId, categoryId },
        });
      }
      const cat = await prisma.category.findUnique({
        where: { id: categoryId },
      });
      if (cat && cat.tenantId === tenantId) {
        const leftover = await prisma.product.count({
          where: { categoryId, tenantId },
        });
        if (!leftover) {
          await prisma.category.delete({ where: { id: categoryId } });
        }
      }
      await reply(user, chatId, "✅ دسته و کالاهای آن حذف شد.");
    } catch (err) {
      console.error("CATEGORY DELETE:", err.message);
      await reply(
        user,
        chatId,
        "حذف دسته ممکن نشد. اگر کالایی در سفارش ثبت شده باشد، اول آن‌ها را ناموجود کنید."
      );
    }
    await showCategories(user, chatId, tenantId);
    return true;
  }

  if (data.startsWith("tp:") && !data.startsWith("tpe:")) {
    const code = data.slice(3);
    const product = await loadOwnedProduct(code, tenantId);
    if (!product) {
      await reply(user, chatId, "این کالا پیدا نشد.");
      return true;
    }
    await showProductAdmin(user, chatId, product);
    return true;
  }

  if (!data.startsWith("tpe:")) return false;
  const parts = data.split(":");
  const action = parts[1];
  const code = parts.slice(2).join(":");
  const product = await loadOwnedProduct(code, tenantId);
  if (!product) {
    await reply(user, chatId, "این کالا پیدا نشد.");
    return true;
  }

  if (action === "price") {
    await setStep(user, "TS:P_EDIT_PRICE", { lastProductCode: code });
    await reply(
      user,
      chatId,
      `قیمت جدید «${product.title}» را به تومان بفرستید:`,
      kb([[{ text: BTN.BACK_PRODUCT_LIST }]])
    );
    return true;
  }
  if (action === "desc") {
    await setStep(user, "TS:P_EDIT_DESC", { lastProductCode: code });
    await reply(
      user,
      chatId,
      "توضیحات جدید را بفرستید یا رد کنید:",
      kb([[{ text: BTN.SKIP }], [{ text: BTN.BACK_PRODUCT_LIST }]])
    );
    return true;
  }
  if (action === "img") {
    await setStep(user, "TS:P_EDIT_IMG", { lastProductCode: code });
    await reply(
      user,
      chatId,
      "عکس جدید کالا را ارسال کنید:",
      kb([[{ text: BTN.BACK_PRODUCT_LIST }]])
    );
    return true;
  }
  if (action === "stat") {
    const next = product.status === "AVAILABLE" ? "UNAVAILABLE" : "AVAILABLE";
    try {
      await prisma.product.update({
        where: { id: product.id },
        data: { status: next },
      });
      await reply(
        user,
        chatId,
        next === "AVAILABLE" ? "✅ کالا موجود شد." : "کالا ناموجود شد."
      );
    } catch (err) {
      console.error("PRODUCT STATUS:", err.message);
      await reply(user, chatId, "تغییر موجودی ممکن نشد.");
    }
    const fresh = await loadOwnedProduct(code, tenantId);
    if (fresh) await showProductAdmin(user, chatId, fresh);
    return true;
  }
  if (action === "del") {
    const owned = await loadOwnedProduct(code, tenantId);
    if (!owned?.id) {
      await reply(user, chatId, "این کالا پیدا نشد.");
      await showProducts(user, chatId, tenantId);
      return true;
    }
    try {
      await require("../services/shopCart").deleteItemsForProducts([owned.id]);
    } catch (err) {
      console.error("PRODUCT DELETE SHOP CART:", err.message);
    }
    try {
      await prisma.product.delete({ where: { id: owned.id } });
      await reply(user, chatId, "🗑 کالا حذف شد.");
    } catch (err) {
      console.error("PRODUCT DELETE:", err.message);
      await reply(user, chatId, "حذف کالا ممکن نشد. اگر در سبد باشد اول آن را خالی کنید.");
    }
    await showProducts(user, chatId, tenantId);
    return true;
  }

  return true;
}

async function clearTenantAdminState(user) {
  const data = {};
  if (isTenantAdminStep(user.adminStep)) data.adminStep = null;
  if (
    user.orderStep &&
    (String(user.orderStep).startsWith("TSC:") ||
      String(user.orderStep).startsWith("TST:"))
  ) {
    data.orderStep = null;
  }
  if (!Object.keys(data).length) return;
  try {
    await prisma.user.update({
      where: { id: user.id },
      data,
    });
    if (data.adminStep !== undefined) user.adminStep = null;
    if (data.orderStep !== undefined) user.orderStep = null;
  } catch (err) {
    console.error("CLEAR TENANT ADMIN:", err.message);
  }
}

module.exports = {
  isShopOwner,
  isTenantAdminStep,
  loadShopView,
  shopIntroText,
  showAdminHome,
  handleAdminText,
  handleAdminPhoto,
  handleAdminCallback,
  clearTenantAdminState,
};
