const prisma = require("../database/prisma");
const { ORDER_WITH_ITEMS_SELECT, CART_ITEMS_SELECT } = require("../database/selects");
const { ADMIN_BALE_IDS } = require("../config");
const { reply, notify, notifyMother } = require("../bot/messenger");
const partnerNotify = require("../services/partnerNotify");
const { BTN, checkoutSkipMenu, paymentMenu, mainMenu, backMain, inlineKb, confirmAddressMenu, adminBackMenu } = require("../keyboards/menus");
const bale = require("../bot/bale");
const { validateCheckout } = require("./cart");
const { getUnitPrice } = require("../utils/price");
const {
  generateTrackingCode,
  statusLabel,
  orderStatusLabel,
  hasProformaCard,
  readProformaCard,
  encodeProformaCard,
  isWholesaleProformaHold,
} = require("../utils/order");
const {
  buildInvoiceText,
  buildPaymentInfo,
  buildShippingInfo,
} = require("../utils/invoice");

async function notifyAdmins(text) {
  for (const adminId of ADMIN_BALE_IDS) {
    try {
      await notify(adminId, text);
    } catch (err) {
      console.log("ADMIN NOTIFY FAIL:", adminId, err.message);
    }
  }
}

module.exports.startCheckout = async function startCheckout(user, chatId) {
  const check = await validateCheckout(user);

  if (!check.ok) {
    await reply(user, chatId, check.message);
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
        callback_data: `addr:view:${addr.id}`,
      },
    ]);
    rows.push([{ text: "➕ آدرس جدید", callback_data: "addr:new" }]);

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
    data: { orderStep: "CHECKOUT_NAME" },
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

  if (step === "CHECKOUT_NAME") {
    await prisma.user.update({
      where: { id: user.id },
      data: { fullName: text, orderStep: "CHECKOUT_PHONE" },
    });
    await reply(user, chatId, "📱 شماره موبایل را وارد کنید:", backMain());
    return true;
  }

  if (step === "CHECKOUT_PHONE") {
    await prisma.user.update({
      where: { id: user.id },
      data: { phone: text, orderStep: "CHECKOUT_PROVINCE" },
    });
    await reply(user, chatId, "🏙 نام استان را وارد کنید:", backMain());
    return true;
  }

  if (step === "CHECKOUT_PROVINCE") {
    await prisma.user.update({
      where: { id: user.id },
      data: { tempProvince: text, orderStep: "CHECKOUT_CITY" },
    });
    await reply(user, chatId, "🏘 نام شهر را وارد کنید:", backMain());
    return true;
  }

  if (step === "CHECKOUT_CITY") {
    await prisma.user.update({
      where: { id: user.id },
      data: { tempCity: text, orderStep: "CHECKOUT_ADDRESS" },
    });
    await reply(user, chatId, "📍 آدرس کامل را وارد کنید:", backMain());
    return true;
  }

  if (step === "CHECKOUT_ADDRESS") {
    await prisma.user.update({
      where: { id: user.id },
      data: { tempAddress: text, orderStep: "CHECKOUT_POSTAL" },
    });
    await reply(user, chatId, "📮 کد پستی را وارد کنید:", backMain());
    return true;
  }

  if (step === "CHECKOUT_POSTAL") {
    await prisma.user.update({
      where: { id: user.id },
      data: { tempPostalCode: text, orderStep: "CHECKOUT_DESC" },
    });
    await reply(
      user,
      chatId,
      "📝 توضیحات تکمیلی (اختیاری):\nیا «⏭ رد کردن» را بزنید.",
      checkoutSkipMenu()
    );
    return true;
  }

  if (step === "CHECKOUT_DESC") {
    const desc = text === BTN.SKIP ? null : text;
    await finalizeOrder(user, chatId, desc);
    return true;
  }

  return false;
};

