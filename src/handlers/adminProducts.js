const prisma = require("../database/prisma");
const { getMotherTenantId } = require("../database/prisma");
const { DEFAULT_PROFIT_PERCENT } = require("../config");
const { reply } = require("../bot/messenger");
const bale = require("../bot/bale");
const {
  BTN,
  PRODUCT_CATEGORIES,
  adminBackMenu,
  adminProductsMenu,
  inlineKb,
  kb,
} = require("../keyboards/menus");
const { formatPrice, calcRetailPrice } = require("../utils/price");
const { isAdmin } = require("../services/user");

const STEP_HUB = "ADMIN_PRODUCTS";
const STEP_PHOTO = "AP:PHOTO";
const STEP_DESC = "AP:DESC";
const STEP_PRICE = "AP:PRICE";
const STEP_DEL = "AP:DEL";
const STEP_ADD_CODE = "AP:ADD_CODE";
const STEP_ADD_TITLE = "AP:ADD_TITLE";
const STEP_ADD_PRICE = "AP:ADD_PRICE";
const STEP_ADD_DESC = "AP:ADD_DESC";
const STEP_ADD_CAT = "AP:ADD_CAT";
const STEP_ADD_BRAND = "AP:ADD_BRAND";

const CODES = {
  "photo-s": "photo",
  "desc-s": "desc",
  "price-s": "price",
};

function isProductAdminStep(step) {
  const value = String(step || "");
  return value === STEP_HUB || value.startsWith("AP:");
}

function helpText() {
  return [
    "📦 مدیریت محصولات",
    "",
    "کدهای ویرایش سریع — محصول را از منوی اصلی «محصولات» باز کنید و در همان صفحه بفرستید:",
    "• photo-s  تنظیم / تعویض عکس",
    "• desc-s  تغییر توضیحات",
    "• price-s  تغییر قیمت همکاری",
    "",
    "اگر محصول عکس داشته باشد، عکس قبلی حذف می‌شود و عکس جدید گرفته می‌شود.",
  ].join("\n");
}

function toEnDigits(value) {
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  return String(value || "")
    .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)));
}

function parseToman(text) {
  const digits = toEnDigits(text).replace(/[^\d]/g, "");
  return Number(digits) || 0;
}

function readDraft(user) {
  try {
    const parsed = JSON.parse(user.tempDescription || "{}");
    if (parsed && typeof parsed === "object" && parsed._ap) return parsed;
  } catch {
    /* ignore */
  }
  return { _ap: true };
}

async function writeDraft(user, step, patch = {}) {
  const next = { ...readDraft(user), ...patch, _ap: true };
  await prisma.user.update({
    where: { id: user.id },
    data: {
      adminStep: step,
      tempDescription: JSON.stringify(next),
    },
  });
  user.adminStep = step;
  user.tempDescription = JSON.stringify(next);
  return next;
}

async function setStep(user, step, extras = {}) {
  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: step, ...extras },
  });
  user.adminStep = step;
  Object.assign(user, extras);
}

function isBusyForQuick(user) {
  const admin = user.adminStep || "";
  const order = user.orderStep || "";
  if (
    order === "PRODUCT_QTY" ||
    order === "TICKET_MESSAGE" ||
    order === "SEARCH" ||
    order === "UPLOAD_RECEIPT" ||
    order.startsWith("CHECKOUT") ||
    order.startsWith("COLLEAGUE")
  ) {
    return true;
  }
  if (!admin) return false;
  if (admin === STEP_HUB || admin === STEP_PHOTO) return false;
  if (admin.startsWith("AP:")) return true;
  return true;
}

async function loadMotherProduct(code) {
  if (!code) return null;
  const motherId = getMotherTenantId();
  const where = motherId
    ? { code, OR: [{ tenantId: null }, { tenantId: motherId }] }
    : { code };
  return prisma.product.findFirst({
    where,
    include: { category: { select: { id: true, title: true } } },
  });
}

