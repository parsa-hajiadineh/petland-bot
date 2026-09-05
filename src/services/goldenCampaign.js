const prisma = require("../database/prisma");
const { notifyShop } = require("../bot/messenger");
const { formatPrice } = require("../utils/price");
const creditLedger = require("./creditLedger");
const { findOwnedTenant } = require("./shopProvision");

const DEFAULTS = {
  goldenHours: 48,
  goldenLimitToman: 10_000_000,
  goldenPercent: 500,
  standardPercent: 10,
};
const SETTINGS_ID = "default";
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
  await execSql(
    "CREDIT SETTINGS TABLE SKIP:",
    `CREATE TABLE IF NOT EXISTS "CreditCampaignSettings" (
      "id" TEXT NOT NULL,
      "goldenHours" INTEGER NOT NULL DEFAULT 48,
      "goldenLimitToman" INTEGER NOT NULL DEFAULT 10000000,
      "goldenPercent" INTEGER NOT NULL DEFAULT 500,
      "standardPercent" INTEGER NOT NULL DEFAULT 10,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CreditCampaignSettings_pkey" PRIMARY KEY ("id")
    )`
  );
  await execSql(
    "GOLDEN PERIOD PERCENT COL SKIP:",
    `ALTER TABLE "ColleagueGoldenPeriod" ADD COLUMN IF NOT EXISTS "goldenPercent" INTEGER`
  );
}

function mapPeriod(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    startedAt: new Date(row.startedAt),
    endsAt: new Date(row.endsAt),
    limitToman: Number(row.limitToman || DEFAULTS.goldenLimitToman),
    multiplier: Number(row.multiplier || 5),
    goldenPercent: Number(
      row.goldenPercent || (Number(row.multiplier || 5) * 100)
    ),
  };
}

function mapSettings(row) {
  return {
    goldenHours: Number(row?.goldenHours || DEFAULTS.goldenHours),
    goldenLimitToman: Number(row?.goldenLimitToman || DEFAULTS.goldenLimitToman),
    goldenPercent: Number(row?.goldenPercent || DEFAULTS.goldenPercent),
    standardPercent: Number(row?.standardPercent || DEFAULTS.standardPercent),
  };
}

