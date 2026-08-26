const fs = require("fs");
const prisma = require("../database/prisma");
const bale = require("../bot/bale");
const { reply, notify, replyPhoto } = require("../bot/messenger");
const {
  BTN,
  adminMenu,
  adminOrderActions,
  adminApprovedActions,
  adminTicketsMenu,
  inlineKb,
  kb,
  backMain,
} = require("../keyboards/menus");const { buildInvoiceText, generateInvoicePdf } = require("../utils/invoice");
const { statusLabel } = require("../utils/order");
const { notifyOrderStatus } = require("./order");
const { getOrCreateWallet } = require("./wallet");

// ─── Sales Stats Helpers ─────────────────────────────────────────────────────

function toYearMonth(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(yearMonth) {
  const [year, month] = yearMonth.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString("fa-IR", { year: "numeric", month: "long" });
}

async function calcMonthStats(yearMonth) {
  const [year, month] = yearMonth.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: start, lt: end },
      status: { in: ["APPROVED", "PACKAGING", "SHIPPED", "DELIVERED"] },
    },
    include: {
      items: { include: { product: { select: { costPrice: true } } } },
      user: { select: { referrerId: true } },
    },
  });

  let totalRevenue = 0;
  let totalProfit = 0;
  let totalCommission = 0;

  for (const order of orders) {
    totalRevenue += order.totalAmount;

    for (const item of order.items) {
      totalProfit += (item.unitPrice - item.product.costPrice) * item.quantity;
    }

    if (order.user?.referrerId) {
      const commission = Math.floor(order.totalAmount * 0.05);
      totalCommission += commission;
    }
  }

  return { totalRevenue, totalProfit, totalCommission, orderCount: orders.length };
}

async function archiveOldMonths() {
  const now = new Date();

  // Archive past months (up to 6) that haven't been saved yet
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = toYearMonth(d);

    const existing = await prisma.monthlySalesReport.findUnique({
      where: { yearMonth: ym },
    });

    if (!existing) {
      const stats = await calcMonthStats(ym);
      await prisma.monthlySalesReport.create({
        data: { yearMonth: ym, ...stats },
      });
    }
  }

  // Delete reports older than 6 months
  const cutoffDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const cutoffYM = toYearMonth(cutoffDate);
  await prisma.monthlySalesReport.deleteMany({
    where: { yearMonth: { lt: cutoffYM } },
  });
}

async function showSalesStats(user, chatId) {
  await archiveOldMonths();

  const now = new Date();
  const currentYM = toYearMonth(now);

  const reports = await prisma.monthlySalesReport.findMany({
    orderBy: { yearMonth: "desc" },
    take: 6,
  });

  const rows = [];

  // Current month (live)
  rows.push([{
    text: `📊 ${formatMonthLabel(currentYM)} (جاری)`,
    callback_data: `stats:${currentYM}:live`,
  }]);

  // Archived months
  for (const r of reports) {
    rows.push([{
      text: `📅 ${formatMonthLabel(r.yearMonth)}`,
      callback_data: `stats:${r.yearMonth}:arch`,
    }]);
  }

  await reply(
    user,
    chatId,
    "📊 آمار فروش\n\nماه مورد نظر را انتخاب کنید:",
    inlineKb(rows)
  );
}

module.exports.showMonthStats = async function showMonthStats(
  user,
  chatId,
  yearMonth,
  isLive
) {
  let stats;

  if (isLive) {
    stats = await calcMonthStats(yearMonth);
  } else {
    const report = await prisma.monthlySalesReport.findUnique({
      where: { yearMonth },
    });
    if (!report) {
      await reply(user, chatId, "❌ آمار این ماه موجود نیست.", adminMenu());
      return;
    }
    stats = report;
  }

  const label = formatMonthLabel(yearMonth);
  const currentNote = isLive ? " (در جریان)" : "";

  const netProfit = stats.totalProfit - stats.totalCommission;

  const text = [
    `📊 آمار فروش — ${label}${currentNote}`,
    "━━━━━━━━━━━━━━━━━━",
    `🛒 تعداد سفارشات: ${stats.orderCount}`,
    `💰 حجم فروش: ${stats.totalRevenue.toLocaleString("fa-IR")} تومان`,
    `📈 سود ناخالص: ${stats.totalProfit.toLocaleString("fa-IR")} تومان`,
    `🎁 مجموع پورسانت: ${stats.totalCommission.toLocaleString("fa-IR")} تومان`,
    `✅ سود خالص: ${netProfit.toLocaleString("fa-IR")} تومان`,
  ].join("\n");

  await reply(user, chatId, text, adminMenu());
};