async function refreshProduct(user, chatId, code) {
  const productsHandler = require("./products");
  const product = await productsHandler.loadProductByCode(code);
  if (product) {
    await productsHandler.showProduct(user, chatId, product);
    return;
  }
  await reply(user, chatId, "محصول به‌روز شد.", adminBackMenu());
}

async function ensureCategory(title) {
  const motherId = getMotherTenantId();
  const where = motherId
    ? { title, OR: [{ tenantId: null }, { tenantId: motherId }] }
    : { title };
  let category = await prisma.category.findFirst({ where });
  if (!category) {
    category = await prisma.category.create({
      data: { title, tenantId: motherId || undefined },
    });
  }
  return category;
}

async function showHub(user, chatId) {
  await setStep(user, STEP_HUB, { tempDescription: null });
  await reply(user, chatId, helpText(), adminProductsMenu());
}

async function startPhoto(user, chatId, product) {
  if (product.imageUrl) {
    await prisma.product.update({
      where: { id: product.id },
      data: { imageUrl: null },
    });
    await setStep(user, STEP_PHOTO, { lastProductCode: product.code });
    await reply(
      user,
      chatId,
      `عکس قبلی «${product.title}» حذف شد.\nعکس جدید را بفرستید:`,
      adminBackMenu()
    );
    return;
  }
  await setStep(user, STEP_PHOTO, { lastProductCode: product.code });
  await reply(
    user,
    chatId,
    `این محصول عکس ندارد.\nعکس «${product.title}» را بفرستید:`,
    adminBackMenu()
  );
}

async function handleQuick(user, chatId, text) {
  if (!isAdmin(user)) return false;
  const key = String(text || "").trim().toLowerCase();
  const kind = CODES[key];
  if (!kind) return false;
  if (isBusyForQuick(user)) return false;
  if (!user.lastProductCode) {
    await reply(
      user,
      chatId,
      "اول محصول را از بخش محصولات باز کنید، بعد این کد را بفرستید.",
      adminBackMenu()
    );
    return true;
  }
  const product = await loadMotherProduct(user.lastProductCode);
  if (!product) {
    await reply(user, chatId, "محصول پیدا نشد. دوباره از لیست باز کنید.", adminBackMenu());
    return true;
  }

  if (kind === "photo") {
    await startPhoto(user, chatId, product);
    return true;
  }
  if (kind === "desc") {
    await setStep(user, STEP_DESC, { lastProductCode: product.code });
    await reply(
      user,
      chatId,
      `توضیحات فعلی:\n${product.description || "—"}\n\nتوضیحات جدید «${product.title}» را بفرستید:`,
      adminBackMenu()
    );
    return true;
  }
  if (kind === "price") {
    await setStep(user, STEP_PRICE, { lastProductCode: product.code });
    await reply(
      user,
      chatId,
      `قیمت همکاری فعلی: ${formatPrice(product.costPrice)}\nقیمت خرد فعلی: ${formatPrice(calcRetailPrice(product))}\n\nقیمت همکاری جدید «${product.title}» را به تومان بفرستید:`,
      adminBackMenu()
    );
    return true;
  }
  return false;
}

function categoryRows() {
  const rows = [];
  for (let i = 0; i < PRODUCT_CATEGORIES.length; i += 2) {
    const row = [
      { text: PRODUCT_CATEGORIES[i].btn, callback_data: `apc:${i}` },
    ];
    if (PRODUCT_CATEGORIES[i + 1]) {
      row.push({
        text: PRODUCT_CATEGORIES[i + 1].btn,
        callback_data: `apc:${i + 1}`,
      });
    }
    rows.push(row);
  }
  return rows;
}

function brandRows(catIndex) {
  const cat = PRODUCT_CATEGORIES[catIndex];
  if (!cat) return [];
  const rows = [];
  for (let i = 0; i < cat.subMenus.length; i += 2) {
    const row = [
      { text: cat.subMenus[i], callback_data: `apb:${catIndex}:${i}` },
    ];
    if (cat.subMenus[i + 1]) {
      row.push({
        text: cat.subMenus[i + 1],
        callback_data: `apb:${catIndex}:${i + 1}`,
      });
    }
    rows.push(row);
  }
  return rows;
}

