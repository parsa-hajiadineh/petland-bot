const prisma = require("../database/prisma");
const { ORDER_WITH_ITEMS_SELECT, CART_ITEMS_SELECT } = require("../database/selects");
const { ADMIN_BALE_IDS } = require("../config");
const { reply, notify } = require("../bot/messenger");
const { BTN, checkoutSkipMenu, paymentMenu, mainMenu, backMain, inlineKb, confirmAddressMenu } = require("../keyboards/menus");
const bale = require("../bot/bale");
const { validateCheckout } = require("./cart");
const { getUnitPrice } = require("../utils/price");
const {
  generateTrackingCode,
  statusLabel,
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

  const invoice = buildInvoiceText(order, order.items);

  await reply(
    fresh,
    chatId,
    `${invoice}\n\n${buildShippingInfo()}\n\n${buildPaymentInfo()}`,
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
    select: { id: true },
  });
  if (!pending) return false;

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

  return true;
};

module.exports.showMyOrders = async function showMyOrders(user, chatId) {
  let orders;
  try {
    orders = await prisma.order.findMany({
      where: { userId: user.id, trackingCode: { startsWith: "PL-" } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: ORDER_WITH_ITEMS_SELECT,
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
    const label = `🔖 ${order.trackingCode} | ${statusLabel(order.status)} | ${order.totalAmount.toLocaleString("fa-IR")} تومان`;
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
    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: null, orderStep: "UPLOAD_RECEIPT", pendingOrderId: order.id },
    });

    const invoice = buildInvoiceText(order, order.items);
    await reply(
      user,
      chatId,
      `${invoice}\n\n${buildShippingInfo()}\n\n${buildPaymentInfo()}`,
      paymentMenu()
    );
    return true;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: null },
  });

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

  await reply(user, chatId, detail, backMain());
  return true;
};

module.exports.notifyOrderStatus = notifyOrderStatus;

async function notifyOrderStatus(order, message) {
  const owner = await prisma.user.findUnique({
    where: { id: order.userId },
  });

  if (!owner) return;

  await notify(
    owner.baleId,
    `📢 ${message}

🔖 ${order.trackingCode}
📊 ${statusLabel(order.status)}`
  );
}