// ─────────────────────────────────────────────────────────────────────────────

module.exports.showAdminPanel = async function showAdminPanel(user, chatId) {
  await reply(user, chatId, "⚙️ پنل ادمین", adminMenu());
};

async function showOrdersInline(user, chatId, where, title, morePrefix = null, offset = 0) {
  const take = 10;
  const paginated = !!morePrefix;

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: offset,
    take: paginated ? take + 1 : 50,
    include: { user: true },
  });

  if (!orders.length) {
    const msg = offset > 0 ? "فاکتور دیگری وجود ندارد." : `${title}\n\nموردی وجود ندارد.`;
    await reply(user, chatId, msg, adminMenu());
    return;
  }

  const shown = paginated ? orders.slice(0, take) : orders;
  const hasMore = paginated && orders.length > take;

  const rows = shown.map((o) => [{
    text: `👤 ${o.user?.fullName || o.user?.baleId} | 💰 ${o.totalAmount.toLocaleString("fa-IR")} تومان`,
    callback_data: `ordr:${o.id}`,
  }]);

  if (hasMore) {
    rows.push([{ text: "⬅️ ۱۰ فاکتور قدیمی‌تر", callback_data: `${morePrefix}:${offset + take}` }]);
  }

  const pageInfo = paginated && offset > 0 ? ` — صفحه ${Math.floor(offset / take) + 1}` : "";
  await reply(user, chatId, `${title}${pageInfo}\n\nروی فاکتور کلیک کنید:`, inlineKb(rows));
}

