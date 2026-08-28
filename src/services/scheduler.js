const prisma = require("../database/prisma");
const { formatPrice } = require("../utils/price");
const partnerNotify = require("./partnerNotify");
const campaign = require("./goldenCampaign");
const subscriptions = require("./tenantSubscriptions");
const invoices = require("./serviceInvoices");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const KINDS = {
  GOLDEN_12H: "GOLDEN_12H",
  GOLDEN_END: "GOLDEN_END",
  SUB_5D: "SUB_5D",
  SUB_END: "SUB_END",
  INV_PAY_1: "INV_PAY_1",
  INV_PAY_2: "INV_PAY_2",
};

let ensurePromise = null;
let started = false;
let lastDailyKey = "";
let running = false;

async function execSql(label, sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (err) {
    console.error(label, err.message);
  }
}

async function ensureNotices() {
  if (!ensurePromise) {
    ensurePromise = execSql(
      "COLLEAGUE NOTICE TABLE SKIP:",
      `CREATE TABLE IF NOT EXISTS "ColleagueNotice" (
        "id" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "tenantId" TEXT,
        "reference" TEXT NOT NULL,
        "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ColleagueNotice_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "ColleagueNotice_kind_user_ref_key" UNIQUE ("kind", "userId", "reference")
      )`
    ).catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

function newId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function tehranDayKey(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" });
}

async function alreadySent(kind, userId, reference) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "ColleagueNotice"
     WHERE "kind" = $1 AND "userId" = $2 AND "reference" = $3
     LIMIT 1`,
    kind,
    userId,
    reference
  );
  return Boolean(rows?.[0]);
}

async function markSent(kind, userId, reference, tenantId) {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ColleagueNotice" ("id","kind","userId","tenantId","reference","sentAt")
       VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
       ON CONFLICT ("kind", "userId", "reference") DO NOTHING`,
      newId(),
      kind,
      userId,
      tenantId || null,
      reference
    );
  } catch (err) {
    console.error("COLLEAGUE NOTICE MARK SKIP:", err.message);
  }
}

async function sendOnce(kind, userId, reference, tenantId, text) {
  if (!userId || !text) return;
  if (await alreadySent(kind, userId, reference)) return;
  const result = await partnerNotify.notifyColleague(userId, text);
  if (result?.skipped || result?.ok === false) return;
  await markSent(kind, userId, reference, tenantId);
}

async function tickGolden(now) {
  const settings = await campaign.getSettings();
  const hours = Number(settings.goldenHours || 48);
  let rows = [];
  try {
    rows = await prisma.$queryRawUnsafe(
      `SELECT "userId", "startedAt" FROM "ColleagueGoldenPeriod"`
    );
  } catch (err) {
    console.error("SCHEDULER GOLDEN LIST SKIP:", err.message);
    return;
  }
  for (const row of rows || []) {
    const startedAt = new Date(row.startedAt);
    const endsAt = new Date(startedAt.getTime() + hours * HOUR_MS);
    const left = endsAt.getTime() - now.getTime();
    const ref = `${row.userId}:${startedAt.toISOString()}`;
    if (left <= 0) {
      await sendOnce(
        KINDS.GOLDEN_END,
        row.userId,
        ref,
        null,
        "دوره طلایی ساخت اعتبار به پایان رسید.\nاز این به بعد اعتبار خرید عمده با درصد عادی محاسبه می‌شود."
      );
      continue;
    }
    if (left <= 12 * HOUR_MS) {
      await sendOnce(
        KINDS.GOLDEN_12H,
        row.userId,
        ref,
        null,
        "حدود ۱۲ ساعت تا پایان دوره طلایی ساخت اعتبار مانده است.\nاگر خرید عمده‌ای دارید، در این پنجره با درصد ویژه ثبت می‌شود."
      );
    }
  }
}

async function tickSubscriptions(now) {
  const shops = await subscriptions.listShopLifecycles();
  for (const shop of shops || []) {
    if (shop.tenantStatus === "SUSPENDED") continue;
    const sub = shop.subscription;
    if (!sub?.periodEnd) continue;
    const ownerId = await ownerUserId(shop.tenantId);
    if (!ownerId) continue;
    const ref = `${shop.tenantId}:${new Date(sub.periodEnd).toISOString()}`;
    const days = sub.daysRemaining;
    if (days == null) continue;
    if (days < 0) {
      await sendOnce(
        KINDS.SUB_END,
        ownerId,
        ref,
        shop.tenantId,
        `اشتراک فروشگاه «${shop.tenantName || "فروشگاه"}» به پایان رسید.\nبرای ادامه سرویس، از پنل فروشگاه دکمه خرید اشتراک را بزنید.`
      );
      continue;
    }
    if (days <= 5) {
      await sendOnce(
        KINDS.SUB_5D,
        ownerId,
        ref,
        shop.tenantId,
        `۵ روز یا کمتر تا پایان اشتراک فروشگاه «${shop.tenantName || "فروشگاه"}» مانده است.\nتمدید را قبل از قطع سرویس انجام دهید.`
      );
    }
  }
}

async function ownerUserId(tenantId) {
  if (!tenantId) return null;
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { ownerUserId: true },
    });
    return tenant?.ownerUserId || null;
  } catch (err) {
    console.error("SCHEDULER OWNER SKIP:", err.message);
    return null;
  }
}

async function tickInvoices(now) {
  let rows = [];
  try {
    rows = await invoices.listInvoicesByStatus(["WAITING_PAYMENT"], 0, 80);
  } catch (err) {
    console.error("SCHEDULER INVOICE LIST SKIP:", err.message);
    return;
  }
  for (const invoice of rows || []) {
    if (!invoice.userId) continue;
    const age = now.getTime() - new Date(invoice.createdAt).getTime();
    if (age < 20 * HOUR_MS) continue;
    const cash = Number(
      invoice.cashAmount != null ? invoice.cashAmount : invoice.totalAmount || 0
    );
    const text =
      `فاکتور خدمات هنوز پرداخت نشده است.\n\n🔖 ${invoice.trackingCode}\n💰 قابل پرداخت: ${formatPrice(
        cash
      )}\n\nاز فاکتور خدمات، تکمیل پرداخت را بزنید.`;
    if (age >= 3 * DAY_MS) {
      await sendOnce(
        KINDS.INV_PAY_2,
        invoice.userId,
        invoice.id,
        invoice.tenantId,
        text
      );
    } else {
      await sendOnce(
        KINDS.INV_PAY_1,
        invoice.userId,
        invoice.id,
        invoice.tenantId,
        text
      );
    }
  }
}

async function runHourly() {
  const now = new Date();
  await tickGolden(now);
}

async function runDaily() {
  const now = new Date();
  await tickSubscriptions(now);
  await tickInvoices(now);
}

async function tick() {
  if (running) return;
  running = true;
  try {
    await ensureNotices();
    await runHourly();
    const dayKey = tehranDayKey();
    if (dayKey !== lastDailyKey) {
      lastDailyKey = dayKey;
      await runDaily();
    }
  } catch (err) {
    console.error("SCHEDULER TICK:", err.message);
  } finally {
    running = false;
  }
}

function start() {
  if (started) return;
  started = true;
  setTimeout(() => {
    tick().catch((err) => console.error("SCHEDULER START:", err.message));
  }, 20000);
  setInterval(() => {
    tick().catch((err) => console.error("SCHEDULER:", err.message));
  }, HOUR_MS);
}

module.exports = {
  start,
  tick,
  KINDS,
};
