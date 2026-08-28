const prisma = require("../database/prisma");
const { ORDER_WITH_ITEMS_SELECT } = require("../database/selects");
const { reply, notify } = require("../bot/messenger");
const { getBotContext } = require("../bot/context");
const bale = require("../bot/bale");
const shopCart = require("../services/shopCart");
const tenantAdmin = require("./tenantAdmin");
const {
  BTN,
  kb,
  inlineKb,
  backMain,
  checkoutSkipMenu,
  paymentMenu,
  confirmAddressMenu,
  tenantMainMenu,
  tenantAdminMenu,
  shopOrdersMenu,
  adminOrderActions,
  adminApprovedActions,
} = require("../keyboards/menus");
const { getUnitPrice } = require("../utils/price");
const {
  generateTenantTrackingCode,
  statusLabel,
} = require("../utils/order");
const {
  buildInvoiceText,
  buildPaymentInfo,
  buildTenantShippingInfo,
} = require("../utils/invoice");

const QTY_STEP = "TCK:QTY";
const RECEIPT_STEP = "TCK:RECEIPT";

function parseQty(text) {
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

async function shopMenu(user) {
  const ctx = getBotContext();
  const owner = await tenantAdmin.isShopOwner(user, ctx.tenantId);
  return tenantMainMenu(owner);
}

async function paymentBank(tenantId) {
  const shop = await tenantAdmin.loadShopView(tenantId);
  return {
    shop,
    bank: {
      card: shop.bankCard,
      iban: shop.bankIban,
      holder: shop.bankHolder,
      name: shop.bankName,
    },
  };
}

async function notifyShopOwner(tenantId, text) {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { ownerUserId: true },
    });
    if (!tenant?.ownerUserId) return;
    const owner = await prisma.user.findUnique({
      where: { id: tenant.ownerUserId },
      select: { baleId: true },
    });
    if (owner?.baleId) await notify(owner.baleId, text);
  } catch (err) {
    console.error("SHOP OWNER NOTIFY:", err.message);
  }
}

async function notifyCustomer(order, message) {
  try {
    const owner = await prisma.user.findUnique({
      where: { id: order.userId },
      select: { baleId: true },
    });
    if (!owner?.baleId) return;
    await notify(
      owner.baleId,
      `📢 ${message}\n\n🔖 ${order.trackingCode}\n📊 ${statusLabel(order.status)}`
    );
  } catch (err) {
    console.error("SHOP CUSTOMER NOTIFY:", err.message);
  }
}

function tsOrderQueries(whereExtra) {
  const ctx = getBotContext();
  const queries = [];
  if (!ctx.tenantId) return { queries, tenantId: null };
  const extra = whereExtra || {};
  queries.push({
    trackingCode: { startsWith: "TS-" },
    tenantId: ctx.tenantId,
    ...extra,
  });
  queries.push({
    trackingCode: { startsWith: "TS-" },
    tenantId: null,
    items: { some: { product: { tenantId: ctx.tenantId } } },
    ...extra,
  });
  return { queries, tenantId: ctx.tenantId };
}