async function askCategory(user, chatId) {
  await writeDraft(user, STEP_ADD_CAT);
  await reply(user, chatId, "دسته اصلی را انتخاب کنید:", adminBackMenu());
  await bale.sendKeyboard(chatId, "روی دسته بزنید:", inlineKb(categoryRows()));
}

async function saveNewProduct(user, chatId, draft) {
  const code = String(draft.code || "").trim().toUpperCase();
  const title = String(draft.title || "").trim();
  const costPrice = Number(draft.price) || 0;
  const description = String(draft.desc || "").trim() || null;
  const cat = PRODUCT_CATEGORIES[Number(draft.catIndex)];
  const brand = cat?.subMenus[Number(draft.brandIndex)];
  if (!code || !title || costPrice < 1 || !cat || !brand) {
    await reply(user, chatId, "مشخصات ناقص است. دوباره از افزودن شروع کنید.", adminProductsMenu());
    await setStep(user, STEP_HUB);
    return;
  }
  const exists = await prisma.product.findUnique({ where: { code } });
  if (exists) {
    await reply(user, chatId, "این کد قبلاً ثبت شده. کد دیگری بفرستید.", adminBackMenu());
    await writeDraft(user, STEP_ADD_CODE, draft);
    return;
  }
  const category = await ensureCategory(cat.btn);
  const motherId = getMotherTenantId();
  const created = await prisma.product.create({
    data: {
      code,
      title,
      description,
      costPrice,
      profitPercent: DEFAULT_PROFIT_PERCENT,
      brand,
      status: "AVAILABLE",
      categoryId: category.id,
      tenantId: motherId || undefined,
    },
  });
  await setStep(user, STEP_HUB, {
    lastProductCode: created.code,
    tempDescription: null,
  });
  await reply(
    user,
    chatId,
    `✅ محصول ثبت شد.\n🔖 ${created.code}\n📦 ${created.title}\n💰 ${formatPrice(created.costPrice)}\n📂 ${cat.btn} › ${brand}`,
    adminProductsMenu()
  );
}

async function handleCallback(user, chatId, data) {
  if (!isAdmin(user)) return false;
  if (data.startsWith("apc:")) {
    const index = Number(data.slice(4));
    const cat = PRODUCT_CATEGORIES[index];
    if (!cat) return true;
    await writeDraft(user, STEP_ADD_BRAND, { catIndex: index });
    await reply(
      user,
      chatId,
      `${cat.btn}\nزیرمنو را انتخاب کنید:`,
      adminBackMenu()
    );
    await bale.sendKeyboard(chatId, "روی زیرمنو بزنید:", inlineKb(brandRows(index)));
    return true;
  }
  if (data.startsWith("apb:")) {
    const parts = data.slice(4).split(":");
    const catIndex = Number(parts[0]);
    const brandIndex = Number(parts[1]);
    const draft = readDraft(user);
    await saveNewProduct(user, chatId, { ...draft, catIndex, brandIndex });
    return true;
  }
  return false;
}

async function handlePhoto(user, chatId, photo) {
  if (!isAdmin(user)) return false;
  if (user.adminStep !== STEP_PHOTO && user.adminStep !== "SET_IMAGE_UPLOAD") {
    return false;
  }
  if (!user.lastProductCode || !photo?.length) return false;
  const fileId = photo[photo.length - 1].file_id;
  const product = await loadMotherProduct(user.lastProductCode);
  if (!product) {
    await reply(user, chatId, "محصول پیدا نشد.", adminBackMenu());
    return true;
  }
  await prisma.product.update({
    where: { id: product.id },
    data: { imageUrl: fileId },
  });
  await setStep(user, null, { lastProductCode: product.code });
  await reply(user, chatId, "✅ عکس محصول ذخیره شد.");
  await refreshProduct(user, chatId, product.code);
  return true;
}

