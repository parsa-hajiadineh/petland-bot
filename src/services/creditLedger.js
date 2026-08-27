const prisma = require("../database/prisma");
const { formatPrice } = require("../utils/price");

const CREDIT_TYPE = {
  GOLDEN_REWARD: "GOLDEN_REWARD",
  PURCHASE_REWARD: "PURCHASE_REWARD",
  SERVICE_PAYMENT: "SERVICE_PAYMENT",
  REFUND: "REFUND",
};

const CREDIT_TYPE_TITLE = {
  GOLDEN_REWARD: "پاداش دوره طلایی",
  PURCHASE_REWARD: "پاداش خرید استاندارد",
  SERVICE_PAYMENT: "پرداخت فاکتور خدمات",
  REFUND: "بازگشت اعتبار",
};

function newId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function hasWalletModel() {
  return Boolean(prisma.creditWallet?.create);
}

function hasTransactionModel() {
  return Boolean(prisma.creditTransaction?.findMany);
}

let ensurePromise = null;

async function ensureCreditLedger() {
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
    "CREDIT WALLET TABLE SKIP:",
    `CREATE TABLE IF NOT EXISTS "CreditWallet" (
      "id" TEXT NOT NULL,
      "tenantId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CreditWallet_pkey" PRIMARY KEY ("id")
    )`
  );
  await execSql(
    "CREDIT WALLET TENANT INDEX SKIP:",
    `CREATE UNIQUE INDEX IF NOT EXISTS "CreditWallet_tenantId_key" ON "CreditWallet"("tenantId")`
  );
  await execSql(
    "CREDIT TRANSACTION TABLE SKIP:",
    `CREATE TABLE IF NOT EXISTS "CreditTransaction" (
      "id" TEXT NOT NULL,
      "amount" INTEGER NOT NULL,
      "type" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "note" TEXT,
      "referenceType" TEXT,
      "referenceId" TEXT,
      "createdByUserId" TEXT,
      "metadata" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "walletId" TEXT NOT NULL,
      CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
    )`
  );
  await execSql(
    "CREDIT TRANSACTION WALLET INDEX SKIP:",
    `CREATE INDEX IF NOT EXISTS "CreditTransaction_walletId_createdAt_idx"
     ON "CreditTransaction"("walletId", "createdAt")`
  );
  await execSql(
    "CREDIT TRANSACTION REF INDEX SKIP:",
    `CREATE INDEX IF NOT EXISTS "CreditTransaction_reference_idx"
     ON "CreditTransaction"("referenceType", "referenceId")`
  );
}

function mapWallet(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    createdAt: row.createdAt,
  };
}

function mapTransaction(row) {
  if (!row) return null;
  return {
    id: row.id,
    amount: Number(row.amount || 0),
    type: row.type,
    title: row.title,
    note: row.note || null,
    referenceType: row.referenceType || null,
    referenceId: row.referenceId || null,
    createdByUserId: row.createdByUserId || null,
    metadata: row.metadata || null,
    createdAt: row.createdAt,
    walletId: row.walletId,
  };
}

function typeTitle(type, fallback) {
  return fallback || CREDIT_TYPE_TITLE[type] || "تراکنش اعتبار";
}

function formatSignedAmount(amount) {
  const n = Number(amount || 0);
  const body = Math.abs(n).toLocaleString("fa-IR");
  if (n > 0) return `+${body} تومان`;
  if (n < 0) return `−${body} تومان`;
  return `${body} تومان`;
}

async function getOrCreateWallet(tenantId) {
  if (!tenantId) return null;
  await ensureCreditLedger();
  if (hasWalletModel()) {
    try {
      const existing = await prisma.creditWallet.findUnique({
        where: { tenantId },
      });
      if (existing) return mapWallet(existing);
      const created = await prisma.creditWallet.create({
        data: { tenantId },
      });
      return mapWallet(created);
    } catch (err) {
      console.error("CREDIT WALLET PRISMA SKIP:", err.message);
    }
  }
  const found = await prisma.$queryRawUnsafe(
    `SELECT * FROM "CreditWallet" WHERE "tenantId" = $1 LIMIT 1`,
    tenantId
  );
  if (found?.[0]) return mapWallet(found[0]);
  const id = newId();
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CreditWallet" ("id","tenantId","createdAt","updatedAt")
       VALUES ($1,$2,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      id,
      tenantId
    );
    return mapWallet({ id, tenantId, createdAt: new Date() });
  } catch (err) {
    console.error("CREDIT WALLET INSERT SKIP:", err.message);
  }
  const again = await prisma.$queryRawUnsafe(
    `SELECT * FROM "CreditWallet" WHERE "tenantId" = $1 LIMIT 1`,
    tenantId
  );
  return mapWallet(again?.[0]);
}

