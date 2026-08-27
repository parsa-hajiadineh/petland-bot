const prisma = require("../database/prisma");
const { notify } = require("../bot/messenger");
const { formatPrice } = require("../utils/price");
const creditLedger = require("./creditLedger");
const { findOwnedTenant } = require("./shopProvision");

const GOLDEN_LIMIT = 10_000_000;
const GOLDEN_MULTIPLIER = 5;
const GOLDEN_HOURS = 48;
const STANDARD_RATE = 10;
const REF_ORDER = "Order";

function newId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

let ensurePromise = null;

async function ensureGoldenCampaign() {
  if (!ensurePromise) {
    ensurePromise = ensureInner().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

async function execSql(label, sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (err) {
    console.error(label, err.message);
  }
}

async function ensureInner() {
  await execSql(
    "GOLDEN PERIOD TABLE SKIP:",
    `CREATE TABLE IF NOT EXISTS "ColleagueGoldenPeriod" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "startedAt" TIMESTAMP(3) NOT NULL,
      "endsAt" TIMESTAMP(3) NOT NULL,
      "limitToman" INTEGER NOT NULL DEFAULT 10000000,
      "multiplier" INTEGER NOT NULL DEFAULT 5,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ColleagueGoldenPeriod_pkey" PRIMARY KEY ("id")
    )`
  );
  await execSql(
    "GOLDEN PERIOD USER INDEX SKIP:",
    `CREATE UNIQUE INDEX IF NOT EXISTS "ColleagueGoldenPeriod_userId_key"
     ON "ColleagueGoldenPeriod"("userId")`
  );
  await execSql(
    "ORDER RECEIPT TABLE SKIP:",
    `CREATE TABLE IF NOT EXISTS "OrderReceipt" (
      "id" TEXT NOT NULL,
      "orderId" TEXT NOT NULL,
      "uploadedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "OrderReceipt_pkey" PRIMARY KEY ("id")
    )`
  );
  await execSql(
    "ORDER RECEIPT ORDER INDEX SKIP:",
    `CREATE UNIQUE INDEX IF NOT EXISTS "OrderReceipt_orderId_key" ON "OrderReceipt"("orderId")`
  );
}

function mapPeriod(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    startedAt: new Date(row.startedAt),
    endsAt: new Date(row.endsAt),
    limitToman: Number(row.limitToman || GOLDEN_LIMIT),
    multiplier: Number(row.multiplier || GOLDEN_MULTIPLIER),
  };
}

async function getGoldenPeriod(userId) {
  if (!userId) return null;
  await ensureGoldenCampaign();
  if (prisma.colleagueGoldenPeriod?.findUnique) {
    try {
      const row = await prisma.colleagueGoldenPeriod.findUnique({
        where: { userId },
      });
      if (row) return mapPeriod(row);
    } catch (err) {
      console.error("GOLDEN PERIOD GET PRISMA SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "ColleagueGoldenPeriod" WHERE "userId" = $1 LIMIT 1`,
    userId
  );
  return mapPeriod(rows?.[0]);
}

async function startGoldenPeriod(userId) {
  if (!userId) return null;
  const existing = await getGoldenPeriod(userId);
  if (existing) return existing;
  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + GOLDEN_HOURS * 60 * 60 * 1000);
  if (prisma.colleagueGoldenPeriod?.create) {
    try {
      return mapPeriod(
        await prisma.colleagueGoldenPeriod.create({
          data: {
            userId,
            startedAt,
            endsAt,
            limitToman: GOLDEN_LIMIT,
            multiplier: GOLDEN_MULTIPLIER,
          },
        })
      );
    } catch (err) {
      console.error("GOLDEN PERIOD CREATE PRISMA SKIP:", err.message);
    }
  }
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ColleagueGoldenPeriod"
        ("id","userId","startedAt","endsAt","limitToman","multiplier","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)`,
      newId(),
      userId,
      startedAt,
      endsAt,
      GOLDEN_LIMIT,
      GOLDEN_MULTIPLIER
    );
  } catch (err) {
    console.error("GOLDEN PERIOD INSERT SKIP:", err.message);
  }
  return getGoldenPeriod(userId);
}

async function recordReceiptUpload(orderId, at = new Date()) {
  if (!orderId) return null;
  await ensureGoldenCampaign();
  const uploadedAt = at instanceof Date ? at : new Date(at);
  if (prisma.orderReceipt?.create) {
    try {
      const existing = await prisma.orderReceipt.findUnique({
        where: { orderId },
      });
      if (existing) return existing;
      return await prisma.orderReceipt.create({
        data: { orderId, uploadedAt },
      });
    } catch (err) {
      console.error("ORDER RECEIPT PRISMA SKIP:", err.message);
    }
  }
  const found = await prisma.$queryRawUnsafe(
    `SELECT * FROM "OrderReceipt" WHERE "orderId" = $1 LIMIT 1`,
    orderId
  );
  if (found?.[0]) return found[0];
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "OrderReceipt" ("id","orderId","uploadedAt") VALUES ($1,$2,$3)`,
      newId(),
      orderId,
      uploadedAt
    );
  } catch (err) {
    console.error("ORDER RECEIPT INSERT SKIP:", err.message);
  }
  const again = await prisma.$queryRawUnsafe(
    `SELECT * FROM "OrderReceipt" WHERE "orderId" = $1 LIMIT 1`,
    orderId
  );
  return again?.[0] || null;
}

async function getReceiptUploadedAt(orderId) {
  if (!orderId) return null;
  await ensureGoldenCampaign();
  if (prisma.orderReceipt?.findUnique) {
    try {
      const row = await prisma.orderReceipt.findUnique({
        where: { orderId },
      });
      if (row?.uploadedAt) return new Date(row.uploadedAt);
    } catch (err) {
      console.error("ORDER RECEIPT GET PRISMA SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "uploadedAt" FROM "OrderReceipt" WHERE "orderId" = $1 LIMIT 1`,
    orderId
  );
  return rows?.[0]?.uploadedAt ? new Date(rows[0].uploadedAt) : null;
}