module.exports.handleAdmin = async function handleAdmin(user, chatId, text) {
  if (text === BTN.ADMIN_PANEL) {
    await module.exports.showAdminPanel(user, chatId);
    return true;
  }

  if (text === BTN.ADMIN_PENDING) {
    await showOrdersInline(user, chatId, { status: "WAITING_APPROVAL" }, "🧾 فاکتورهای در انتظار تایید");
    return true;
  }

  if (text === BTN.ADMIN_APPROVED) {
    await showOrdersInline(user, chatId, { status: { in: ["APPROVED", "PACKAGING"] } }, "✅ فاکتورهای تایید شده");
    return true;
  }

  if (text === BTN.ADMIN_REJECTED) {
    await showOrdersInline(user, chatId, { status: "REJECTED" }, "❌ فاکتورهای رد شده", "rej_more");
    return true;
  }

  if (text === BTN.ADMIN_SHIPPED) {
    await showOrdersInline(user, chatId, { status: "SHIPPED" }, "🚚 فاکتورهای ارسال شده", "shipd_more");
    return true;
  }

  if (text === BTN.ADMIN_WITHDRAWALS) {
    await showPendingWithdrawals(user, chatId);
    return true;
  }

  if (text === BTN.ADMIN_SALES) {
    await showSalesStats(user, chatId);
    return true;
  }

  if (text === BTN.ADMIN_TICKETS) {
    const support = require("./support");
    await support.adminListTickets(user, chatId);
    return true;
  }

  if (text === BTN.TICKET_OPEN) {
    const support = require("./support");
    await support.adminOpenTickets(user, chatId);
    return true;
  }

  if (text === BTN.TICKET_ANSWERED) {
    const support = require("./support");
    await support.adminAnsweredTickets(user, chatId, 0);
    return true;
  }

  if (text === BTN.ADMIN_PRODUCTS) {
    await reply(
      user,
      chatId,
      `📦 مدیریت محصولات

• برای تغییر موجودی: PL-کد محصول AVAILABLE یا UNAVAILABLE
  مثال: JMK-001 AVAILABLE

• برای تنظیم عکس: دکمه «🖼 تنظیم عکس محصول» سپس کد محصول سپس عکس`,
      kb([
        [{ text: BTN.SET_IMAGE }],
        [{ text: BTN.ADMIN_PANEL }],
      ])
    );
    return true;
  }

  if (text === BTN.SET_IMAGE) {
    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: "SET_IMAGE_CODE" },
    });
    await reply(user, chatId, "کد محصول را وارد کنید:");
    return true;
  }

  if (Object.values(BTN).includes(text)) {
    return false;
  }

  if (user.adminStep === "SET_IMAGE_CODE") {
    const product = await prisma.product.findUnique({
      where: { code: text.trim().toUpperCase() },
    });

    if (!product) {
      await reply(user, chatId, "محصول پیدا نشد.");
      return true;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        adminStep: "SET_IMAGE_UPLOAD",
        lastProductCode: product.code,
      },
    });

    await reply(user, chatId, "عکس محصول را ارسال کنید:");
    return true;
  }

  if (text.match(/^[A-Z]{2,3}-\d{3}\s+(AVAILABLE|UNAVAILABLE)$/i)) {
    const [code, status] = text.trim().split(/\s+/);

    const product = await prisma.product
      .update({
        where: { code: code.toUpperCase() },
        data: { status: status.toUpperCase() },
      })
      .catch(() => null);

    if (!product) {
      await reply(user, chatId, "محصول پیدا نشد.");
      return true;
    }

    await reply(
      user,
      chatId,
      `✅ ${product.code} → ${status === "AVAILABLE" ? "موجود" : "ناموجود"}`
    );
    return true;
  }

  if (text.startsWith("#") && user.role === "ADMIN") {
    const parts = text.split("\n");
    const ticketRef = parts[0].replace("#", "").trim();
    const message = parts.slice(1).join("\n").trim();

    if (!message) {
      await reply(user, chatId, "فرمت:\n#کد_تیکت\nمتن پاسخ");
      return true;
    }

    const support = require("./support");
    await support.adminReplyTicket(user, chatId, ticketRef, message);
    return true;
  }

  if (user.adminStep?.startsWith("REPLY_TICKET:")) {
    const ticketId = user.adminStep.split(":").slice(1).join(":");
    const support = require("./support");
    await support.adminReplyTicketDirect(user, chatId, ticketId, text);
    return true;
  }

  let order = null;
  try {
    order = await prisma.order.findUnique({
      where: { trackingCode: text.trim() },
      include: { items: { include: { product: true } } },
    });
  } catch (err) {
    console.error("ADMIN ORDER LOOKUP SKIP:", err.message);
  }

  if (order && user.role === "ADMIN") {
    await showAdminOrderDetail(user, chatId, order);
    return true;
  }

  if (user.adminStep?.startsWith("CONFIRM_WITHDRAWAL:")) {
    const withdrawalId = user.adminStep.split(":").slice(1).join(":");
    await confirmWithdrawal(user, chatId, withdrawalId, text);
    return true;
  }

  if (user.adminStep === "REJECT_REASON" && user.pendingOrderId) {
    const order = await prisma.order.update({
      where: { id: user.pendingOrderId },
      data: {
        status: "REJECTED",
        rejectReason: text,
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: null, pendingOrderId: null },
    });

    await notifyOrderStatus(order, `❌ فاکتور شما رد شد.\n\nدلیل: ${text}`);
    await reply(user, chatId, "فاکتور رد شد.", adminMenu());
    return true;
  }

  if (user.adminStep === "SHIP_INFO" && user.pendingOrderId) {
    const order = await prisma.order.update({
      where: { id: user.pendingOrderId },
      data: { status: "SHIPPED", shipmentInfo: text },
      include: { items: { include: { product: true } } },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: null, pendingOrderId: null },
    });

    await notifyOrderStatus(order, `🚚 سفارش ارسال شد.\n${text}`);
    await reply(user, chatId, "✅ ارسال ثبت شد.", adminMenu());
    return true;
  }

  if (user.adminStep === "SHIP_SNAPP" && user.pendingOrderId) {
    const order = await prisma.order.update({
      where: { id: user.pendingOrderId },
      data: { status: "SHIPPED", shipmentInfo: `اسنپ | ${text}` },
      include: { items: { include: { product: true } } },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: null, pendingOrderId: null },
    });

    await notifyOrderStatus(order, `🚗 سفارش شما با اسنپ ارسال شد.\n${text}`);
    await reply(user, chatId, "✅ ارسال با اسنپ ثبت شد.", adminMenu());
    return true;
  }

  if (user.adminStep === "SHIP_POST" && user.pendingOrderId) {
    const order = await prisma.order.update({
      where: { id: user.pendingOrderId },
      data: { status: "SHIPPED", shipmentInfo: `پست | کد پیگیری: ${text}` },
      include: { items: { include: { product: true } } },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: null, pendingOrderId: null },
    });

    await notifyOrderStatus(order, `📦 سفارش شما با پست ارسال شد.\nکد پیگیری مرسوله: ${text}`);
    await reply(user, chatId, "✅ ارسال با پست ثبت شد.", adminMenu());
    return true;
  }

  if (text === BTN.APPROVE && user.pendingOrderId) {
    await approveOrder(user, chatId);
    return true;
  }

  if (text === BTN.REJECT && user.pendingOrderId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: "REJECT_REASON" },
    });
    await reply(user, chatId, "دلیل رد فاکتور را بنویسید:");
    return true;
  }

  if (text === BTN.PACK && user.pendingOrderId) {
    const order = await prisma.order.update({
      where: { id: user.pendingOrderId },
      data: { status: "PACKAGING" },
    });

    await notifyOrderStatus(order, "📦 سفارش در حال بسته‌بندی است.");
    await reply(user, chatId, "وضعیت: بسته‌بندی", adminApprovedActions());
    return true;
  }

  if (text === BTN.SHIP && user.pendingOrderId) {
    await reply(
      user,
      chatId,
      "نوع ارسال را انتخاب کنید:",
      inlineKb([
        [{ text: "🚗 ارسال با اسنپ", callback_data: `ship:snapp:${user.pendingOrderId}` }],
        [{ text: "📦 ارسال با پست", callback_data: `ship:post:${user.pendingOrderId}` }],
      ])
    );
    return true;
  }

  return false;
};