async function goBack(user, chatId) {
  const step = user.adminStep || "";
  if (!isProductAdminStep(step) && step !== "SET_IMAGE_UPLOAD" && step !== "SET_IMAGE_CODE") {
    return false;
  }
  if (step === STEP_PHOTO || step === STEP_DESC || step === STEP_PRICE || step === "SET_IMAGE_UPLOAD") {
    const code = user.lastProductCode;
    await setStep(user, null);
    if (code) await refreshProduct(user, chatId, code);
    else await showHub(user, chatId);
    return true;
  }
  if (step === STEP_ADD_TITLE) {
    await writeDraft(user, STEP_ADD_CODE);
    await reply(user, chatId, "کد محصول را بفرستید. مثال: RCC-099", adminBackMenu());
    return true;
  }
  if (step === STEP_ADD_PRICE) {
    await writeDraft(user, STEP_ADD_TITLE);
    await reply(user, chatId, "نام محصول را بفرستید:", adminBackMenu());
    return true;
  }
  if (step === STEP_ADD_DESC) {
    await writeDraft(user, STEP_ADD_PRICE);
    await reply(user, chatId, "قیمت همکاری را به تومان بفرستید:", adminBackMenu());
    return true;
  }
  if (step === STEP_ADD_CAT) {
    await writeDraft(user, STEP_ADD_DESC);
    await reply(
      user,
      chatId,
      "توضیحات محصول را بفرستید یا «رد کردن» را بزنید:",
      kb([[{ text: BTN.SKIP }], [{ text: BTN.BACK_PRODUCT_LIST }]])
    );
    return true;
  }
  if (step === STEP_ADD_BRAND) {
    await askCategory(user, chatId);
    return true;
  }
  if (step === STEP_ADD_CODE || step === STEP_DEL || step === "SET_IMAGE_CODE") {
    await showHub(user, chatId);
    return true;
  }
  if (step === STEP_HUB) return false;
  await showHub(user, chatId);
  return true;
}