async function getBalance(walletId) {
  if (!walletId) return 0;
  if (hasTransactionModel()) {
    try {
      const agg = await prisma.creditTransaction.aggregate({
        where: { walletId },
        _sum: { amount: true },
      });
      return Number(agg?._sum?.amount || 0);
    } catch (err) {
      console.error("CREDIT BALANCE PRISMA SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM("amount"), 0)::int AS "balance"
     FROM "CreditTransaction" WHERE "walletId" = $1`,
    walletId
  );
  return Number(rows?.[0]?.balance || 0);
}

async function listTransactions(walletId, take = 20) {
  if (!walletId) return [];
  if (hasTransactionModel()) {
    try {
      const rows = await prisma.creditTransaction.findMany({
        where: { walletId },
        orderBy: { createdAt: "desc" },
        take,
      });
      return rows.map(mapTransaction);
    } catch (err) {
      console.error("CREDIT LEDGER LIST PRISMA SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "CreditTransaction"
     WHERE "walletId" = $1
     ORDER BY "createdAt" DESC
     LIMIT $2`,
    walletId,
    take
  );
  return (rows || []).map(mapTransaction);
}

async function appendTransaction({
  tenantId,
  amount,
  type,
  title,
  note,
  referenceType,
  referenceId,
  createdByUserId,
  metadata,
}) {
  const n = Math.trunc(Number(amount));
  if (!Number.isFinite(n) || n === 0) {
    throw new Error("CREDIT_AMOUNT_INVALID");
  }
  const wallet = await getOrCreateWallet(tenantId);
  if (!wallet) throw new Error("CREDIT_WALLET_MISSING");
  const row = {
    id: newId(),
    amount: n,
    type: type || "ADJUSTMENT",
    title: typeTitle(type, title),
    note: note || null,
    referenceType: referenceType || null,
    referenceId: referenceId || null,
    createdByUserId: createdByUserId || null,
    metadata:
      metadata == null
        ? null
        : typeof metadata === "string"
          ? metadata
          : JSON.stringify(metadata),
    createdAt: new Date(),
    walletId: wallet.id,
  };

  if (hasTransactionModel()) {
    try {
      return mapTransaction(
        await prisma.creditTransaction.create({
          data: {
            amount: row.amount,
            type: row.type,
            title: row.title,
            note: row.note,
            referenceType: row.referenceType,
            referenceId: row.referenceId,
            createdByUserId: row.createdByUserId,
            metadata: row.metadata,
            walletId: row.walletId,
          },
        })
      );
    } catch (err) {
      console.error("CREDIT TX PRISMA SKIP:", err.message);
    }
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "CreditTransaction"
      ("id","amount","type","title","note","referenceType","referenceId","createdByUserId","metadata","createdAt","walletId")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP,$10)`,
    row.id,
    row.amount,
    row.type,
    row.title,
    row.note,
    row.referenceType,
    row.referenceId,
    row.createdByUserId,
    row.metadata,
    row.walletId
  );
  return mapTransaction(row);
}

function formatLedgerText(balance, entries) {
  const lines = [
    "📒 کیف پول اعتباری",
    "━━━━━━━━━━━━━━━━━━",
    `موجودی: ${formatPrice(balance)}`,
    "",
    "قوانین:",
    "• اعتبار قابل برداشت نیست.",
    "• اعتبار برای خرید کالا قابل استفاده نیست.",
    "• اعتبار فقط برای خدمات مجاز پلتفرم قابل استفاده است.",
    "",
    "دفتر تراکنش‌ها",
  ];
  if (!entries.length) {
    lines.push("هنوز تراکنشی ثبت نشده است.");
    return lines.join("\n");
  }
  for (const entry of entries) {
    const when = entry.createdAt
      ? new Date(entry.createdAt).toLocaleDateString("fa-IR")
      : "";
    lines.push("");
    lines.push(formatSignedAmount(entry.amount));
    lines.push(entry.title || typeTitle(entry.type));
    if (when) lines.push(when);
  }
  return lines.join("\n");
}

async function getWalletView(tenantId, take = 20) {
  const wallet = await getOrCreateWallet(tenantId);
  if (!wallet) {
    return {
      wallet: null,
      balance: 0,
      entries: [],
      text: formatLedgerText(0, []),
    };
  }
  const [balance, entries] = await Promise.all([
    getBalance(wallet.id),
    listTransactions(wallet.id, take),
  ]);
  return {
    wallet,
    balance,
    entries,
    text: formatLedgerText(balance, entries),
  };
}

module.exports = {
  CREDIT_TYPE,
  CREDIT_TYPE_TITLE,
  ensureCreditLedger,
  getOrCreateWallet,
  getBalance,
  listTransactions,
  appendTransaction,
  getWalletView,
  formatSignedAmount,
  formatLedgerText,
};