async function findTsOrders(whereExtra, select, take = 20, skip = 0) {
  const { queries, tenantId } = tsOrderQueries(whereExtra);
  if (!queries.length) return [];
  let lastErr;
  let scopedOk = false;
  for (let i = 0; i < queries.length; i++) {
    const isLast = i === queries.length - 1;
    if (isLast && scopedOk && tenantId) return [];
    try {
      const rows = await prisma.order.findMany({
        where: queries[i],
        orderBy: { createdAt: "desc" },
        take,
        skip,
        select,
      });
      if (!isLast) scopedOk = true;
      if (rows.length || isLast) return rows;
    } catch (err) {
      lastErr = err;
      console.error("TENANT ORDERS QUERY SKIP:", err.message);
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

async function findTsOrder(whereExtra, select) {
  const { queries } = tsOrderQueries(whereExtra);
  if (!queries.length) return null;
  let lastErr;
  let ok = false;
  for (const where of queries) {
    try {
      const row = await prisma.order.findFirst({
        where,
        orderBy: { createdAt: "desc" },
        select,
      });
      ok = true;
      if (row) return row;
    } catch (err) {
      lastErr = err;
      console.error("TENANT ORDER QUERY SKIP:", err.message);
    }
  }
  if (!ok && lastErr) throw lastErr;
  return null;
}

async function createTenantOrder(user, data, retries = 4) {
  const ctx = getBotContext();
  if (!ctx.tenantId) {
    throw new Error("TENANT_ORDER_NO_CONTEXT");
  }
  let lastErr;
  for (let i = 0; i < retries; i++) {
    const trackingCode = generateTenantTrackingCode();
    const payload = {
      ...data,
      trackingCode,
      tenantId: ctx.tenantId,
      botId: ctx.botId || null,
    };
    try {
      return await prisma.order.create({
        data: payload,
        select: ORDER_WITH_ITEMS_SELECT,
      });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

module.exports.startAddToCart = async function startAddToCart(user, chatId) {
  const ctx = getBotContext();
  const productsHandler = require("./products");
  if (!user.lastProductCode) {
    await reply(user, chatId, "محصولی انتخاب نشده است.", await shopMenu(user));
    return;
  }
  const product = await productsHandler.loadTenantProductByCode(
    user.lastProductCode,
    ctx.tenantId
  );
  if (!product || product.status !== "AVAILABLE") {
    await reply(user, chatId, "این محصول موجود نیست.", await shopMenu(user));
    return;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: QTY_STEP },
  });
  user.orderStep = QTY_STEP;
  await reply(
    user,
    chatId,
    "🔢 تعداد مورد نظر را وارد کنید (عدد):",
    kb([[{ text: BTN.BACK_MAIN }]])
  );
};

module.exports.handleQty = async function handleQty(user, chatId, text) {
  if (user.orderStep !== QTY_STEP) return false;
  const qty = parseQty(text);
  if (!qty) {
    await reply(user, chatId, "لطفاً یک عدد معتبر وارد کنید.", kb([[{ text: BTN.BACK_MAIN }]]));
    return true;
  }
  const ctx = getBotContext();
  const productsHandler = require("./products");
  const product = await productsHandler.loadTenantProductByCode(
    user.lastProductCode,
    ctx.tenantId
  );
  if (!product || product.status !== "AVAILABLE") {
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: null },
    });
    await reply(user, chatId, "محصول موجود نیست.", await shopMenu(user));
    return true;
  }
  try {
    await shopCart.addItem(user.id, ctx.tenantId, product, qty);
  } catch (err) {
    console.error("SHOP ADD CART:", err);
    await reply(user, chatId, "افزودن به سبد ممکن نشد.", await shopMenu(user));
    return true;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: null },
  });
  user.orderStep = null;
  await reply(
    user,
    chatId,
    `✅ ${qty} عدد «${product.title}» به سبد اضافه شد.`,
    kb([
      [{ text: BTN.CART }],
      [{ text: BTN.PRODUCTS }],
      [{ text: BTN.BACK_MAIN }],
    ])
  );
  return true;
};

module.exports.showCart = async function showCart(user, chatId) {
  await shopCart.showCart(user, chatId, getBotContext().tenantId);
};

module.exports.clearCart = async function clearCart(user, chatId) {
  await shopCart.clearCart(user, chatId, getBotContext().tenantId);
};

module.exports.startCheckout = async function startCheckout(user, chatId) {
  const ctx = getBotContext();
  try {
    await require("../services/shopProvision").ensureShopRuntimeTables();
  } catch (err) {
    console.error("SHOP CHECKOUT TABLES:", err.message);
  }
  const check = await shopCart.validateCheckout(user.id, ctx.tenantId);
  if (!check.ok) {
    await reply(user, chatId, check.message, await shopMenu(user));
    return;
  }

  const savedAddresses = await prisma.savedAddress.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 3,
  });

  if (savedAddresses.length > 0) {
    const rows = savedAddresses.map((addr) => [
      {
        text: `📍 ${addr.fullName} | ${addr.city}`,
        callback_data: `taddr:view:${addr.id}`.slice(0, 64),
      },
    ]);
    rows.push([{ text: "➕ آدرس جدید", callback_data: "taddr:new" }]);
    await reply(
      user,
      chatId,
      "📦 ثبت سفارش\n\nیک آدرس ذخیره‌شده انتخاب کنید یا آدرس جدید وارد کنید:",
      backMain()
    );
    const result = await bale.sendKeyboard(
      chatId,
      "آدرس‌های ذخیره‌شده شما:",
      inlineKb(rows)
    );
    const msgId = result?.result?.message_id;
    if (msgId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { lastMessageId: msgId },
      });
    }
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: "TCK:NAME" },
  });
  await reply(
    user,
    chatId,
    "📝 ثبت سفارش\n\n👤 نام و نام خانوادگی گیرنده را وارد کنید:",
    backMain()
  );
};