async function showAdminOrderDetail(user, chatId, order) {
  await prisma.user.update({
    where: { id: user.id },
    data: { pendingOrderId: order.id },
  });

  const invoice = buildInvoiceText(order, order.items);
  let keyboard = adminMenu();

  if (order.status === "WAITING_APPROVAL") {
    keyboard = adminOrderActions();

    if (order.receiptImage) {
      await bale.sendPhoto(chatId, order.receiptImage, "📸 رسید پرداخت");
    }

    await reply(user, chatId, invoice, keyboard);
    return;
  }

  if (order.status === "APPROVED" || order.status === "PACKAGING") {
    keyboard = adminApprovedActions();
  }

  await reply(user, chatId, invoice, keyboard);
}

async function approveOrder(user, chatId) {
  const order = await prisma.order.update({
    where: { id: user.pendingOrderId },
    data: { status: "PACKAGING" },
    include: { items: { include: { product: true } } },
  });

  await notifyOrderStatus(order, "✅ فاکتور تایید شد. در حال آماده‌سازی.");

  try {
    const pdfPath = await generateInvoicePdf(order, order.items);
    await bale.sendDocument(
      chatId,
      fs.createReadStream(pdfPath),
      `فاکتور ${order.trackingCode}`
    );
    fs.unlinkSync(pdfPath);
  } catch (err) {
    console.log("PDF ERROR:", err.message);
  }

  const owner = await prisma.user.findUnique({
    where: { id: order.userId },
  });

  if (owner) {
    await notify(owner.baleId, buildInvoiceText(order, order.items));

    if (owner.referrerId) {
      const commission = Math.floor(order.totalAmount * 0.05);
      if (commission > 0) {
        await getOrCreateWallet(owner.referrerId);
        await prisma.wallet.update({
          where: { userId: owner.referrerId },
          data: { balance: { increment: commission } },
        });

        const referrer = await prisma.user.findUnique({
          where: { id: owner.referrerId },
        });

        if (referrer) {
          await notify(
            referrer.baleId,
            `🎉 پورسانت دریافت کردید!\n\n💰 مبلغ: ${commission.toLocaleString("fa-IR")} تومان\n\nاین پورسانت بابت خرید تایید‌شده یکی از معرفی‌شده‌های شما است.\nبرای مشاهده موجودی کیف پول از منوی اصلی وارد شوید.`
          );
        }
      }
    }
  }

  await reply(user, chatId, "✅ فاکتور تایید شد.", adminApprovedActions());
}

module.exports.viewOrderById = async function viewOrderById(user, chatId, orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } } },
  });
  if (!order) {
    await reply(user, chatId, "فاکتور پیدا نشد.", adminMenu());
    return;
  }
  await showAdminOrderDetail(user, chatId, order);
};

module.exports.showRejectedOrders = async function showRejectedOrders(user, chatId, offset) {
  await showOrdersInline(user, chatId, { status: "REJECTED" }, "❌ فاکتورهای رد شده", "rej_more", offset);
};