async function handleText(user, chatId, text) {
  if (!isAdmin(user)) return false;

  if (await handleQuick(user, chatId, text)) return true;

  if (text === BTN.AP_ADD) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        adminStep: STEP_ADD_CODE,
        tempDescription: JSON.stringify({ _ap: true }),
      },
    });
    user.adminStep = STEP_ADD_CODE;
    user.tempDescription = JSON.stringify({ _ap: true });
    await reply(user, chatId, "کد محصول را بفرستید. مثال: RCC-099", adminBackMenu());
    return true;
  }
  if (text === BTN.AP_DEL) {
    await setStep(user, STEP_DEL, { tempDescription: null });
    await reply(
      user,
      chatId,
      "کد محصولی که باید حذف شود را بفرستید:",
      adminBackMenu()
    );
    return true;
  }

  if (!isProductAdminStep(user.adminStep) && user.adminStep !== "SET_IMAGE_UPLOAD") {
    return false;
  }

  if (text === BTN.BACK_PRODUCT_LIST || text === BTN.BACK_MAIN) return false;
  if (Object.values(BTN).includes(text) && text !== BTN.SKIP) return false;

  if (user.adminStep === STEP_DESC) {
    const product = await loadMotherProduct(user.lastProductCode);
    if (!product) {
      await reply(user, chatId, "محصول پیدا نشد.", adminBackMenu());
      return true;
    }
    await prisma.product.update({
      where: { id: product.id },
      data: { description: text.trim() || null },
    });
    await setStep(user, null, { lastProductCode: product.code });
    await reply(user, chatId, "✅ توضیحات به‌روز شد.");
    await refreshProduct(user, chatId, product.code);
    return true;
  }

  if (user.adminStep === STEP_PRICE) {
    const amount = parseToman(text);
    if (amount < 1) {
      await reply(user, chatId, "یک مبلغ معتبر به تومان بفرستید.", adminBackMenu());
      return true;
    }
    const product = await loadMotherProduct(user.lastProductCode);
    if (!product) {
      await reply(user, chatId, "محصول پیدا نشد.", adminBackMenu());
      return true;
    }
    await prisma.product.update({
      where: { id: product.id },
      data: { costPrice: amount },
    });
    await setStep(user, null, { lastProductCode: product.code });
    await reply(user, chatId, `✅ قیمت همکاری ${formatPrice(amount)} شد.`);
    await refreshProduct(user, chatId, product.code);
    return true;
  }

  if (user.adminStep === STEP_DEL) {
    const code = text.trim().toUpperCase();
    const product = await loadMotherProduct(code);
    if (!product) {
      await reply(user, chatId, "محصول پیدا نشد.", adminBackMenu());
      return true;
    }
    const orders = await prisma.orderItem.count({ where: { productId: product.id } });
    if (orders) {
      await prisma.product.update({
        where: { id: product.id },
        data: { status: "UNAVAILABLE" },
      });
      await setStep(user, STEP_HUB, { tempDescription: null });
      await reply(
        user,
        chatId,
        `این محصول در سفارش‌ها استفاده شده و حذف کامل ممکن نیست.\n«${product.title}» ناموجود شد.`,
        adminProductsMenu()
      );
      return true;
    }
    try {
      await prisma.cartItem.deleteMany({ where: { productId: product.id } });
      await prisma.tenantProduct.deleteMany({ where: { productId: product.id } }).catch(() => {});
      await prisma.product.delete({ where: { id: product.id } });
      await setStep(user, STEP_HUB, { tempDescription: null });
      await reply(
        user,
        chatId,
        `🗑 «${product.title}» (${product.code}) حذف شد.`,
        adminProductsMenu()
      );
    } catch (err) {
      console.error("PRODUCT DELETE:", err.message);
      await reply(user, chatId, "حذف ممکن نشد. محصول را ناموجود کنید.", adminProductsMenu());
    }
    return true;
  }

  if (user.adminStep === STEP_ADD_CODE) {
    const code = text.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,8}-[A-Z0-9]{2,8}$/i.test(code)) {
      await reply(
        user,
        chatId,
        "کد را شبیه نمونه بفرستید. مثال: RCC-099",
        adminBackMenu()
      );
      return true;
    }
    const exists = await prisma.product.findUnique({ where: { code } });
    if (exists) {
      await reply(user, chatId, "این کد قبلاً ثبت شده.", adminBackMenu());
      return true;
    }
    await writeDraft(user, STEP_ADD_TITLE, { code });
    await reply(user, chatId, "نام محصول را بفرستید:", adminBackMenu());
    return true;
  }

  if (user.adminStep === STEP_ADD_TITLE) {
    const title = text.trim();
    if (!title) {
      await reply(user, chatId, "نام محصول را بفرستید:", adminBackMenu());
      return true;
    }
    await writeDraft(user, STEP_ADD_PRICE, { title });
    await reply(user, chatId, "قیمت همکاری را به تومان بفرستید:", adminBackMenu());
    return true;
  }

  if (user.adminStep === STEP_ADD_PRICE) {
    const amount = parseToman(text);
    if (amount < 1) {
      await reply(user, chatId, "یک مبلغ معتبر به تومان بفرستید.", adminBackMenu());
      return true;
    }
    await writeDraft(user, STEP_ADD_DESC, { price: amount });
    await reply(
      user,
      chatId,
      "توضیحات محصول را بفرستید یا «رد کردن» را بزنید:",
      kb([[{ text: BTN.SKIP }], [{ text: BTN.BACK_PRODUCT_LIST }]])
    );
    return true;
  }

  if (user.adminStep === STEP_ADD_DESC) {
    const desc = text === BTN.SKIP ? "" : text.trim();
    await writeDraft(user, STEP_ADD_CAT, { desc });
    await askCategory(user, chatId);
    return true;
  }

  if (user.adminStep === STEP_PHOTO || user.adminStep === "SET_IMAGE_UPLOAD") {
    await reply(user, chatId, "الان فقط عکس محصول را بفرستید.", adminBackMenu());
    return true;
  }

  return false;
}

module.exports = {
  isProductAdminStep,
  showHub,
  handleText,
  handleCallback,
  handlePhoto,
  goBack,
  helpText,
};