module.exports.handleCheckoutStep = async function handleCheckoutStep(
  user,
  chatId,
  text
) {
  const step = user.orderStep;
  if (!step || !String(step).startsWith("TCK:")) return false;
  if (step === QTY_STEP || step === RECEIPT_STEP || step === "TCK:ADDR") {
    return false;
  }

  if (step === "TCK:NAME") {
    await prisma.user.update({
      where: { id: user.id },
      data: { fullName: text, orderStep: "TCK:PHONE" },
    });
    await reply(user, chatId, "📱 شماره موبایل را وارد کنید:", backMain());
    return true;
  }
  if (step === "TCK:PHONE") {
    await prisma.user.update({
      where: { id: user.id },
      data: { phone: text, orderStep: "TCK:PROVINCE" },
    });
    await reply(user, chatId, "🏙 نام استان را وارد کنید:", backMain());
    return true;
  }
  if (step === "TCK:PROVINCE") {
    await prisma.user.update({
      where: { id: user.id },
      data: { tempProvince: text, orderStep: "TCK:CITY" },
    });
    await reply(user, chatId, "🏘 نام شهر را وارد کنید:", backMain());
    return true;
  }
  if (step === "TCK:CITY") {
    await prisma.user.update({
      where: { id: user.id },
      data: { tempCity: text, orderStep: "TCK:ADDRESS" },
    });
    await reply(user, chatId, "📍 آدرس کامل را وارد کنید:", backMain());
    return true;
  }
  if (step === "TCK:ADDRESS") {
    await prisma.user.update({
      where: { id: user.id },
      data: { tempAddress: text, orderStep: "TCK:POSTAL" },
    });
    await reply(user, chatId, "📮 کد پستی را وارد کنید:", backMain());
    return true;
  }
  if (step === "TCK:POSTAL") {
    await prisma.user.update({
      where: { id: user.id },
      data: { tempPostalCode: text, orderStep: "TCK:DESC" },
    });
    await reply(
      user,
      chatId,
      "📝 توضیحات تکمیلی (اختیاری):\nیا «⏭ رد کردن» را بزنید.",
      checkoutSkipMenu()
    );
    return true;
  }
  if (step === "TCK:DESC") {
    const desc = text === BTN.SKIP ? null : text;
    await finalizeOrder(user, chatId, desc);
    return true;
  }
  return false;
};

async function finalizeOrder(user, chatId, description) {
  const ctx = getBotContext();
  const fresh = await prisma.user.findUnique({ where: { id: user.id } });
  const check = await shopCart.validateCheckout(fresh.id, ctx.tenantId);
  if (!check.ok) {
    await reply(user, chatId, check.message, await shopMenu(fresh));
    return;
  }

  const { shop, bank } = await paymentBank(ctx.tenantId);
  let order;
  try {
    order = await createTenantOrder(fresh, {
      status: "WAITING_PAYMENT",
      fullName: fresh.fullName,
      phone: fresh.phone,
      province: fresh.tempProvince,
      city: fresh.tempCity,
      address: fresh.tempAddress,
      postalCode: fresh.tempPostalCode,
      description,
      totalAmount: check.total,
      isWholesale: false,
      userId: fresh.id,
      items: {
        create: check.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: getUnitPrice(item.product, false),
        })),
      },
    });
  } catch (err) {
    console.error("TENANT ORDER CREATE:", err);
    await reply(user, chatId, "ثبت سفارش ممکن نشد. لطفاً دوباره تلاش کنید.", await shopMenu(fresh));
    return;
  }

  try {
    await shopCart.clearItems(check.cartId);
  } catch (err) {
    console.error("CLEAR SHOP CART AFTER ORDER:", err.message);
  }

  const savedCount = await prisma.savedAddress.count({
    where: { userId: fresh.id },
  });
  if (savedCount < 3) {
    const duplicateAddr = await prisma.savedAddress.findFirst({
      where: {
        userId: fresh.id,
        fullName: fresh.fullName,
        phone: fresh.phone,
        city: fresh.tempCity,
        address: fresh.tempAddress,
      },
    });
    if (!duplicateAddr) {
      await prisma.savedAddress.create({
        data: {
          fullName: fresh.fullName,
          phone: fresh.phone,
          province: fresh.tempProvince,
          city: fresh.tempCity,
          address: fresh.tempAddress,
          postalCode: fresh.tempPostalCode || null,
          userId: fresh.id,
        },
      });
    }
  }

  await prisma.user.update({
    where: { id: fresh.id },
    data: {
      orderStep: RECEIPT_STEP,
      pendingOrderId: order.id,
      tempProvince: null,
      tempCity: null,
      tempAddress: null,
      tempPostalCode: null,
      tempDescription: null,
    },
  });

  const invoice = buildInvoiceText(order, order.items, shop.name);
  await reply(
    fresh,
    chatId,
    `${invoice}\n\n${buildTenantShippingInfo(shop)}\n\n${buildPaymentInfo(bank)}`,
    paymentMenu()
  );
}