module.exports.showShippedOrders = async function showShippedOrders(user, chatId, offset) {
  await showOrdersInline(user, chatId, { status: "SHIPPED" }, "🚚 فاکتورهای ارسال شده", "shipd_more", offset);
};

async function showPendingWithdrawals(user, chatId) {
  const withdrawals = await prisma.withdrawal.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: { wallet: { include: { user: true } } },
  });

  if (!withdrawals.length) {
    await reply(user, chatId, "💸 درخواست‌های پورسانت\n\nدرخواست برداشت در انتظاری وجود ندارد.", adminMenu());
    return;
  }

  const rows = withdrawals.map((w) => [{
    text: `👤 ${w.wallet.user.fullName || w.wallet.user.baleId} | 💰 ${w.amount.toLocaleString("fa-IR")} تومان`,
    callback_data: `wdr:${w.id}`,
  }]);

  await reply(user, chatId, `💸 درخواست‌های پورسانت (${withdrawals.length} مورد)\n\nروی هر درخواست کلیک کنید:`, inlineKb(rows));
}

module.exports.showWithdrawalDetail = async function showWithdrawalDetail(user, chatId, withdrawalId) {
  const w = await prisma.withdrawal.findUnique({
    where: { id: withdrawalId },
    include: { wallet: { include: { user: true } } },
  });

  if (!w) {
    await reply(user, chatId, "درخواست پیدا نشد.", adminMenu());
    return;
  }

  const date = new Date(w.createdAt).toLocaleDateString("fa-IR");
  const status = w.status === "PAID" ? "✅ پرداخت شده" : "⏳ در انتظار";

  const detail = [
    "💸 جزئیات درخواست برداشت",
    "━━━━━━━━━━━━━━━━━━",
    `👤 کاربر: ${w.wallet.user.fullName || w.wallet.user.baleId}`,
    `💰 مبلغ: ${w.amount.toLocaleString("fa-IR")} تومان`,
    `💳 شماره کارت: ${w.cardNumber}`,
    `👤 نام صاحب کارت: ${w.cardHolder}`,
    `📅 تاریخ: ${date}`,
    `📊 وضعیت: ${status}`,
  ].join("\n");

  if (w.status === "PAID") {
    await reply(user, chatId, `${detail}\n🔖 کد رهگیری: ${w.trackingCode}`, adminMenu());
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: `CONFIRM_WITHDRAWAL:${w.id}` },
  });

  await reply(
    user,
    chatId,
    `${detail}\n\nپس از واریز مبلغ، کد رهگیری تراکنش را وارد کنید:`,
    backMain()
  );
};

async function confirmWithdrawal(user, chatId, withdrawalId, trackingCode) {
  const w = await prisma.withdrawal.findUnique({
    where: { id: withdrawalId },
    include: { wallet: { include: { user: true } } },
  });

  if (!w || w.status === "PAID") {
    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: null },
    });
    await reply(user, chatId, "این درخواست قبلاً تایید شده یا پیدا نشد.", adminMenu());
    return;
  }

  await prisma.withdrawal.update({
    where: { id: withdrawalId },
    data: { status: "PAID", trackingCode: trackingCode.trim() },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: null },
  });

  const recipient = w.wallet.user;
  await notify(
    recipient.baleId,
    `🎉 تبریک! پورسانت شما واریز شد.\n\n💰 مبلغ: ${w.amount.toLocaleString("fa-IR")} تومان\n💳 شماره کارت: ${w.cardNumber}\n🔖 کد رهگیری: ${trackingCode.trim()}\n\nمبلغ با موفقیت به حساب شما واریز گردید.`
  );

  await reply(user, chatId, `✅ تایید شد. کد رهگیری برای کاربر ارسال گردید.`, adminMenu());
}

module.exports.handleAdminPhoto = async function handleAdminPhoto(
  user,
  chatId,
  photo
) {
  if (user.adminStep !== "SET_IMAGE_UPLOAD" || !user.lastProductCode) {
    return false;
  }

  const fileId = photo[photo.length - 1].file_id;

  await prisma.product.update({
    where: { code: user.lastProductCode },
    data: { imageUrl: fileId },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: null, lastProductCode: null },
  });

  await reply(user, chatId, "✅ عکس محصول ذخیره شد.", adminMenu());
  return true;
};