async function finalizeOrder(user, chatId, description) {
  const fresh = await prisma.user.findUnique({
    where: { id: user.id },
    include: {
      cart: {
        include: {
          items: { select: CART_ITEMS_SELECT },
        },
      },
    },
  });

  const check = await validateCheckout(fresh);

  if (!check.ok) {
    await reply(user, chatId, check.message);
    return;
  }

  const trackingCode = generateTrackingCode();
  const wholesale = check.wholesale;

  const order = await prisma.order.create({
    data: {
      trackingCode,
      status: "WAITING_PAYMENT",
      fullName: fresh.fullName,
      phone: fresh.phone,
      province: fresh.tempProvince,
      city: fresh.tempCity,
      address: fresh.tempAddress,
      postalCode: fresh.tempPostalCode,
      description,
      totalAmount: check.total,
      isWholesale: wholesale,
      userId: fresh.id,
      items: {
        create: check.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: getUnitPrice(item.product, wholesale),
        })),
      },
    },
    select: ORDER_WITH_ITEMS_SELECT,
  });

  await prisma.cartItem.deleteMany({
    where: { cartId: fresh.cart.id },
  });

  // Save address for reuse (max 3 per user)
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

  const withBuyer = { ...order, user: { role: fresh.role } };

  if (wholesale) {
    await prisma.user.update({
      where: { id: fresh.id },
      data: {
        orderStep: null,
        pendingOrderId: order.id,
        tempProvince: null,
        tempCity: null,
        tempAddress: null,
        tempPostalCode: null,
        tempDescription: null,
      },
    });

    const invoice = buildInvoiceText(withBuyer, order.items);
    await reply(
      fresh,
      chatId,
      `${invoice}\n\n${buildShippingInfo()}\n\nپیش‌فاکتور برای بررسی موجودی به ادمین ارسال شد.\nپس از تایید، شماره کارت واریز برایتان ارسال می‌شود.\nتا آن زمان رسید پرداخت نفرستید.`,
      mainMenu(fresh)
    );
    await notifyAdminsProforma(withBuyer);
    return;
  }

  await prisma.user.update({
    where: { id: fresh.id },
    data: {
      orderStep: "UPLOAD_RECEIPT",
      pendingOrderId: order.id,
      tempProvince: null,
      tempCity: null,
      tempAddress: null,
      tempPostalCode: null,
      tempDescription: null,
    },
  });

  const invoice = buildInvoiceText(withBuyer, order.items);

  await reply(
    fresh,
    chatId,
    `${invoice}\n\n${buildShippingInfo()}\n\n${buildPaymentInfo()}`,
    paymentMenu()
  );
}

async function notifyAdminsProforma(order) {
  const invoice = buildInvoiceText(order, order.items);
  const kind =
    order.user?.role === "MANELI" ? "بازاریابان مانلی" : "خرید همکار";
  const text = `🆕 پیش‌فاکتور ${kind} — بررسی موجودی\n\n${invoice}\n\nپس از تطبیق با انبار، تایید یا رد کنید.`;
  const keyboard = inlineKb([
    [{ text: "✅ تایید پیش‌فاکتور", callback_data: `pf:ok:${order.id}` }],
    [{ text: "❌ رد پیش‌فاکتور", callback_data: `pf:no:${order.id}` }],
  ]);
  for (const adminId of ADMIN_BALE_IDS) {
    try {
      await bale.sendKeyboard(adminId, text, keyboard);
    } catch (err) {
      console.log("ADMIN PROFORMA NOTIFY FAIL:", adminId, err.message);
    }
  }
}

async function restoreOrderItemsToCart(order) {
  let cart = await prisma.cart.findUnique({
    where: { userId: order.userId },
  });
  if (!cart) {
    cart = await prisma.cart.create({ data: { userId: order.userId } });
  }
  for (const item of order.items || []) {
    if (!item.productId) continue;
    try {
      await prisma.cartItem.upsert({
        where: {
          cartId_productId: { cartId: cart.id, productId: item.productId },
        },
        create: {
          cartId: cart.id,
          productId: item.productId,
          quantity: item.quantity,
        },
        update: { quantity: { increment: item.quantity } },
      });
    } catch (err) {
      console.error("RESTORE CART ITEM SKIP:", err.message);
    }
  }
}

function wholesalePayText(order) {
  return [
    "💳 اطلاعات واریز",
    "━━━━━━━━━━━━━━━━━━",
    readProformaCard(order),
    "",
    "پس از واریز، از دکمه «📸 ارسال رسید پرداخت» استفاده کنید",
    "و اسکرین‌شات رسید را ارسال نمایید.",
  ].join("\n");
}

