const prisma = require("../database/prisma");
const { notifyMother } = require("../bot/messenger");
const {
  isProformaPayExpired,
  PROFORMA_REJECT_KEEP_MS,
  MAX_OPEN_PROFORMAS,
} = require("../utils/order");

const EXPIRE_REASON = "اعتبار ۳ ساعت پرداخت تمام شد.";

async function closeExpiredProforma(order, notifyUser = false) {
  if (!order?.id || !isProformaPayExpired(order)) return false;
  const moved = await prisma.order.updateMany({
    where: {
      id: order.id,
      status: "WAITING_PAYMENT",
      isWholesale: true,
      receiptImage: null,
    },
    data: { status: "REJECTED", rejectReason: EXPIRE_REASON },
  });
  if (moved.count !== 1) return false;
  if (notifyUser && order.userId) {
    try {
      const buyer = await prisma.user.findUnique({
        where: { id: order.userId },
        select: { baleId: true },
      });
      if (buyer?.baleId) {
        await notifyMother(
          buyer.baleId,
          `⏰ اعتبار پیش‌فاکتور ${order.trackingCode} تمام شد.\nبرای خرید باید دوباره سفارش ثبت کنید.`
        );
      }
    } catch (err) {
      console.error("PROFORMA EXPIRE NOTIFY SKIP:", err.message);
    }
  }
  return true;
}

async function expireApprovedProformas() {
  let closed = 0;
  let orders = [];
  try {
    orders = await prisma.order.findMany({
      where: {
        isWholesale: true,
        status: "WAITING_PAYMENT",
        receiptImage: null,
        trackingCode: { startsWith: "PL-" },
        shipmentInfo: { startsWith: "@@CARD@@" },
      },
      select: {
        id: true,
        userId: true,
        trackingCode: true,
        status: true,
        isWholesale: true,
        receiptImage: true,
        shipmentInfo: true,
        updatedAt: true,
      },
    });
  } catch (err) {
    console.error("PROFORMA EXPIRE LIST SKIP:", err.message);
    return 0;
  }
  for (const order of orders) {
    try {
      if (await closeExpiredProforma(order, true)) closed += 1;
    } catch (err) {
      console.error("PROFORMA EXPIRE ONE SKIP:", err.message);
    }
  }
  if (closed) console.log("PROFORMA EXPIRED:", closed);
  return closed;
}

async function purgeOldRejectedProformas() {
  const cutoff = new Date(Date.now() - PROFORMA_REJECT_KEEP_MS);
  try {
    const old = await prisma.order.findMany({
      where: {
        isWholesale: true,
        status: "REJECTED",
        receiptImage: null,
        trackingCode: { startsWith: "PL-" },
        updatedAt: { lt: cutoff },
      },
      select: { id: true },
    });
    if (!old.length) return 0;
    const ids = old.map((o) => o.id);
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    const deleted = await prisma.order.deleteMany({ where: { id: { in: ids } } });
    const count = Number(deleted.count || 0);
    if (count) console.log("PROFORMA REJECT PURGE:", count);
    return count;
  } catch (err) {
    console.error("PROFORMA REJECT PURGE SKIP:", err.message);
    return 0;
  }
}

async function countOpenProformas(userId) {
  try {
    const open = await prisma.order.findMany({
      where: {
        userId,
        isWholesale: true,
        status: "WAITING_PAYMENT",
        receiptImage: null,
        trackingCode: { startsWith: "PL-" },
      },
      select: {
        id: true,
        userId: true,
        trackingCode: true,
        status: true,
        isWholesale: true,
        receiptImage: true,
        shipmentInfo: true,
        updatedAt: true,
      },
    });
    for (const order of open) {
      await closeExpiredProforma(order, false);
    }
  } catch (err) {
    console.error("PROFORMA OPEN COUNT EXPIRE SKIP:", err.message);
  }
  return prisma.order.count({
    where: {
      userId,
      isWholesale: true,
      status: "WAITING_PAYMENT",
      receiptImage: null,
      trackingCode: { startsWith: "PL-" },
    },
  });
}

async function run() {
  await expireApprovedProformas();
  await purgeOldRejectedProformas();
}

module.exports = {
  EXPIRE_REASON,
  MAX_OPEN_PROFORMAS,
  closeExpiredProforma,
  expireApprovedProformas,
  purgeOldRejectedProformas,
  countOpenProformas,
  run,
};
