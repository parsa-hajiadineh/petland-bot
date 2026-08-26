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
  tenantProfileMenu,
  tenantBankMenu,
  tenantProductsMenu,
  tenantCategoriesMenu,
  backMain,
} = require("../keyboards/menus");

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

async function showAdminHome(user, chatId) {
  await ensureShopRuntimeTables();
  await setStep(user, "TS:MENU");
  await reply(
    user,
    chatId,
    "⚙️ مدیریت فروشگاه\n\nاز اینجا ظاهر فروشگاه، دسته‌ها و کالاها را تنظیم کنید.",
    tenantAdminMenu()
  );
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
    `📂 دسته‌بندی‌های فروشگاه\n\n${lines.join("\n")}`,
    tenantCategoriesMenu()
  );
}

async function findOrCreateCategory(tenantId, title) {
  const name = title.trim();
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
    const existing = await prisma.category.findFirst({
      where: { title: name },
    });
    if (existing) return existing;
    return await prisma.category.create({ data: { title: name } });
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
    return [];
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
  const title = (user.tempDescription || "").trim();
  const categoryTitle = (user.tempProvince || "").trim();
  const price = Number(user.tempCity) || 0;
  const description = (user.tempAddress || "").trim() || null;
  if (!title || !categoryTitle || price < 1) return null;

  const category = await findOrCreateCategory(tenantId, categoryTitle);
  if (!category) return null;

  for (let i = 0; i < 5; i += 1) {
    try {
      return await prisma.product.create({
        data: {
          code: newProductCode(),
          title,
          description,
          costPrice: price,
          profitPercent: 0,
          status: "AVAILABLE",
          categoryId: category.id,
          tenantId,
        },
      });
    } catch (err) {
      console.error("TENANT PRODUCT CREATE:", err.message);
    }
  }
  return null;
}

async function handleAdminText(user, chatId, text) {
  const ctx = getBotContext();
  const tenantId = ctx.tenantId;
  if (!(await isShopOwner(user, tenantId))) return false;

  if (text === BTN.SHOP_ADMIN) {
    await showAdminHome(user, chatId);
    return true;
  }

  if (text === BTN.BACK_PRODUCT_LIST && isTenantAdminStep(user.adminStep)) {
    if (
      user.adminStep === "TS:MENU" ||
      user.adminStep === "TS:PROFILE" ||
      user.adminStep === "TS:BANK" ||
      user.adminStep === "TS:CATS" ||
      user.adminStep === "TS:PRODUCTS" ||
      user.adminStep === "TS:WELCOME" ||
      user.adminStep === "TS:LOGO"
    ) {
      await showAdminHome(user, chatId);
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
      data: { tempCity: String(amount) },
    });
    user.tempCity = String(amount);
    await setStep(user, "TS:P_DESC");
    await reply(
      user,
      chatId,
      "توضیحات کالا را بفرستید یا «رد کردن» را بزنید.",
      kb([[{ text: BTN.SKIP }], [{ text: BTN.BACK_PRODUCT_LIST }]])
    );
    return true;
  }

  if (user.adminStep === "TS:P_DESC") {
    const desc = text === BTN.SKIP ? "" : text.trim();
    await prisma.user.update({
      where: { id: user.id },
      data: { tempAddress: desc },
    });
    user.tempAddress = desc;
    const product = await saveNewProduct(user, tenantId);
    if (!product) {
      await reply(user, chatId, "ثبت کالا ممکن نشد. دوباره از کالای جدید تلاش کنید.");
      await showProducts(user, chatId, tenantId);
      return true;
    }
    await setStep(user, "TS:P_PHOTO", { lastProductCode: product.code });
    user.lastProductCode = product.code;
    await reply(
      user,
      chatId,
      `✅ کالا ثبت شد.\n🔖 ${product.code}\n\nاگر عکس دارید همین‌جا بفرستید، وگرنه «رد کردن» را بزنید.`,
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
      await prisma.product.update({
        where: { code: user.lastProductCode },
        data: { costPrice: amount, profitPercent: 0 },
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
      await prisma.product.update({
        where: { code: user.lastProductCode },
        data: { description: text === BTN.SKIP ? null : text.trim() },
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
      await prisma.product.update({
        where: { code: user.lastProductCode },
        data: { imageUrl: fileId },
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
        where: { code },
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
    try {
      await prisma.product.delete({ where: { code } });
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
  if (user.orderStep && String(user.orderStep).startsWith("TSC:")) {
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