function isInGoldenWindow(receiptAt, period) {
  if (!receiptAt || !period) return false;
  const t = receiptAt.getTime();
  return t >= period.startedAt.getTime() && t <= period.endsAt.getTime();
}

function splitBases({ orderAmount, receiptAt, period, alreadyGoldenBase }) {
  const amount = Math.max(0, Math.trunc(Number(orderAmount) || 0));
  if (!amount) {
    return { goldenBase: 0, standardBase: 0 };
  }
  if (!isInGoldenWindow(receiptAt, period)) {
    return { goldenBase: 0, standardBase: amount };
  }
  const remaining = Math.max(0, period.limitToman - alreadyGoldenBase);
  const goldenBase = Math.min(amount, remaining);
  return { goldenBase, standardBase: amount - goldenBase };
}

async function grantPurchaseCredit(order, actorUserId) {
  try {
    if (!order?.id || !order.userId) return null;
    if (order.tenantId) return null;
    if (!String(order.trackingCode || "").startsWith("PL-")) return null;
    if (!order.isWholesale) return null;

    const period = await getGoldenPeriod(order.userId);
    if (!period) return null;

    const receiptAt = await getReceiptUploadedAt(order.id);
    if (!receiptAt) return null;
    if (receiptAt.getTime() < period.startedAt.getTime()) return null;

    const tenant = await findOwnedTenant(order.userId);
    const wallet = await creditLedger.getOrCreateWallet({
      userId: order.userId,
      tenantId: tenant?.id || null,
    });
    if (!wallet) return null;

    const existing = await creditLedger.listByReference(
      wallet.id,
      REF_ORDER,
      order.id
    );
    const hasGolden = existing.some(
      (row) => row.type === creditLedger.CREDIT_TYPE.GOLDEN_REWARD
    );
    const hasStandard = existing.some(
      (row) => row.type === creditLedger.CREDIT_TYPE.PURCHASE_REWARD
    );

    const alreadyGoldenBase = await creditLedger.usedGoldenBase(
      wallet.id,
      order.id
    );
    const { goldenBase, standardBase } = splitBases({
      orderAmount: order.totalAmount,
      receiptAt,
      period,
      alreadyGoldenBase,
    });

    const created = [];
    if (goldenBase > 0 && !hasGolden) {
      const amount = goldenBase * period.multiplier;
      created.push(
        await creditLedger.appendTransaction({
          userId: order.userId,
          tenantId: tenant?.id || null,
          amount,
          type: creditLedger.CREDIT_TYPE.GOLDEN_REWARD,
          title: creditLedger.CREDIT_TYPE_TITLE.GOLDEN_REWARD,
          referenceType: REF_ORDER,
          referenceId: order.id,
          createdByUserId: actorUserId || null,
          metadata: {
            orderId: order.id,
            trackingCode: order.trackingCode,
            goldenBase,
            multiplier: period.multiplier,
          },
        })
      );
    }
    if (standardBase > 0 && !hasStandard) {
      const amount = Math.floor((standardBase * STANDARD_RATE) / 100);
      if (amount > 0) {
        created.push(
          await creditLedger.appendTransaction({
            userId: order.userId,
            tenantId: tenant?.id || null,
            amount,
            type: creditLedger.CREDIT_TYPE.PURCHASE_REWARD,
            title: creditLedger.CREDIT_TYPE_TITLE.PURCHASE_REWARD,
            referenceType: REF_ORDER,
            referenceId: order.id,
            createdByUserId: actorUserId || null,
            metadata: {
              orderId: order.id,
              trackingCode: order.trackingCode,
              standardBase,
              ratePercent: STANDARD_RATE,
            },
          })
        );
      }
    }

    if (!created.length) return { created: [], totalCredit: 0 };

    const totalCredit = created.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const owner = await prisma.user.findUnique({
      where: { id: order.userId },
      select: { baleId: true },
    });
    if (owner?.baleId && totalCredit > 0) {
      try {
        await notify(
          owner.baleId,
          `✅ اعتبار خرید همکار به کیف پول اعتباری اضافه شد.\n\n🔖 ${order.trackingCode}\n💰 ${formatPrice(totalCredit)}\n\nجزئیات را در مدیریت فروشگاه → کیف پول اعتباری ببینید.`
        );
      } catch (err) {
        console.error("GOLDEN CREDIT NOTIFY SKIP:", err.message);
      }
    }
    return { created, totalCredit, goldenBase, standardBase };
  } catch (err) {
    console.error("GOLDEN CREDIT GRANT:", err);
    return null;
  }
}

module.exports = {
  GOLDEN_LIMIT,
  GOLDEN_MULTIPLIER,
  GOLDEN_HOURS,
  STANDARD_RATE,
  ensureGoldenCampaign,
  startGoldenPeriod,
  getGoldenPeriod,
  recordReceiptUpload,
  getReceiptUploadedAt,
  grantPurchaseCredit,
  splitBases,
};
