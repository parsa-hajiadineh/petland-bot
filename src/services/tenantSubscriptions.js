const prisma = require("../database/prisma");

const EXPIRING_SOON_DAYS = 5;

const LIFECYCLE = {
  ACTIVE: "ACTIVE",
  EXPIRING_SOON: "EXPIRING_SOON",
  EXPIRED: "EXPIRED",
  SUSPENDED: "SUSPENDED",
  CANCELLED: "CANCELLED",
};

let ensurePromise = null;

function newId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function hasModel() {
  return Boolean(prisma.tenantSubscription?.create);
}

async function execSql(label, sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (err) {
    console.error(label, err.message);
  }
}

async function ensureTenantSubscriptions() {
  if (!ensurePromise) {
    ensurePromise = ensureInner().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

async function ensureInner() {
  await execSql(
    "SUBSCRIPTION STATUS ENUM SKIP:",
    `DO $$ BEGIN
      CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING','ACTIVE','PAST_DUE','CANCELLED','EXPIRED');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;`
  );
  await execSql(
    "TENANT SUBSCRIPTION TABLE SKIP:",
    `CREATE TABLE IF NOT EXISTS "TenantSubscription" (
      "id" TEXT NOT NULL,
      "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
      "activationFee" INTEGER NOT NULL DEFAULT 0,
      "monthlyFee" INTEGER NOT NULL DEFAULT 0,
      "discountPercent" INTEGER NOT NULL DEFAULT 0,
      "discountedMonthlyFee" INTEGER NOT NULL DEFAULT 0,
      "periodStart" TIMESTAMP(3),
      "periodEnd" TIMESTAMP(3),
      "lastPurchaseVolume" INTEGER NOT NULL DEFAULT 0,
      "tenantId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "TenantSubscription_pkey" PRIMARY KEY ("id")
    )`
  );
  await execSql(
    "TENANT SUBSCRIPTION INVOICE COL SKIP:",
    `ALTER TABLE "TenantSubscription" ADD COLUMN IF NOT EXISTS "lastInvoiceId" TEXT`
  );
  await execSql(
    "TENANT SUBSCRIPTION SERVICES COL SKIP:",
    `ALTER TABLE "TenantSubscription" ADD COLUMN IF NOT EXISTS "servicesJson" TEXT`
  );
  await backfillFromInvoices();
  await refreshStoredLifecycles();
}

function parseServices(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function snapshotServices(invoice) {
  return (invoice.items || []).map((item) => ({
    code: item.code,
    title: item.title,
    unitPrice: Number(item.unitPrice || 0),
    kind: item.kind,
    billing: item.billing,
  }));
}

function daysRemaining(periodEnd, now = new Date()) {
  if (!periodEnd) return null;
  const end = new Date(periodEnd);
  return Math.ceil((end.getTime() - now.getTime()) / 86400000);
}

function lifecycleOf(row, tenantStatus, now = new Date()) {
  if (tenantStatus === "SUSPENDED" || row?.status === "SUSPENDED") {
    return LIFECYCLE.SUSPENDED;
  }
  if (row?.status === "CANCELLED") return LIFECYCLE.CANCELLED;
  const days = daysRemaining(row?.periodEnd, now);
  if (days == null) return row?.status || "PENDING";
  if (days < 0) return LIFECYCLE.EXPIRED;
  if (days <= EXPIRING_SOON_DAYS) return LIFECYCLE.EXPIRING_SOON;
  return LIFECYCLE.ACTIVE;
}

function mapRow(row, tenantStatus) {
  if (!row) return null;
  const days = daysRemaining(row.periodEnd);
  const stored =
    days != null && days < 0 && row.status === "ACTIVE"
      ? LIFECYCLE.EXPIRED
      : row.status;
  return {
    id: row.id,
    tenantId: row.tenantId,
    status: stored,
    lifecycle: lifecycleOf({ ...row, status: stored }, tenantStatus),
    periodStart: row.periodStart || null,
    periodEnd: row.periodEnd || null,
    price: Number(row.monthlyFee || row.discountedMonthlyFee || 0),
    activationFee: Number(row.activationFee || 0),
    monthlyFee: Number(row.monthlyFee || 0),
    daysRemaining: days,
    services: parseServices(row.servicesJson),
    lastInvoiceId: row.lastInvoiceId || null,
  };
}

async function findByTenant(tenantId) {
  if (!tenantId) return null;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM "TenantSubscription" WHERE "tenantId" = $1 ORDER BY "periodEnd" DESC NULLS LAST LIMIT 1`,
      tenantId
    );
    if (rows?.[0]) return rows[0];
  } catch (err) {
    console.error("TENANT SUBSCRIPTION FIND SQL SKIP:", err.message);
  }
  if (hasModel()) {
    try {
      return await prisma.tenantSubscription.findFirst({
        where: { tenantId },
        orderBy: { periodEnd: "desc" },
      });
    } catch (err) {
      console.error("TENANT SUBSCRIPTION FIND SKIP:", err.message);
    }
  }
  return null;
}

async function writeSnapshot(id, lastInvoiceId, services) {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "TenantSubscription"
       SET "lastInvoiceId" = $2, "servicesJson" = $3, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1`,
      id,
      lastInvoiceId || null,
      JSON.stringify(services || [])
    );
  } catch (err) {
    console.error("TENANT SUBSCRIPTION SNAPSHOT SKIP:", err.message);
  }
}

async function persistExpired(id) {
  if (!id) return;
  try {
    if (hasModel()) {
      await prisma.tenantSubscription.update({
        where: { id },
        data: { status: "EXPIRED" },
      });
      return;
    }
  } catch (err) {
    console.error("TENANT SUBSCRIPTION EXPIRE PRISMA SKIP:", err.message);
  }
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "TenantSubscription" SET "status" = 'EXPIRED', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
      id
    );
  } catch (err) {
    console.error("TENANT SUBSCRIPTION EXPIRE SQL SKIP:", err.message);
  }
}

