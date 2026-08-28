const prisma = require("../database/prisma");
const { formatPrice } = require("../utils/price");

const CREDIT_TYPE = {
  GOLDEN_REWARD: "GOLDEN_REWARD",
  PURCHASE_REWARD: "PURCHASE_REWARD",
  SERVICE_PAYMENT: "SERVICE_PAYMENT",
  CREDIT_RESERVE: "CREDIT_RESERVE",
  CREDIT_RELEASE: "CREDIT_RELEASE",
  REFUND: "REFUND",
};

const CREDIT_TYPE_TITLE = {
  GOLDEN_REWARD: "پاداش دوره طلایی",
  PURCHASE_REWARD: "پاداش خرید استاندارد",
  SERVICE_PAYMENT: "پرداخت فاکتور خدمات",
  CREDIT_RESERVE: "رزرو اعتبار فاکتور خدمات",
  CREDIT_RELEASE: "آزادسازی رزرو اعتبار",
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
      "tenantId" TEXT,
      "userId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CreditWallet_pkey" PRIMARY KEY ("id")
    )`
  );
  await execSql(
    "CREDIT WALLET TENANT NULL SKIP:",
    `ALTER TABLE "CreditWallet" ALTER COLUMN "tenantId" DROP NOT NULL`
  );
  await execSql(
    "CREDIT WALLET USER COL SKIP:",
    `ALTER TABLE "CreditWallet" ADD COLUMN IF NOT EXISTS "userId" TEXT`
  );
  await execSql(
    "CREDIT WALLET TENANT INDEX SKIP:",
    `CREATE UNIQUE INDEX IF NOT EXISTS "CreditWallet_tenantId_key" ON "CreditWallet"("tenantId")`
  );
  await execSql(
    "CREDIT WALLET USER INDEX SKIP:",
    `CREATE UNIQUE INDEX IF NOT EXISTS "CreditWallet_userId_key" ON "CreditWallet"("userId")`
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
  await execSql(
    "CREDIT TRANSACTION IDEMPOTENCY SKIP:",
    `CREATE UNIQUE INDEX IF NOT EXISTS "CreditTransaction_idempotency_key"
     ON "CreditTransaction" ("walletId", "type", "referenceType", "referenceId")
     WHERE "referenceId" IS NOT NULL`
  );
}

function mapWallet(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenantId || null,
    userId: row.userId || null,
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

async function findWalletRow({ tenantId, userId }) {
  if (hasWalletModel()) {
    try {
      if (tenantId) {
        const byTenant = await prisma.creditWallet.findUnique({
          where: { tenantId },
        });
        if (byTenant) return mapWallet(byTenant);
        return null;
      }
      if (userId) {
        const byUser = await prisma.creditWallet.findUnique({
          where: { userId },
        });
        if (byUser) return mapWallet(byUser);
      }
    } catch (err) {
      console.error("CREDIT WALLET FIND PRISMA SKIP:", err.message);
    }
  }
  if (tenantId) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM "CreditWallet" WHERE "tenantId" = $1 LIMIT 1`,
      tenantId
    );
    if (rows?.[0]) return mapWallet(rows[0]);
    return null;
  }
  if (userId) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM "CreditWallet" WHERE "userId" = $1 LIMIT 1`,
      userId
    );
    if (rows?.[0]) return mapWallet(rows[0]);
  }
  return null;
}

async function patchWallet(id, { tenantId, userId }) {
  if (!id) return;
  if (hasWalletModel()) {
    try {
      await prisma.creditWallet.update({
        where: { id },
        data: {
          ...(tenantId ? { tenantId } : {}),
          ...(userId ? { userId } : {}),
        },
      });
      return;
    } catch (err) {
      console.error("CREDIT WALLET PATCH PRISMA SKIP:", err.message);
    }
  }
  if (tenantId) {
    await prisma.$executeRawUnsafe(
      `UPDATE "CreditWallet" SET "tenantId" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $2`,
      tenantId,
      id
    );
  }
  if (userId) {
    await prisma.$executeRawUnsafe(
      `UPDATE "CreditWallet" SET "userId" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $2`,
      userId,
      id
    );
  }
}

async function getOrCreateWallet(input) {
  const tenantId =
    typeof input === "string" ? input : input?.tenantId || null;
  const userId = typeof input === "string" ? null : input?.userId || null;
  if (!tenantId && !userId) return null;
  await ensureCreditLedger();
  let wallet = await findWalletRow({ tenantId, userId });
  if (wallet) {
    if (tenantId && wallet.tenantId && wallet.tenantId !== tenantId) {
      wallet = null;
    } else if (
      tenantId &&
      userId &&
      wallet.tenantId === tenantId &&
      !wallet.userId
    ) {
      try {
        await patchWallet(wallet.id, { userId });
        wallet = { ...wallet, userId };
      } catch (err) {
        console.error("CREDIT WALLET LINK USER SKIP:", err.message);
      }
    }
    if (wallet) return wallet;
  }
  if (hasWalletModel()) {
    try {
      const created = await prisma.creditWallet.create({
        data: tenantId ? { tenantId } : { userId },
      });
      if (tenantId && userId) {
        try {
          await patchWallet(created.id, { userId });
          return mapWallet({ ...created, userId });
        } catch (err) {
          console.error("CREDIT WALLET LINK USER SKIP:", err.message);
        }
      }
      return mapWallet(created);
    } catch (err) {
      console.error("CREDIT WALLET CREATE PRISMA SKIP:", err.message);
    }
  }
  const id = newId();
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CreditWallet" ("id","tenantId","userId","createdAt","updatedAt")
       VALUES ($1,$2,$3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      id,
      tenantId,
      tenantId ? null : userId
    );
    return mapWallet({
      id,
      tenantId,
      userId: tenantId ? null : userId,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error("CREDIT WALLET INSERT SKIP:", err.message);
  }
  return findWalletRow({ tenantId, userId });
}

async function linkUserWalletToTenant(userId, tenantId) {
  return getOrCreateWallet({ userId, tenantId });
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

async function findIdempotentTx(walletId, type, referenceType, referenceId) {
  if (!walletId || !referenceId || !type) return null;
  const rows = await listByReference(walletId, referenceType, referenceId);
  return rows.find((row) => row.type === type) || null;
}

function isUniqueError(err) {
  return /unique|duplicate/i.test(String(err?.message || ""));
}

async function appendTransaction({
  tenantId,
  userId,
  amount,
  type,
  title,
  note,
  referenceType,
  referenceId,
  createdByUserId,
  metadata,
  reason,
}) {
  const n = Math.trunc(Number(amount));
  if (!Number.isFinite(n) || n === 0) {
    throw new Error("CREDIT_AMOUNT_INVALID");
  }
  const wallet = await getOrCreateWallet({ tenantId, userId });
  if (!wallet) throw new Error("CREDIT_WALLET_MISSING");
  if (referenceId) {
    const existing = await findIdempotentTx(
      wallet.id,
      type,
      referenceType,
      referenceId
    );
    if (existing) return existing;
  }
  const before = await getBalance(wallet.id);
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

  let created = null;
  if (hasTransactionModel()) {
    try {
      created = mapTransaction(
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
      if (isUniqueError(err) && referenceId) {
        const dup = await findIdempotentTx(
          wallet.id,
          row.type,
          row.referenceType,
          row.referenceId
        );
        if (dup) return dup;
      }
      console.error("CREDIT TX PRISMA SKIP:", err.message);
    }
  }

  if (!created) {
    try {
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
      created = mapTransaction(row);
    } catch (err) {
      if (isUniqueError(err) && referenceId) {
        const dup = await findIdempotentTx(
          wallet.id,
          row.type,
          row.referenceType,
          row.referenceId
        );
        if (dup) return dup;
      }
      throw err;
    }
  }

  await require("./financialAudit").logFinancial({
    actorUserId: createdByUserId || null,
    action: "CREDIT_TX",
    entityType: row.referenceType || "CreditWallet",
    entityId: row.referenceId || wallet.id,
    amount: n,
    balanceBefore: before,
    balanceAfter: before + n,
    reason: reason || row.title,
    detail: {
      walletId: wallet.id,
      type: row.type,
      txId: created.id,
    },
  });
  return created;
}

function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

async function listByReference(walletId, referenceType, referenceId) {
  if (!walletId || !referenceId) return [];
  if (hasTransactionModel()) {
    try {
      const rows = await prisma.creditTransaction.findMany({
        where: { walletId, referenceType, referenceId },
      });
      return rows.map(mapTransaction);
    } catch (err) {
      console.error("CREDIT TX REF PRISMA SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "CreditTransaction"
     WHERE "walletId" = $1 AND "referenceType" = $2 AND "referenceId" = $3`,
    walletId,
    referenceType,
    referenceId
  );
  return (rows || []).map(mapTransaction);
}