module.exports.handleSavedAddressView = async function handleSavedAddressView(
  user,
  chatId,
  addressId
) {
  const addr = await prisma.savedAddress.findFirst({
    where: { id: addressId, userId: user.id },
  });
  if (!addr) {
    await reply(user, chatId, "❌ آدرس مورد نظر یافت نشد.", backMain());
    return;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: "TCK:ADDR", tempAddressId: addr.id },
  });
  const text =
    `📍 اطلاعات ارسال ذخیره‌شده:\n\n` +
    `👤 نام: ${addr.fullName}\n` +
    `📱 موبایل: ${addr.phone}\n` +
    `🏙 استان: ${addr.province}\n` +
    `🏘 شهر: ${addr.city}\n` +
    `📍 آدرس: ${addr.address}` +
    (addr.postalCode ? `\n📮 کد پستی: ${addr.postalCode}` : "");
  await reply(user, chatId, text, confirmAddressMenu());
};

module.exports.confirmSavedAddress = async function confirmSavedAddress(
  user,
  chatId
) {
  if (user.orderStep !== "TCK:ADDR" || !user.tempAddressId) {
    await reply(user, chatId, "❌ لطفاً ابتدا یک آدرس از لیست انتخاب کنید.", backMain());
    return;
  }
  const addr = await prisma.savedAddress.findFirst({
    where: { id: user.tempAddressId, userId: user.id },
  });
  if (!addr) {
    await reply(user, chatId, "❌ آدرس مورد نظر یافت نشد.", backMain());
    return;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      fullName: addr.fullName,
      phone: addr.phone,
      tempProvince: addr.province,
      tempCity: addr.city,
      tempAddress: addr.address,
      tempPostalCode: addr.postalCode || null,
      tempAddressId: null,
      orderStep: null,
    },
  });
  const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
  await finalizeOrder(freshUser, chatId, null);
};

module.exports.deleteSavedAddress = async function deleteSavedAddress(
  user,
  chatId
) {
  if (!user.tempAddressId) {
    await reply(user, chatId, "❌ آدرسی برای حذف انتخاب نشده است.", backMain());
    return;
  }
  await prisma.savedAddress.deleteMany({
    where: { id: user.tempAddressId, userId: user.id },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: null, tempAddressId: null },
  });
  await reply(user, chatId, "✅ آدرس ذخیره‌شده حذف شد.");
  const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
  await module.exports.startCheckout(updatedUser, chatId);
};

module.exports.startNewAddress = async function startNewAddress(user, chatId) {
  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: "TCK:NAME", tempAddressId: null },
  });
  await reply(
    user,
    chatId,
    "📝 ثبت سفارش\n\n👤 نام و نام خانوادگی گیرنده را وارد کنید:",
    backMain()
  );
};

module.exports.promptReceipt = async function promptReceipt(user, chatId) {
  let pendingId = user.pendingOrderId;
  if (pendingId) {
    const existing = await findTsOrder(
      { id: pendingId, userId: user.id },
      { id: true }
    );
    if (!existing) pendingId = null;
  }
  if (!pendingId) {
    const pending = await findTsOrder(
      { userId: user.id, status: "WAITING_PAYMENT" },
      { id: true }
    );
    pendingId = pending?.id;
  }
  if (!pendingId) {
    await reply(user, chatId, "سفارشی در انتظار پرداخت ندارید.", await shopMenu(user));
    return;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: RECEIPT_STEP, pendingOrderId: pendingId },
  });
  user.orderStep = RECEIPT_STEP;
  user.pendingOrderId = pendingId;
  await reply(user, chatId, "📸 لطفاً اسکرین‌شات رسید پرداخت را ارسال کنید.");
};