async function getSettings() {
  await ensureGoldenCampaign();
  if (prisma.creditCampaignSettings?.findUnique) {
    try {
      const row = await prisma.creditCampaignSettings.findUnique({
        where: { id: SETTINGS_ID },
      });
      if (row) return mapSettings(row);
    } catch (err) {
      console.error("CREDIT SETTINGS GET PRISMA SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "CreditCampaignSettings" WHERE "id" = $1 LIMIT 1`,
    SETTINGS_ID
  );
  if (rows?.[0]) return mapSettings(rows[0]);
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CreditCampaignSettings"
        ("id","goldenHours","goldenLimitToman","goldenPercent","standardPercent","updatedAt")
       VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)`,
      SETTINGS_ID,
      DEFAULTS.goldenHours,
      DEFAULTS.goldenLimitToman,
      DEFAULTS.goldenPercent,
      DEFAULTS.standardPercent
    );
  } catch (err) {
    console.error("CREDIT SETTINGS SEED SKIP:", err.message);
  }
  return { ...DEFAULTS };
}

async function updateSettings(patch) {
  const current = await getSettings();
  const next = {
    goldenHours: Number(patch.goldenHours ?? current.goldenHours),
    goldenLimitToman: Number(patch.goldenLimitToman ?? current.goldenLimitToman),
    goldenPercent: Number(patch.goldenPercent ?? current.goldenPercent),
    standardPercent: Number(patch.standardPercent ?? current.standardPercent),
  };
  if (prisma.creditCampaignSettings?.upsert) {
    try {
      await prisma.creditCampaignSettings.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID, ...next },
        update: next,
      });
      return next;
    } catch (err) {
      console.error("CREDIT SETTINGS UPSERT PRISMA SKIP:", err.message);
    }
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CreditCampaignSettings"
      ("id","goldenHours","goldenLimitToman","goldenPercent","standardPercent","updatedAt")
     VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
     ON CONFLICT ("id") DO UPDATE SET
      "goldenHours" = EXCLUDED."goldenHours",
      "goldenLimitToman" = EXCLUDED."goldenLimitToman",
      "goldenPercent" = EXCLUDED."goldenPercent",
      "standardPercent" = EXCLUDED."standardPercent",
      "updatedAt" = CURRENT_TIMESTAMP`,
    SETTINGS_ID,
    next.goldenHours,
    next.goldenLimitToman,
    next.goldenPercent,
    next.standardPercent
  );
  return next;
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

async function startGoldenPeriod(userId, startedAtInput) {
  if (!userId) return null;
  const existing = await getGoldenPeriod(userId);
  if (existing) return existing;
  const settings = await getSettings();
  const startedAt =
    startedAtInput instanceof Date
      ? startedAtInput
      : startedAtInput
        ? new Date(startedAtInput)
        : new Date();
  const endsAt = new Date(
    startedAt.getTime() + settings.goldenHours * 60 * 60 * 1000
  );
  const multiplier = Math.max(1, Math.round(settings.goldenPercent / 100));
  if (prisma.colleagueGoldenPeriod?.create) {
    try {
      return mapPeriod(
        await prisma.colleagueGoldenPeriod.create({
          data: {
            userId,
            startedAt,
            endsAt,
            limitToman: settings.goldenLimitToman,
            multiplier,
            goldenPercent: settings.goldenPercent,
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
        ("id","userId","startedAt","endsAt","limitToman","multiplier","goldenPercent","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)`,
      newId(),
      userId,
      startedAt,
      endsAt,
      settings.goldenLimitToman,
      multiplier,
      settings.goldenPercent
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

function liveWindow(period, settings) {
  if (!period) return null;
  const hours = Number(settings?.goldenHours || DEFAULTS.goldenHours);
  return {
    ...period,
    endsAt: new Date(period.startedAt.getTime() + hours * 60 * 60 * 1000),
    limitToman: Number(settings?.goldenLimitToman || DEFAULTS.goldenLimitToman),
    goldenPercent: Number(settings?.goldenPercent || DEFAULTS.goldenPercent),
  };
}

function isColleagueBuyer(user) {
  return user?.role === "COLLEAGUE" || user?.role === "ADMIN";
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

async function grantPurchaseCredit(order, actorUserId, options = {}) {
  try {
    if (!order?.id || !order.userId) return null;
    if (order.tenantId) return null;
    if (!String(order.trackingCode || "").startsWith("PL-")) return null;

    const owner = await prisma.user.findUnique({
      where: { id: order.userId },
      select: { id: true, role: true, baleId: true },
    });
    if (!owner) return null;
    if (owner.role === "MANELI") return null;
    if (!order.isWholesale && !isColleagueBuyer(owner)) return null;

    const settings = await getSettings();
    const receiptAt = await getReceiptUploadedAt(order.id);
    if (!receiptAt) return null;

    let period = await getGoldenPeriod(order.userId);
    if (!period && isColleagueBuyer(owner)) {
      period = await startGoldenPeriod(order.userId, receiptAt);
    }
    if (!period) return null;
    period = liveWindow(period, settings);

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
      const amount = Math.floor(
        (goldenBase * Number(period.goldenPercent || settings.goldenPercent)) /
          100
      );
      if (amount > 0) {
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
            reason: "order_approved",
            metadata: {
              orderId: order.id,
              trackingCode: order.trackingCode,
              goldenBase,
              goldenPercent: period.goldenPercent,
              multiplier: period.multiplier,
            },
          })
        );
      }
    }
    if (standardBase > 0 && !hasStandard) {
      const amount = Math.floor(
        (standardBase * Number(settings.standardPercent || 10)) / 100
      );
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
            reason: "order_approved",
            metadata: {
              orderId: order.id,
              trackingCode: order.trackingCode,
              standardBase,
              ratePercent: settings.standardPercent,
            },
          })
        );
      }
    }

    if (!created.length) return { created: [], totalCredit: 0 };

    const totalCredit = created.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    if (!options.silent && owner.baleId && totalCredit > 0) {
      try {
        await notifyShop(
          owner.baleId,
          `✅ سفارش شما تایید شد و این خرید ${formatPrice(
            totalCredit
          )} اعتبار به کیف پول شما اضافه کرد.\n\n🔖 ${order.trackingCode}`,
          tenant?.id || null
        );
      } catch (err) {
        console.error("GOLDEN CREDIT NOTIFY SKIP:", err.message);
      }
    }
    if (totalCredit > 0) {
      require("./motivation")
        .nudgeColleague({
          userId: order.userId,
          tenantId: tenant?.id || null,
          trigger: "credit_granted",
          extra: { orderId: order.id },
        })
        .catch((err) => console.error("MOTIVATION AFTER CREDIT:", err.message));
    }
    return { created, totalCredit, goldenBase, standardBase };
  } catch (err) {
    console.error("GOLDEN CREDIT GRANT:", err);
    return null;
  }
}

module.exports = {
  DEFAULTS,
  ensureGoldenCampaign,
  getSettings,
  updateSettings,
  startGoldenPeriod,
  getGoldenPeriod,
  recordReceiptUpload,
  getReceiptUploadedAt,
  grantPurchaseCredit,
  splitBases,
};