const REF_INVOICE = "ServiceInvoice";

function reserveState(rows) {
  let reserved = 0;
  let refunded = 0;
  let consumed = 0;
  for (const row of rows || []) {
    const n = Math.abs(Number(row.amount || 0));
    if (row.type === CREDIT_TYPE.CREDIT_RESERVE) reserved += n;
    if (row.type === CREDIT_TYPE.REFUND) refunded += n;
    if (row.type === CREDIT_TYPE.SERVICE_PAYMENT) consumed += n;
  }
  return {
    reserved,
    refunded,
    consumed,
    open: Math.max(0, reserved - refunded - consumed),
  };
}

async function getReserveState(walletId, invoiceId) {
  const rows = await listByReference(walletId, REF_INVOICE, invoiceId);
  return reserveState(rows);
}

async function reserveForInvoice({
  userId,
  tenantId,
  invoiceId,
  amount,
  createdByUserId,
}) {
  const n = Math.max(0, Math.trunc(Number(amount) || 0));
  if (!invoiceId || !n) return null;
  const wallet = await getOrCreateWallet({ tenantId, userId });
  if (!wallet) throw new Error("CREDIT_WALLET_MISSING");
  const state = await getReserveState(wallet.id, invoiceId);
  if (state.consumed > 0) {
    return { wallet, amount: 0, already: true, consumed: true };
  }
  if (state.open > 0) return { wallet, amount: state.open, already: true };
  if (state.refunded > 0) {
    return { wallet, amount: 0, already: true, refunded: true };
  }
  const available = await getBalance(wallet.id);
  if (available < n) throw new Error("CREDIT_INSUFFICIENT");
  const row = await appendTransaction({
    tenantId,
    userId,
    amount: -n,
    type: CREDIT_TYPE.CREDIT_RESERVE,
    title: CREDIT_TYPE_TITLE.CREDIT_RESERVE,
    referenceType: REF_INVOICE,
    referenceId: invoiceId,
    createdByUserId: createdByUserId || null,
    metadata: { invoiceId, phase: "reserved" },
    reason: "invoice_reserve",
  });
  return { wallet, amount: n, row };
}