async function notifyWholesaleBuyer(order, text) {
  const buyer = await prisma.user.findUnique({
    where: { id: order.userId },
    select: { baleId: true },
  });
  if (!buyer?.baleId || !text) return;
  await notifyMother(buyer.baleId, text);
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
    data: { orderStep: "ADDR_CONFIRM", tempAddressId: addr.id },
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
  if (user.orderStep !== "ADDR_CONFIRM" || !user.tempAddressId) {
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

module.exports.handleReceiptPhoto = async function handleReceiptPhoto(
  user,
  chatId,
  photo
) {
  if (user.orderStep !== "UPLOAD_RECEIPT" || !user.pendingOrderId) {
    return false;
  }

  const fileId = photo[photo.length - 1].file_id;

  const pending = await prisma.order.findFirst({
    where: {
      id: user.pendingOrderId,
      userId: user.id,
      trackingCode: { startsWith: "PL-" },
    },
    select: {
      id: true,
      status: true,
      isWholesale: true,
      receiptImage: true,
      shipmentInfo: true,
    },
  });
  if (!pending) return false;
  if (isWholesaleProformaHold(pending)) {
    await reply(
      user,
      chatId,
      "پیش‌فاکتور هنوز تایید نشده. بعد از تایید ادمین، اطلاعات واریز برایتان ارسال می‌شود."
    );
    return true;
  }

  const order = await prisma.order.update({
    where: { id: pending.id },
    data: {
      receiptImage: fileId,
      status: "WAITING_APPROVAL",
    },
    select: ORDER_WITH_ITEMS_SELECT,
  });

  await require("../services/goldenCampaign")
    .recordReceiptUpload(order.id)
    .catch((err) => {
      console.error("ORDER RECEIPT TIME SKIP:", err.message);
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

پس از بررسی ادمین، نتیجه اعلام می‌شود.`,
    mainMenu(user)
  );

  const summary = buildInvoiceText(order, order.items);

  await notifyAdmins(
    `🆕 فاکتور جدید در انتظار تایید

${summary}

👤 ${order.fullName} | 📱 ${order.phone}
🔖 ${order.trackingCode}`
  );

  if (user.role !== "MANELI" && (partnerNotify.isColleagueBuyer(user) || order.isWholesale)) {
    await partnerNotify
      .notifyColleague(
        user.id,
        `📦 سفارش جدید شما ثبت شد.\n\n🔖 ${order.trackingCode}\nپس از تایید ادمین، نتیجه و اعتبار خرید (در صورت شمول) از همین ربات فروشگاه اعلام می‌شود.`
      )
      .catch((err) => {
        console.error("PARTNER ORDER REGISTER SKIP:", err.message);
      });
  }

  return true;
};

module.exports.showMyOrders = async function showMyOrders(user, chatId) {
  let orders;
  try {
    orders = await prisma.order.findMany({
      where: { userId: user.id, trackingCode: { startsWith: "PL-" } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        trackingCode: true,
        status: true,
        totalAmount: true,
        isWholesale: true,
        receiptImage: true,
        shipmentInfo: true,
      },
    });
  } catch (err) {
    console.error("SHOW MY ORDERS:", err);
    await reply(user, chatId, "خواندن سفارش‌ها ممکن نشد. لطفاً دوباره تلاش کنید.", backMain());
    return;
  }

  if (!orders.length) {
    await reply(user, chatId, "📦 هنوز سفارشی ثبت نکرده‌اید.", backMain());
    return;
  }

  const rows = orders.map((order) => {
    const label = `🔖 ${order.trackingCode} | ${orderStatusLabel(order)} | ${order.totalAmount.toLocaleString("fa-IR")} تومان`;
    return [{ text: label, callback_data: order.trackingCode }];
  });

  // Regular keyboard with back button (tracked — deleted on next navigation)
  await reply(user, chatId, "📦 سفارشات من", backMain());

  // Inline order list + track message_id for automatic deletion
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
  const order = await prisma.order.findFirst({
    where: {
      trackingCode: code.trim(),
      userId: user.id,
    },
    select: ORDER_WITH_ITEMS_SELECT,
  });

  if (!order || !String(order.trackingCode).startsWith("PL-")) return false;

  if (order.status === "WAITING_PAYMENT") {
    const invoice = buildInvoiceText(order, order.items);

    if (isWholesaleProformaHold(order)) {
      await prisma.user.update({
        where: { id: user.id },
        data: { adminStep: null, orderStep: null, pendingOrderId: order.id },
      });
      await reply(
        user,
        chatId,
        `${invoice}\n\n${buildShippingInfo()}\n\nپیش‌فاکتور در انتظار بررسی موجودی ادمین است.\nپس از تایید، شماره کارت واریز برایتان ارسال می‌شود.`,
        mainMenu(user)
      );
      return true;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: null, orderStep: "UPLOAD_RECEIPT", pendingOrderId: order.id },
    });

    const pay =
      order.isWholesale && hasProformaCard(order)
        ? wholesalePayText(order)
        : buildPaymentInfo();
    await reply(
      user,
      chatId,
      `${invoice}\n\n${buildShippingInfo()}\n\n${pay}`,
      paymentMenu()
    );
    return true;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: null },
  });

  let detail = `🔖 کد پیگیری: ${order.trackingCode}\n`;
  detail += `📊 وضعیت: ${orderStatusLabel(order)}\n`;

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

  await reply(user, chatId, detail, backMain());
  return true;
};

module.exports.handleProformaCallback = async function handleProformaCallback(
  user,
  chatId,
  data
) {
  const approve = data.startsWith("pf:ok:");
  const orderId = data.replace(/^pf:(ok|no):/, "");
  const order = await prisma.order.findFirst({
    where: { id: orderId, trackingCode: { startsWith: "PL-" } },
    select: ORDER_WITH_ITEMS_SELECT,
  });
  if (!order || !isWholesaleProformaHold(order)) {
    await reply(
      user,
      chatId,
      "این پیش‌فاکتور قابل بررسی نیست یا قبلاً پردازش شده.",
      adminBackMenu()
    );
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      adminStep: approve ? "PROFORMA_CARD" : "PROFORMA_REJECT",
      pendingOrderId: order.id,
    },
  });

  if (approve) {
    await reply(
      user,
      chatId,
      `✅ تایید پیش‌فاکتور ${order.trackingCode}\n\nشماره کارت و مشخصات حساب را برای ارسال به کاربر بنویسید:`,
      adminBackMenu()
    );
    return;
  }

  await reply(
    user,
    chatId,
    `❌ رد پیش‌فاکتور ${order.trackingCode}\n\nعلت را بنویسید (برای کاربر ارسال می‌شود):`,
    adminBackMenu()
  );
};

module.exports.handleProformaCardText = async function handleProformaCardText(
  user,
  chatId,
  text
) {
  const card = String(text || "").trim();
  if (!card || card === BTN.BACK_PRODUCT_LIST) return false;

  const orderId = user.pendingOrderId;
  const current = await prisma.order.findFirst({
    where: { id: orderId, trackingCode: { startsWith: "PL-" } },
    select: ORDER_WITH_ITEMS_SELECT,
  });
  if (!current || !isWholesaleProformaHold(current)) {
    await reply(
      user,
      chatId,
      "این پیش‌فاکتور قابل تایید نیست یا قبلاً پردازش شده.",
      adminBackMenu()
    );
    return true;
  }

  const moved = await prisma.order.updateMany({
    where: {
      id: orderId,
      status: "WAITING_PAYMENT",
      isWholesale: true,
      receiptImage: null,
      shipmentInfo: null,
    },
    data: { shipmentInfo: encodeProformaCard(card) },
  });
  if (moved.count !== 1) {
    await reply(
      user,
      chatId,
      "ثبت کارت انجام نشد؛ پیش‌فاکتور قبلاً پردازش شده.",
      adminBackMenu()
    );
    return true;
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: ORDER_WITH_ITEMS_SELECT,
  });

  await prisma.user.update({
    where: { id: order.userId },
    data: { orderStep: "UPLOAD_RECEIPT", pendingOrderId: order.id },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: null, pendingOrderId: null },
  });

  const invoice = buildInvoiceText(order, order.items);
  const buyer = await prisma.user.findUnique({
    where: { id: order.userId },
    select: { baleId: true },
  });
  if (buyer?.baleId) {
    await bale.sendKeyboard(
      buyer.baleId,
      `✅ پیش‌فاکتور تایید شد.\n\n${invoice}\n\n${wholesalePayText(order)}`,
      paymentMenu()
    );
  }

  await reply(
    user,
    chatId,
    `✅ اطلاعات واریز برای ${order.trackingCode} ارسال شد.`,
    adminBackMenu()
  );
  return true;
};

module.exports.handleProformaRejectText = async function handleProformaRejectText(
  user,
  chatId,
  text
) {
  const reason = String(text || "").trim();
  if (!reason || reason === BTN.BACK_PRODUCT_LIST) return false;

  const orderId = user.pendingOrderId;
  const moved = await prisma.order.updateMany({
    where: {
      id: orderId,
      status: "WAITING_PAYMENT",
      isWholesale: true,
      receiptImage: null,
      shipmentInfo: null,
    },
    data: { status: "REJECTED", rejectReason: reason },
  });
  if (moved.count !== 1) {
    await reply(
      user,
      chatId,
      "این پیش‌فاکتور قابل رد نیست یا قبلاً پردازش شده.",
      adminBackMenu()
    );
    return true;
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: ORDER_WITH_ITEMS_SELECT,
  });

  await restoreOrderItemsToCart(order);

  await prisma.user.update({
    where: { id: order.userId },
    data: { orderStep: null, pendingOrderId: null },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: null, pendingOrderId: null },
  });

  await notifyWholesaleBuyer(
    order,
    `❌ پیش‌فاکتور رد شد.\n\n🔖 ${order.trackingCode}\nدلیل: ${reason}\n\nاقلام دوباره به سبد خرید برگشت. سبد را اصلاح کنید و دوباره ثبت سفارش بزنید.`
  );

  await reply(user, chatId, "پیش‌فاکتور رد شد و سبد خرید کاربر بازیابی شد.", adminBackMenu());
  return true;
};

module.exports.notifyOrderStatus = notifyOrderStatus;

async function notifyOrderStatus(order, message) {
  const text = `📢 ${message}

🔖 ${order.trackingCode}
📊 ${statusLabel(order.status)}`;
  await partnerNotify.notifyOrderBuyer(order, text);
}