module.exports.handleReceiptPhoto = async function handleReceiptPhoto(
  user,
  chatId,
  photo
) {
  const ctx = getBotContext();
  const fileId =
    photo[photo.length - 1]?.file_id || photo[photo.length - 1]?.fileId;
  if (!fileId) return false;

  if (user.orderStep !== RECEIPT_STEP) return false;

  let pendingId = user.pendingOrderId;
  if (pendingId) {
    const existing = await findTsOrder(
      { id: pendingId, userId: user.id },
      { id: true }
    );
    if (!existing) return false;
  } else {
    const pending = await findTsOrder(
      { userId: user.id, status: "WAITING_PAYMENT" },
      { id: true }
    );
    if (!pending) return false;
    pendingId = pending.id;
  }

  let order;
  try {
    const existing = await findTsOrder(
      { id: pendingId, userId: user.id },
      { id: true }
    );
    if (!existing) return false;
    order = await prisma.order.update({
      where: { id: existing.id },
      data: { receiptImage: fileId, status: "WAITING_APPROVAL" },
      select: ORDER_WITH_ITEMS_SELECT,
    });
  } catch (err) {
    console.error("TENANT RECEIPT:", err);
    return false;
  }

  await require("../services/goldenCampaign")
    .recordReceiptUpload(order.id)
    .catch((err) => {
      console.error("TENANT RECEIPT TIME SKIP:", err.message);
    });

  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: null, pendingOrderId: null },
  });

  await reply(
    user,
    chatId,
    `✅ رسید دریافت شد.

🔖 کد پیگیری: ${order.trackingCode}
📊 وضعیت: ${statusLabel("WAITING_APPROVAL")}

پس از بررسی فروشگاه، نتیجه اعلام می‌شود.`,
    await shopMenu(user)
  );

  const { shop } = await paymentBank(ctx.tenantId);
  const summary = buildInvoiceText(order, order.items, shop.name);
  await notifyShopOwner(
    ctx.tenantId,
    `🆕 سفارش جدید در انتظار تایید\n\n${summary}\n\n👤 ${order.fullName} | 📱 ${order.phone}\n🔖 ${order.trackingCode}`
  );
  return true;
};

module.exports.showMyOrders = async function showMyOrders(user, chatId) {
  let orders;
  try {
    orders = await findTsOrders(
      { userId: user.id },
      ORDER_WITH_ITEMS_SELECT,
      10
    );
  } catch (err) {
    console.error("TENANT MY ORDERS:", err);
    await reply(user, chatId, "خواندن سفارش‌ها ممکن نشد.", await shopMenu(user));
    return;
  }

  if (!orders.length) {
    await reply(user, chatId, "📦 هنوز سفارشی در این فروشگاه ثبت نکرده‌اید.", await shopMenu(user));
    return;
  }

  const rows = orders.map((order) => {
    const label = `🔖 ${order.trackingCode} | ${statusLabel(order.status)} | ${order.totalAmount.toLocaleString("fa-IR")} تومان`;
    return [{ text: label, callback_data: order.trackingCode }];
  });

  await reply(user, chatId, "📦 سفارشات من", await shopMenu(user));
  const inlineResult = await bale.sendKeyboard(
    chatId,
    "برای دیدن جزئیات هر سفارش روی آن کلیک کنید:",
    inlineKb(rows)
  );
  const inlineMsgId = inlineResult?.result?.message_id;
  if (inlineMsgId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastMessageId: inlineMsgId },
    });
  }
};