async function consumeReserve({ userId, tenantId, invoiceId, createdByUserId }) {
  const wallet = await getOrCreateWallet({ tenantId, userId });
  if (!wallet || !invoiceId) return null;
  const state = await getReserveState(wallet.id, invoiceId);
  if (state.consumed > 0) return { already: true, amount: state.consumed };
  if (state.open <= 0) return null;
  const release = await appendTransaction({
    tenantId,
    userId,
    amount: state.open,
    type: CREDIT_TYPE.CREDIT_RELEASE,
    title: CREDIT_TYPE_TITLE.CREDIT_RELEASE,
    referenceType: REF_INVOICE,
    referenceId: invoiceId,
    createdByUserId: createdByUserId || null,
    metadata: { invoiceId, phase: "released" },
    reason: "invoice_consume_release",
  });
  const payment = await appendTransaction({
    tenantId,
    userId,
    amount: -state.open,
    type: CREDIT_TYPE.SERVICE_PAYMENT,
    title: CREDIT_TYPE_TITLE.SERVICE_PAYMENT,
    referenceType: REF_INVOICE,
    referenceId: invoiceId,
    createdByUserId: createdByUserId || null,
    metadata: { invoiceId, phase: "consumed" },
    reason: "invoice_consume",
  });
  return { release, payment, amount: state.open };
}

