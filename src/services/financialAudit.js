const prisma = require("../database/prisma");

let ensurePromise = null;

function newId() {
  return `fa${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureFinancialAudit() {
  if (!ensurePromise) {
    ensurePromise = prisma
      .$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "FinancialAudit" (
          "id" TEXT NOT NULL,
          "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "actorUserId" TEXT,
          "action" TEXT NOT NULL,
          "entityType" TEXT,
          "entityId" TEXT,
          "amount" INTEGER,
          "balanceBefore" INTEGER,
          "balanceAfter" INTEGER,
          "reason" TEXT,
          "detail" TEXT,
          CONSTRAINT "FinancialAudit_pkey" PRIMARY KEY ("id")
        )`
      )
      .catch((err) => {
        ensurePromise = null;
        console.error("FINANCIAL AUDIT TABLE SKIP:", err.message);
      });
  }
  return ensurePromise;
}

async function logFinancial(entry) {
  try {
    await ensureFinancialAudit();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "FinancialAudit"
        ("id","at","actorUserId","action","entityType","entityId","amount","balanceBefore","balanceAfter","reason","detail")
       VALUES ($1,CURRENT_TIMESTAMP,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      newId(),
      entry.actorUserId || null,
      String(entry.action || "UNKNOWN"),
      entry.entityType || null,
      entry.entityId || null,
      entry.amount == null ? null : Math.trunc(Number(entry.amount)),
      entry.balanceBefore == null ? null : Math.trunc(Number(entry.balanceBefore)),
      entry.balanceAfter == null ? null : Math.trunc(Number(entry.balanceAfter)),
      entry.reason || null,
      entry.detail == null
        ? null
        : typeof entry.detail === "string"
          ? entry.detail
          : JSON.stringify(entry.detail)
    );
  } catch (err) {
    console.error("FINANCIAL AUDIT SKIP:", err.message);
  }
}

module.exports = {
  ensureFinancialAudit,
  logFinancial,
};