module.exports.showOrderByTracking = async function showOrderByTracking(
  user,
  chatId,
  code
) {
  const ctx = getBotContext();
  if (!ctx.tenantId) return false;
  const order = await findTsOrder(
    {
      trackingCode: String(code || "").trim(),
      userId: user.id,
    },
    ORDER_WITH_ITEMS_SELECT
  );
  if (!order || !String(order.trackingCode).startsWith("TS-")) return false;

  const { shop, bank } = await paymentBank(ctx.tenantId);

  if (order.status === "WAITING_PAYMENT") {
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: RECEIPT_STEP, pendingOrderId: order.id },
    });
    const invoice = buildInvoiceText(order, order.items, shop.name);
    await reply(
      user,
      chatId,
      `${invoice}\n\n${buildTenantShippingInfo(shop)}\n\n${buildPaymentInfo(bank)}`,
      paymentMenu()
    );
    return true;
  }

  let detail = `🔖 کد پیگیری: ${order.trackingCode}\n`;
  detail += `📊 وضعیت: ${statusLabel(order.status)}\n`;
  if (order.status === "REJECTED" && order.rejectReason) {
    detail += `❌ دلیل رد: ${order.rejectReason}\n`;
  }
  detail += `\n📦 اقلام سفارش:\n\n`;
  for (const item of order.items) {
    detail += `• ${item.product.title}\n`;
    detail += `  تعداد: ${item.quantity} | قیمت واحد: ${item.unitPrice.toLocaleString("fa-IR")} تومان\n`;
    detail += `  جمع: ${(item.unitPrice * item.quantity).toLocaleString("fa-IR")} تومان\n\n`;
  }
  detail += `━━━━━━━━━━━━━━━━━━\n`;
  detail += `💰 جمع کل: ${order.totalAmount.toLocaleString("fa-IR")} تومان`;
  if (order.shipmentInfo) {
    detail += `\n\n🚚 اطلاعات ارسال: ${order.shipmentInfo}`;
  }
  await reply(user, chatId, detail, await shopMenu(user));
  return true;
};

function orderBelongsToShop(order, tenantId) {
  if (!order || !tenantId) return false;
  if (order.tenantId) return order.tenantId === tenantId;
  return (order.items || []).some((item) => item.product?.tenantId === tenantId);
}

async function loadShopOrder(orderId, tenantId) {
  if (!orderId || !tenantId) return null;
  try {
    const order = await findTsOrder(
      { id: orderId },
      {
        ...ORDER_WITH_ITEMS_SELECT,
        user: { select: { fullName: true, baleId: true } },
      }
    );
    if (!orderBelongsToShop(order, tenantId)) return null;
    return order;
  } catch (err) {
    console.error("LOAD SHOP ORDER:", err.message);
    return null;
  }
}

async function mutateOwnedPendingOrder(user, tenantId, data) {
  const owned = await loadShopOrder(user.pendingOrderId, tenantId);
  if (!owned) return null;
  return prisma.order.update({
    where: { id: owned.id },
    data,
    select: ORDER_WITH_ITEMS_SELECT,
  });
}

const CLOSED_SHOP_STATUSES = ["REJECTED", "SHIPPED"];
const OPEN_LIST_STEP = "TS:ORDERS_OPEN";
const CLOSED_LIST_STEP = "TS:ORDERS_CLOSED";

function ownerActions(order) {
  if (order.status === "WAITING_APPROVAL") return adminOrderActions();
  if (order.status === "APPROVED" || order.status === "PACKAGING") {
    return adminApprovedActions();
  }
  return kb([[{ text: BTN.SHOP_ORDERS }], [{ text: BTN.BACK_PRODUCT_LIST }]]);
}

function isClosedShopOrder(order) {
  return CLOSED_SHOP_STATUSES.includes(order.status);
}

async function requireShopOwner(user, chatId) {
  const ctx = getBotContext();
  if (await tenantAdmin.isShopOwner(user, ctx.tenantId)) return true;
  await reply(
    user,
    chatId,
    "این بخش فقط برای صاحب فروشگاه است.",
    await shopMenu(user)
  );
  return false;
}

module.exports.showShopOrders = async function showShopOrders(user, chatId) {
  if (!(await requireShopOwner(user, chatId))) return;
  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: "TS:ORDERS", pendingOrderId: null },
  });
  user.adminStep = "TS:ORDERS";
  user.pendingOrderId = null;
  await reply(
    user,
    chatId,
    "🧾 سفارش‌های مشتریان\n\nسفارشات باز یا بسته را انتخاب کنید.",
    shopOrdersMenu()
  );
};