async function refundReserve({ userId, tenantId, invoiceId, createdByUserId, note }) {
  const wallet = await getOrCreateWallet({ tenantId, userId });
  if (!wallet || !invoiceId) return null;
  const state = await getReserveState(wallet.id, invoiceId);
  if (state.open <= 0) return null;
  return appendTransaction({
    tenantId,
    userId,
    amount: state.open,
    type: CREDIT_TYPE.REFUND,
    title: CREDIT_TYPE_TITLE.REFUND,
    note: note || null,
    referenceType: REF_INVOICE,
    referenceId: invoiceId,
    createdByUserId: createdByUserId || null,
    metadata: { invoiceId, phase: "refunded" },
    reason: note || "invoice_rejected",
  });
}

async function usedGoldenBase(walletId, excludeOrderId) {
  const rows = await listTransactions(walletId, 500);
  let used = 0;
  for (const row of rows) {
    if (row.type !== CREDIT_TYPE.GOLDEN_REWARD) continue;
    const meta = parseMetadata(row.metadata);
    if (
      excludeOrderId &&
      (row.referenceId === excludeOrderId || meta.orderId === excludeOrderId)
    ) {
      continue;
    }
    const base = Number(meta.goldenBase);
    if (Number.isFinite(base) && base > 0) {
      used += base;
      continue;
    }
    used += Math.floor(Number(row.amount || 0) / 5);
  }
  return used;
}

function formatWalletHome(balance) {
  return [
    "📒 کیف پول اعتباری",
    "━━━━━━━━━━━━━━━━━━",
    `موجودی: ${formatPrice(balance)}`,
    "",
    "اعتبار این کیف پول فقط برای استفاده از خدمات مجاز پلتفرم قابل استفاده میباشد.",
  ].join("\n");
}

function formatLedgerList(entries) {
  const rows = (entries || []).slice(0, 20);
  const lines = ["📋 دفتر تراکنش‌ها", "۲۰ تراکنش آخر", "━━━━━━━━━━━━━━━━━━"];
  if (!rows.length) {
    lines.push("", "هنوز تراکنشی ثبت نشده است.");
    return lines.join("\n");
  }
  for (const entry of rows) {
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

function formatLedgerText(balance, entries) {
  return `${formatWalletHome(balance)}\n\n${formatLedgerList(entries)}`;
}

async function loadWalletState(input, take = 20) {
  const wallet = await getOrCreateWallet(input);
  if (!wallet) {
    return { wallet: null, balance: 0, entries: [] };
  }
  const [balance, entries] = await Promise.all([
    getBalance(wallet.id),
    listTransactions(wallet.id, take),
  ]);
  return { wallet, balance, entries };
}

async function getWalletHome(input) {
  const state = await loadWalletState(input, 1);
  return {
    ...state,
    text: formatWalletHome(state.balance),
  };
}

async function getWalletView(input, take = 20) {
  const state = await loadWalletState(input, Math.min(20, take || 20));
  return {
    ...state,
    text: formatLedgerList(state.entries),
  };
}

module.exports = {
  CREDIT_TYPE,
  CREDIT_TYPE_TITLE,
  ensureCreditLedger,
  getOrCreateWallet,
  linkUserWalletToTenant,
  getBalance,
  listTransactions,
  listByReference,
  usedGoldenBase,
  parseMetadata,
  appendTransaction,
  reserveForInvoice,
  consumeReserve,
  refundReserve,
  getReserveState,
  getWalletHome,
  getWalletView,
  formatSignedAmount,
  formatLedgerText,
  formatWalletHome,
  formatLedgerList,
};