async function getForTenant(tenantId, tenantStatus) {
  await ensureTenantSubscriptions();
  const row = await findByTenant(tenantId);
  if (!row) return null;
  const mapped = mapRow(row, tenantStatus);
  if (mapped.lifecycle === LIFECYCLE.EXPIRED && row.status === "ACTIVE") {
    await persistExpired(row.id);
    mapped.status = LIFECYCLE.EXPIRED;
  }
  return mapped;
}

async function updateExisting(existing, monthlyFee, activationFee, periodStart, periodEnd) {
  if (hasModel()) {
    try {
      const data = {
        status: "ACTIVE",
        monthlyFee,
        discountedMonthlyFee: monthlyFee,
        periodStart,
        periodEnd,
      };
      if (activationFee != null) data.activationFee = activationFee;
      await prisma.tenantSubscription.update({
        where: { id: existing.id },
        data,
      });
      return existing.id;
    } catch (err) {
      console.error("TENANT SUBSCRIPTION UPDATE SKIP:", err.message);
    }
  }
  await prisma.$executeRawUnsafe(
    `UPDATE "TenantSubscription"
     SET "status" = 'ACTIVE',
         "monthlyFee" = $2,
         "discountedMonthlyFee" = $2,
         "activationFee" = COALESCE($3, "activationFee"),
         "periodStart" = $4,
         "periodEnd" = $5,
         "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1`,
    existing.id,
    monthlyFee,
    activationFee == null ? null : activationFee,
    periodStart,
    periodEnd
  );
  return existing.id;
}