module.exports.showShopOrderList = async function showShopOrderList(
  user,
  chatId,
  kind,
  offset = 0
) {
  if (!(await requireShopOwner(user, chatId))) return;
  const closed = kind === "closed";
  const adminStep = closed ? CLOSED_LIST_STEP : OPEN_LIST_STEP;
  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep, pendingOrderId: null },
  });
  user.adminStep = adminStep;
  user.pendingOrderId = null;

  const statusFilter = closed
    ? { status: { in: CLOSED_SHOP_STATUSES } }
    : { status: { notIn: CLOSED_SHOP_STATUSES } };
  const title = closed ? "📭 سفارشات بسته" : "📬 سفارشات باز";
  const pageSize = closed ? 10 : 20;
  const skip = closed ? Math.max(0, Number(offset) || 0) : 0;

  let orders = [];
  try {
    orders = await findTsOrders(
      statusFilter,
      {
        id: true,
        trackingCode: true,
        status: true,
        totalAmount: true,
        fullName: true,
      },
      closed ? pageSize + 1 : pageSize,
      skip
    );
    orders = orders.filter((order) =>
      closed ? isClosedShopOrder(order) : !isClosedShopOrder(order)
    );
  } catch (err) {
    console.error("SHOP ORDERS LIST:", err);
    await reply(user, chatId, "خواندن سفارش‌ها ممکن نشد.", shopOrdersMenu());
    return;
  }

  if (!orders.length) {
    await reply(
      user,
      chatId,
      closed
        ? skip
          ? "📭 سفارش بسته‌ی قدیمی‌تری نیست."
          : "📭 سفارش رد شده یا ارسال‌شده‌ای نیست."
        : "📬 سفارش بازی برای این فروشگاه نیست.",
      shopOrdersMenu()
    );
    return;
  }

  const hasMore = closed && orders.length > pageSize;
  if (hasMore) orders = orders.slice(0, pageSize);

  const rows = orders.map((order) => [
    {
      text: `🔖 ${order.trackingCode} | ${statusLabel(order.status)} | ${order.totalAmount.toLocaleString("fa-IR")}`,
      callback_data: `tord:${order.id}`.slice(0, 64),
    },
  ]);
  if (hasMore) {
    rows.push([
      {
        text: "ده سفارش قبلی",
        callback_data: `tcld:${skip + pageSize}`.slice(0, 64),
      },
    ]);
  }
  await reply(
    user,
    chatId,
    `${title}\nروی هر مورد برای جزئیات و تایید کلیک کنید.`,
    shopOrdersMenu()
  );
  const result = await bale.sendKeyboard(chatId, "سفارش‌ها:", inlineKb(rows));
  const msgId = result?.result?.message_id;
  if (msgId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastMessageId: msgId },
    });
  }
};

module.exports.showShopOrderDetail = async function showShopOrderDetail(
  user,
  chatId,
  orderId
) {
  if (!(await requireShopOwner(user, chatId))) return;
  const ctx = getBotContext();
  const order = await loadShopOrder(orderId, ctx.tenantId);
  if (!order) {
    await reply(user, chatId, "این سفارش در این فروشگاه پیدا نشد.", tenantAdminMenu());
    return;
  }
  const listStep =
    user.adminStep === CLOSED_LIST_STEP ? CLOSED_LIST_STEP : OPEN_LIST_STEP;
  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: listStep, pendingOrderId: order.id },
  });
  user.adminStep = listStep;
  user.pendingOrderId = order.id;

  const { shop } = await paymentBank(ctx.tenantId);
  const invoice = buildInvoiceText(order, order.items, shop.name);
  let extra = "";
  if (order.receiptImage) extra += "\n\n📸 رسید پرداخت ارسال شده است.";
  if (order.rejectReason) extra += `\n❌ دلیل رد: ${order.rejectReason}`;
  if (order.shipmentInfo) extra += `\n🚚 ارسال: ${order.shipmentInfo}`;
  await reply(user, chatId, `${invoice}${extra}`, ownerActions(order));
};

