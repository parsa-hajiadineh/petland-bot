const prisma = require("../database/prisma");
const { formatPrice } = require("../utils/price");

const PAID_STATUSES = ["APPROVED", "PACKAGING", "SHIPPED", "DELIVERED"];
const MONTHS_KEPT = 12;

function tehranParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function toYearMonth(date) {
  const { y, m } = tehranParts(date);
  return `${y}-${String(m).padStart(2, "0")}`;
}

function monthRange(yearMonth) {
  const [y, m] = String(yearMonth).split("-").map(Number);
  const start = new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00+03:30`);
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  const end = new Date(
    `${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00+03:30`
  );
  return { start, end };
}

function formatMonthLabel(yearMonth) {
  const [year, month] = String(yearMonth).split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString("fa-IR", { year: "numeric", month: "long" });
}

function lastMonths(count = MONTHS_KEPT) {
  const now = tehranParts();
  const list = [];
  for (let i = 0; i < count; i += 1) {
    let m = now.m - i;
    let y = now.y;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    list.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return list;
}

function num(value) {
  return Number(value || 0);
}

async function sumServiceSplit(start, end) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT
         COALESCE(SUM(COALESCE("cashAmount", 0)), 0)::int AS cash,
         COALESCE(SUM(COALESCE("creditAmount", 0)), 0)::int AS credit,
         COUNT(*)::int AS cnt
       FROM "ServiceInvoice"
       WHERE "status" = 'APPROVED'
         AND "createdAt" >= $1 AND "createdAt" < $2`,
      start,
      end
    );
    const row = rows?.[0] || {};
    return {
      serviceCash: num(row.cash),
      serviceCredit: num(row.credit),
      serviceCount: num(row.cnt),
    };
  } catch (err) {
    console.error("SALES STATS SERVICE SKIP:", err.message);
    return { serviceCash: 0, serviceCredit: 0, serviceCount: 0 };
  }
}

async function calcMonthStats(yearMonth) {
  const { start, end } = monthRange(yearMonth);

  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: start, lt: end },
      status: { in: PAID_STATUSES },
      trackingCode: { startsWith: "PL-" },
    },
    select: {
      totalAmount: true,
      isWholesale: true,
      user: { select: { referrerId: true } },
      items: {
        select: {
          quantity: true,
          unitPrice: true,
          product: { select: { costPrice: true } },
        },
      },
    },
  });

  let retailVolume = 0;
  let retailCount = 0;
  let retailProfit = 0;
  let colleagueVolume = 0;
  let colleagueCount = 0;
  let commission = 0;

  for (const order of orders) {
    const amount = num(order.totalAmount);
    if (order.isWholesale) {
      colleagueVolume += amount;
      colleagueCount += 1;
    } else {
      retailVolume += amount;
      retailCount += 1;
      for (const item of order.items || []) {
        retailProfit +=
          (num(item.unitPrice) - num(item.product?.costPrice)) *
          num(item.quantity);
      }
      if (order.user?.referrerId) {
        commission += Math.floor(amount * 0.05);
      }
    }
  }

  const service = await sumServiceSplit(start, end);

  const [
    usersNow,
    colleaguesNow,
    botsNow,
    botsActive,
    usersMonth,
    colleaguesMonth,
    botsMonth,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "CUSTOMER" } }),
    prisma.user.count({ where: { role: "COLLEAGUE" } }),
    prisma.bot.count().catch(() => 0),
    prisma.bot
      .count({ where: { status: "ACTIVE", isEnabled: true } })
      .catch(() => 0),
    prisma.user.count({
      where: { role: "CUSTOMER", createdAt: { gte: start, lt: end } },
    }),
    prisma.user.count({
      where: { role: "COLLEAGUE", createdAt: { gte: start, lt: end } },
    }),
    prisma.bot
      .count({ where: { createdAt: { gte: start, lt: end } } })
      .catch(() => 0),
  ]);

  return {
    retailVolume,
    retailCount,
    retailProfit,
    commission,
    retailGross: retailProfit - commission,
    colleagueVolume,
    colleagueCount,
    serviceCash: service.serviceCash,
    serviceCredit: service.serviceCredit,
    serviceCount: service.serviceCount,
    usersNow,
    colleaguesNow,
    botsNow,
    botsActive,
    usersMonth,
    colleaguesMonth,
    botsMonth,
  };
}

function formatMonthReport(yearMonth, stats, isCurrent) {
  const label = formatMonthLabel(yearMonth);
  const note = isCurrent ? " (جاری)" : "";
  return [
    `📊 آمار فروش — ${label}${note}`,
    "━━━━━━━━━━━━━━━━━━",
    "بخش یوزر (ربات مادر)",
    `۱. حجم فروش خرد: ${formatPrice(stats.retailVolume)}`,
    `   تعداد سفارش: ${Number(stats.retailCount).toLocaleString("fa-IR")}`,
    `   سود فروش خرد: ${formatPrice(stats.retailProfit)}`,
    `۲. کمیسیون بازاریابان: ${formatPrice(stats.commission)}`,
    `۳. سود ناخالص یوزر: ${formatPrice(stats.retailGross)}`,
    "   (سود فروش خرد − کمیسیون)",
    "━━━━━━━━━━━━━━━━━━",
    "بخش همکار",
    `۱. حجم فروش به همکار: ${formatPrice(stats.colleagueVolume)}`,
    `   تعداد سفارش: ${Number(stats.colleagueCount).toLocaleString("fa-IR")}`,
    `۲. فاکتور خدمات نقدی: ${formatPrice(stats.serviceCash)}`,
    `۳. فاکتور خدمات اعتباری: ${formatPrice(stats.serviceCredit)}`,
    `   تعداد فاکتور تاییدشده: ${Number(stats.serviceCount).toLocaleString("fa-IR")}`,
    "━━━━━━━━━━━━━━━━━━",
    "وضعیت فعلی پلتفرم",
    `۱. تعداد کل یوزرها: ${Number(stats.usersNow).toLocaleString("fa-IR")}`,
    `۲. تعداد کل همکاران: ${Number(stats.colleaguesNow).toLocaleString("fa-IR")}`,
    `۳. تعداد کل ربات‌ها: ${Number(stats.botsNow).toLocaleString("fa-IR")}`,
    `   ربات فعال: ${Number(stats.botsActive).toLocaleString("fa-IR")}`,
    "━━━━━━━━━━━━━━━━━━",
    "ثبت‌نام همین ماه",
    `یوزر جدید: ${Number(stats.usersMonth).toLocaleString("fa-IR")} | همکار جدید: ${Number(stats.colleaguesMonth).toLocaleString("fa-IR")} | ربات جدید: ${Number(stats.botsMonth).toLocaleString("fa-IR")}`,
  ].join("\n");
}

module.exports = {
  MONTHS_KEPT,
  toYearMonth,
  formatMonthLabel,
  lastMonths,
  calcMonthStats,
  formatMonthReport,
};