async function insertNew(tenantId, monthlyFee, activationFee, periodStart, periodEnd) {
  const id = newId();
  if (hasModel()) {
    try {
      const created = await prisma.tenantSubscription.create({
        data: {
          id,
          tenantId,
          status: "ACTIVE",
          monthlyFee,
          discountedMonthlyFee: monthlyFee,
          activationFee: activationFee || 0,
          periodStart,
          periodEnd,
        },
      });
      return created.id;
    } catch (err) {
      console.error("TENANT SUBSCRIPTION CREATE SKIP:", err.message);
    }
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO "TenantSubscription"
      ("id","status","activationFee","monthlyFee","discountedMonthlyFee","periodStart","periodEnd","tenantId","createdAt","updatedAt")
     VALUES ($1,'ACTIVE',$2,$3,$3,$4,$5,$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    id,
    activationFee || 0,
    monthlyFee,
    periodStart,
    periodEnd,
    tenantId
  );
  return id;
}

async function applyApprovedInvoice(invoice, options = {}) {
  if (!invoice?.tenantId) return null;
  if (!options.skipEnsure) await ensureTenantSubscriptions();
  const services = snapshotServices(invoice);
  const monthlyFee = Number(invoice.monthlyAmount || invoice.totalAmount || 0);
  const activationFee =
    invoice.kind === "INITIAL" ? Number(invoice.onceAmount || 0) : null;
  const periodStart = invoice.periodStart || new Date();
  const periodEnd = invoice.periodEnd || null;
  const existing = await findByTenant(invoice.tenantId);
  const id = existing
    ? await updateExisting(existing, monthlyFee, activationFee, periodStart, periodEnd)
    : await insertNew(invoice.tenantId, monthlyFee, activationFee, periodStart, periodEnd);
  if (id) await writeSnapshot(id, invoice.id, services);
  if (options.skipEnsure) return null;
  return getForTenant(invoice.tenantId);
}

async function refreshStoredLifecycles() {
  let rows = [];
  try {
    rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "status", "periodEnd" FROM "TenantSubscription" WHERE "status" = 'ACTIVE'`
    );
  } catch (err) {
    console.error("TENANT SUBSCRIPTION REFRESH LIST SKIP:", err.message);
    return;
  }
  const now = new Date();
  for (const row of rows || []) {
    if (daysRemaining(row.periodEnd, now) < 0) {
      await persistExpired(row.id);
    }
  }
}

async function backfillFromInvoices() {
  let invoices = [];
  try {
    invoices = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT ON ("tenantId") *
       FROM "ServiceInvoice"
       WHERE "status" = 'APPROVED' AND "tenantId" IS NOT NULL
       ORDER BY "tenantId", "periodEnd" DESC NULLS LAST, "createdAt" DESC`
    );
  } catch (err) {
    console.error("TENANT SUBSCRIPTION BACKFILL LIST SKIP:", err.message);
    return;
  }
  for (const row of invoices || []) {
    try {
      const existing = await findByTenant(row.tenantId);
      if (existing?.lastInvoiceId === row.id) continue;
      const items = await prisma.$queryRawUnsafe(
        `SELECT * FROM "ServiceInvoiceItem" WHERE "invoiceId" = $1`,
        row.id
      );
      await applyApprovedInvoice(
        {
          id: row.id,
          tenantId: row.tenantId,
          kind: row.kind,
          onceAmount: row.onceAmount,
          monthlyAmount: row.monthlyAmount,
          totalAmount: row.totalAmount,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          items: items || [],
        },
        { skipEnsure: true }
      );
    } catch (err) {
      console.error("TENANT SUBSCRIPTION BACKFILL SKIP:", err.message);
    }
  }
}

async function listShopLifecycles() {
  await ensureTenantSubscriptions();
  let bots = [];
  try {
    bots = await prisma.$queryRawUnsafe(
      `SELECT b."id" AS "botId", b."status" AS "botStatus", b."isEnabled",
              t."id" AS "tenantId", t."name" AS "tenantName", t."status" AS "tenantStatus"
       FROM "Bot" b
       JOIN "Tenant" t ON t."id" = b."tenantId"`
    );
  } catch (err) {
    console.error("TENANT SUBSCRIPTION BOTS SKIP:", err.message);
    return [];
  }
  const result = [];
  for (const bot of bots || []) {
    const sub = await getForTenant(bot.tenantId, bot.tenantStatus);
    result.push({
      botId: bot.botId,
      botStatus: bot.botStatus,
      isEnabled: bot.isEnabled,
      tenantId: bot.tenantId,
      tenantName: bot.tenantName,
      tenantStatus: bot.tenantStatus,
      subscription: sub,
      lifecycle:
        sub?.lifecycle ||
        (bot.tenantStatus === "SUSPENDED" ? LIFECYCLE.SUSPENDED : LIFECYCLE.EXPIRED),
      daysRemaining: sub?.daysRemaining ?? null,
    });
  }
  return result;
}

module.exports = {
  EXPIRING_SOON_DAYS,
  LIFECYCLE,
  ensureTenantSubscriptions,
  applyApprovedInvoice,
  getForTenant,
  listShopLifecycles,
};