module.exports.handleOwnerText = async function handleOwnerText(user, chatId, text) {
  const ctx = getBotContext();
  if (!(await tenantAdmin.isShopOwner(user, ctx.tenantId))) return false;

  if (text === BTN.SHOP_ORDERS) {
    await module.exports.showShopOrders(user, chatId);
    return true;
  }
  if (text === BTN.SHOP_ORDERS_OPEN) {
    await module.exports.showShopOrderList(user, chatId, "open");
    return true;
  }
  if (text === BTN.SHOP_ORDERS_CLOSED) {
    await module.exports.showShopOrderList(user, chatId, "closed");
    return true;
  }

  if (user.adminStep === "TS:O_REJECT" && user.pendingOrderId) {
    if (text === BTN.BACK_PRODUCT_LIST || text === BTN.BACK_MAIN) return false;
    try {
      const order = await mutateOwnedPendingOrder(user, ctx.tenantId, {
        status: "REJECTED",
        rejectReason: text,
      });
      if (!order) {
        await reply(user, chatId, "این سفارش در این فروشگاه پیدا نشد.", shopOrdersMenu());
        return true;
      }
      await notifyCustomer(order, `❌ فاکتور شما رد شد.\n\nدلیل: ${text}`);
      await reply(user, chatId, "فاکتور رد شد.", shopOrdersMenu());
      await module.exports.showShopOrderList(user, chatId, "closed");
    } catch (err) {
      console.error("SHOP REJECT:", err);
      await reply(user, chatId, "رد فاکتور ممکن نشد.", shopOrdersMenu());
    }
    return true;
  }

  if (user.adminStep === "TS:O_SHIP" && user.pendingOrderId) {
    if (text === BTN.BACK_PRODUCT_LIST || text === BTN.BACK_MAIN) return false;
    try {
      const order = await mutateOwnedPendingOrder(user, ctx.tenantId, {
        status: "SHIPPED",
        shipmentInfo: text,
      });
      if (!order) {
        await reply(user, chatId, "این سفارش در این فروشگاه پیدا نشد.", shopOrdersMenu());
        return true;
      }
      await notifyCustomer(order, `🚚 سفارش ارسال شد.\n${text}`);
      await reply(user, chatId, "✅ ارسال ثبت شد.", shopOrdersMenu());
      await module.exports.showShopOrderList(user, chatId, "closed");
    } catch (err) {
      console.error("SHOP SHIP:", err);
      await reply(user, chatId, "ثبت ارسال ممکن نشد.", shopOrdersMenu());
    }
    return true;
  }

  if (
    !user.pendingOrderId ||
    (user.adminStep !== OPEN_LIST_STEP && user.adminStep !== CLOSED_LIST_STEP)
  ) {
    return false;
  }

  if (text === BTN.APPROVE) {
    try {
      const order = await mutateOwnedPendingOrder(user, ctx.tenantId, {
        status: "APPROVED",
      });
      if (!order) {
        await reply(user, chatId, "این سفارش در این فروشگاه پیدا نشد.", tenantAdminMenu());
        return true;
      }
      await notifyCustomer(order, "✅ فاکتور شما تایید شد.");
      await reply(user, chatId, "فاکتور تایید شد.", adminApprovedActions());
    } catch (err) {
      console.error("SHOP APPROVE:", err);
      await reply(user, chatId, "تایید فاکتور ممکن نشد.", tenantAdminMenu());
    }
    return true;
  }

  if (text === BTN.REJECT) {
    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: "TS:O_REJECT" },
    });
    user.adminStep = "TS:O_REJECT";
    await reply(
      user,
      chatId,
      "دلیل رد فاکتور را بنویسید:",
      kb([[{ text: BTN.BACK_PRODUCT_LIST }]])
    );
    return true;
  }

  if (text === BTN.PACK) {
    try {
      const order = await mutateOwnedPendingOrder(user, ctx.tenantId, {
        status: "PACKAGING",
      });
      if (!order) {
        await reply(user, chatId, "این سفارش در این فروشگاه پیدا نشد.", adminApprovedActions());
        return true;
      }
      await notifyCustomer(order, "📦 سفارش در حال بسته‌بندی است.");
      await reply(user, chatId, "وضعیت: بسته‌بندی", adminApprovedActions());
    } catch (err) {
      console.error("SHOP PACK:", err);
      await reply(user, chatId, "ثبت بسته‌بندی ممکن نشد.", adminApprovedActions());
    }
    return true;
  }

  if (text === BTN.SHIP) {
    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: "TS:O_SHIP" },
    });
    user.adminStep = "TS:O_SHIP";
    await reply(
      user,
      chatId,
      "اطلاعات ارسال را بنویسید (پست، اسنپ، کد رهگیری و …):",
      kb([[{ text: BTN.BACK_PRODUCT_LIST }]])
    );
    return true;
  }

  return false;
};

module.exports.QTY_STEP = QTY_STEP;
module.exports.RECEIPT_STEP = RECEIPT_STEP;
