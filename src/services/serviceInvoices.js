const prisma = require("../database/prisma");
const { formatPrice } = require("../utils/price");
const { generateServiceInvoiceCode } = require("../utils/order");

function newId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function hasInvoiceModel() {
  return Boolean(prisma.serviceInvoice?.create);
}

let ensurePromise = null;

async function ensureServiceInvoices() {
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
    "SERVICE INVOICE TABLE SKIP:",
    `CREATE TABLE IF NOT EXISTS "ServiceInvoice" (
      "id" TEXT NOT NULL,
      "trackingCode" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'WAITING_PAYMENT',
      "onceAmount" INTEGER NOT NULL DEFAULT 0,
      "monthlyAmount" INTEGER NOT NULL DEFAULT 0,
      "totalAmount" INTEGER NOT NULL DEFAULT 0,
      "periodStart" TIMESTAMP(3),
      "periodEnd" TIMESTAMP(3),
      "userId" TEXT NOT NULL,
      "tenantId" TEXT,
      "receiptImage" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ServiceInvoice_pkey" PRIMARY KEY ("id")
    )`
  );
  await execSql(
    "SERVICE INVOICE CODE INDEX SKIP:",
    `CREATE UNIQUE INDEX IF NOT EXISTS "ServiceInvoice_trackingCode_key" ON "ServiceInvoice"("trackingCode")`
  );
  await execSql(
    "SERVICE INVOICE ITEM TABLE SKIP:",
    `CREATE TABLE IF NOT EXISTS "ServiceInvoiceItem" (
      "id" TEXT NOT NULL,
      "packageId" TEXT,
      "code" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "description" TEXT,
      "unitPrice" INTEGER NOT NULL,
      "kind" TEXT NOT NULL,
      "billing" TEXT NOT NULL,
      "quantity" INTEGER NOT NULL DEFAULT 1,
      "invoiceId" TEXT NOT NULL,
      CONSTRAINT "ServiceInvoiceItem_pkey" PRIMARY KEY ("id")
    )`
  );
  await execSql(
    "SERVICE INVOICE RECEIPT COL SKIP:",
    `ALTER TABLE "ServiceInvoice" ADD COLUMN IF NOT EXISTS "receiptImage" TEXT`
  );
  await execSql(
    "SERVICE INVOICE CREDIT COL SKIP:",
    `ALTER TABLE "ServiceInvoice" ADD COLUMN IF NOT EXISTS "creditAmount" INTEGER NOT NULL DEFAULT 0`
  );
  await execSql(
    "SERVICE INVOICE CASH COL SKIP:",
    `ALTER TABLE "ServiceInvoice" ADD COLUMN IF NOT EXISTS "cashAmount" INTEGER NOT NULL DEFAULT 0`
  );
  await execSql(
    "SERVICE INVOICE PAY METHOD COL SKIP:",
    `ALTER TABLE "ServiceInvoice" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT NOT NULL DEFAULT 'CASH'`
  );
  await execSql(
    "SERVICE INVOICE CASH BACKFILL SKIP:",
    `UPDATE "ServiceInvoice"
     SET "cashAmount" = "totalAmount"
     WHERE COALESCE("creditAmount", 0) = 0
       AND COALESCE("cashAmount", 0) = 0`
  );
}

function addOneMonth(date) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);
  return next;
}

function snapshotTitle(pack, invoiceKind) {
  if (invoiceKind === "INITIAL" && pack.billing === "MONTHLY") {
    return String(pack.title || "").replace("ماهانه", "ماه اول");
  }
  return pack.title;
}

function resolveCashAmount(row) {
  const total = Number(row.totalAmount || 0);
  const credit = Number(row.creditAmount || 0);
  const method = row.paymentMethod || (credit ? "MIXED" : "CASH");
  if (method === "CREDIT") return 0;
  if (row.cashAmount != null && Number(row.cashAmount) > 0) {
    return Number(row.cashAmount);
  }
  return Math.max(0, total - credit);
}

function mapInvoice(row, items = []) {
  if (!row) return null;
  const creditAmount = Number(row.creditAmount || 0);
  return {
    id: row.id,
    trackingCode: row.trackingCode,
    kind: row.kind,
    status: row.status,
    onceAmount: Number(row.onceAmount || 0),
    monthlyAmount: Number(row.monthlyAmount || 0),
    totalAmount: Number(row.totalAmount || 0),
    creditAmount,
    cashAmount: resolveCashAmount(row),
    paymentMethod: row.paymentMethod || (creditAmount ? "MIXED" : "CASH"),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    userId: row.userId,
    tenantId: row.tenantId,
    receiptImage: row.receiptImage || null,
    createdAt: row.createdAt,
    items,
  };
}

function mapItem(row) {
  return {
    id: row.id,
    packageId: row.packageId,
    code: row.code,
    title: row.title,
    description: row.description,
    unitPrice: Number(row.unitPrice),
    kind: row.kind,
    billing: row.billing,
    quantity: Number(row.quantity || 1),
  };
}

async function hasApprovedInitialInvoice(tenantId) {
  if (!tenantId) return false;
  await ensureServiceInvoices();
  if (hasInvoiceModel()) {
    try {
      const row = await prisma.serviceInvoice.findFirst({
        where: { tenantId, kind: "INITIAL", status: "APPROVED" },
        select: { id: true },
      });
      return Boolean(row);
    } catch (err) {
      console.error("SERVICE INVOICE APPROVED INITIAL SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "ServiceInvoice"
     WHERE "tenantId" = $1 AND "kind" = 'INITIAL' AND "status" = 'APPROVED'
     LIMIT 1`,
    tenantId
  );
  return Boolean(rows?.[0]);
}

async function getInitialInvoice(tenantId) {
  if (!tenantId) return null;
  await ensureServiceInvoices();
  if (hasInvoiceModel()) {
    try {
      return await prisma.serviceInvoice.findFirst({
        where: { tenantId, kind: "INITIAL" },
        orderBy: { createdAt: "desc" },
        include: { items: true },
      });
    } catch (err) {
      console.error("SERVICE INVOICE INITIAL SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "ServiceInvoice" WHERE "tenantId" = $1 AND "kind" = 'INITIAL' ORDER BY "createdAt" DESC LIMIT 1`,
    tenantId
  );
  if (!rows?.[0]) return null;
  const items = await prisma.$queryRawUnsafe(
    `SELECT * FROM "ServiceInvoiceItem" WHERE "invoiceId" = $1`,
    rows[0].id
  );
  return mapInvoice(rows[0], (items || []).map(mapItem));
}

async function getInvoice(id) {
  if (!id) return null;
  await ensureServiceInvoices();
  if (hasInvoiceModel()) {
    try {
      return await prisma.serviceInvoice.findUnique({
        where: { id },
        include: { items: true },
      });
    } catch (err) {
      console.error("SERVICE INVOICE GET SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "ServiceInvoice" WHERE "id" = $1 LIMIT 1`,
    id
  );
  if (!rows?.[0]) return null;
  const items = await prisma.$queryRawUnsafe(
    `SELECT * FROM "ServiceInvoiceItem" WHERE "invoiceId" = $1`,
    id
  );
  return mapInvoice(rows[0], (items || []).map(mapItem));
}

async function listPendingInvoices(take = 20) {
  await ensureServiceInvoices();
  if (hasInvoiceModel()) {
    try {
      return await prisma.serviceInvoice.findMany({
        where: { status: "WAITING_APPROVAL" },
        orderBy: { createdAt: "desc" },
        take,
        include: { items: true },
      });
    } catch (err) {
      console.error("SERVICE INVOICE PENDING SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "ServiceInvoice" WHERE "status" = 'WAITING_APPROVAL' ORDER BY "createdAt" DESC LIMIT $1`,
    take
  );
  const invoices = [];
  for (const row of rows || []) {
    const items = await prisma.$queryRawUnsafe(
      `SELECT * FROM "ServiceInvoiceItem" WHERE "invoiceId" = $1`,
      row.id
    );
    invoices.push(mapInvoice(row, (items || []).map(mapItem)));
  }
  return invoices;
}

async function settleCredit(invoice, action) {
  if (!invoice?.id || !Number(invoice.creditAmount || 0)) return;
  try {
    const creditLedger = require("./creditLedger");
    const payload = {
      userId: invoice.userId,
      tenantId: invoice.tenantId,
      invoiceId: invoice.id,
    };
    if (action === "consume") await creditLedger.consumeReserve(payload);
    else await creditLedger.refundReserve(payload);
  } catch (err) {
    console.error("SERVICE INVOICE CREDIT SETTLE SKIP:", err.message);
  }
}

async function rejectInvoice(id) {
  await ensureServiceInvoices();
  const current = await getInvoice(id);
  if (!current || current.status === "APPROVED" || current.status === "REJECTED") {
    return null;
  }
  let invoice = null;
  if (hasInvoiceModel()) {
    try {
      invoice = await prisma.serviceInvoice.update({
        where: { id },
        data: { status: "REJECTED" },
        include: { items: true },
      });
    } catch (err) {
      console.error("SERVICE INVOICE REJECT PRISMA SKIP:", err.message);
    }
  }
  if (!invoice) {
    await prisma.$executeRawUnsafe(
      `UPDATE "ServiceInvoice" SET "status" = 'REJECTED', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
      id
    );
  }
  invoice = await getInvoice(id);
  await settleCredit(invoice, "refund");
  return invoice;
}

async function approveInvoice(id) {
  await ensureServiceInvoices();
  const current = await getInvoice(id);
  if (!current || current.status === "APPROVED" || current.status === "REJECTED") {
    return null;
  }
  let invoice = null;
  if (hasInvoiceModel()) {
    try {
      invoice = await prisma.serviceInvoice.update({
        where: { id },
        data: { status: "APPROVED" },
        include: { items: true },
      });
    } catch (err) {
      console.error("SERVICE INVOICE APPROVE PRISMA SKIP:", err.message);
    }
  }
  if (!invoice) {
    await prisma.$executeRawUnsafe(
      `UPDATE "ServiceInvoice" SET "status" = 'APPROVED', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
      id
    );
  }
  invoice = await getInvoice(id);
  await settleCredit(invoice, "consume");
  return invoice;
}

async function markWaitingApproval(id, receiptImage) {
  await ensureServiceInvoices();
  if (hasInvoiceModel()) {
    try {
      return await prisma.serviceInvoice.update({
        where: { id },
        data: { status: "WAITING_APPROVAL", receiptImage: receiptImage || null },
        include: { items: true },
      });
    } catch (err) {
      console.error("SERVICE INVOICE RECEIPT PRISMA SKIP:", err.message);
    }
  }
  await prisma.$executeRawUnsafe(
    `UPDATE "ServiceInvoice"
     SET "status" = 'WAITING_APPROVAL', "receiptImage" = $2, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1`,
    id,
    receiptImage || null
  );
  return getInvoice(id);
}

async function hasInitialInvoice(tenantId) {
  if (!tenantId) return false;
  await ensureServiceInvoices();
  if (hasInvoiceModel()) {
    try {
      const row = await prisma.serviceInvoice.findFirst({
        where: { tenantId, kind: "INITIAL" },
        select: { id: true },
      });
      return Boolean(row);
    } catch (err) {
      console.error("SERVICE INVOICE INITIAL SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "ServiceInvoice" WHERE "tenantId" = $1 AND "kind" = 'INITIAL' LIMIT 1`,
    tenantId
  );
  return Boolean(rows?.[0]);
}

async function getLatestInvoice(tenantId) {
  if (!tenantId) return null;
  await ensureServiceInvoices();
  if (hasInvoiceModel()) {
    try {
      return await prisma.serviceInvoice.findFirst({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        include: { items: true },
      });
    } catch (err) {
      console.error("SERVICE INVOICE LATEST SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "ServiceInvoice" WHERE "tenantId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
    tenantId
  );
  if (!rows?.[0]) return null;
  const items = await prisma.$queryRawUnsafe(
    `SELECT * FROM "ServiceInvoiceItem" WHERE "invoiceId" = $1`,
    rows[0].id
  );
  return mapInvoice(rows[0], (items || []).map(mapItem));
}

function isOpenInvoiceStatus(status) {
  return status === "WAITING_PAYMENT" || status === "WAITING_APPROVAL";
}

async function getOpenInvoice(tenantId) {
  const latest = await getLatestInvoice(tenantId);
  if (!latest || !isOpenInvoiceStatus(latest.status)) return null;
  return latest;
}

async function lastPeriodEnd(tenantId) {
  if (!tenantId) return null;
  await ensureServiceInvoices();
  if (hasInvoiceModel()) {
    try {
      const row = await prisma.serviceInvoice.findFirst({
        where: { tenantId, status: "APPROVED", periodEnd: { not: null } },
        orderBy: { periodEnd: "desc" },
        select: { periodEnd: true },
      });
      return row?.periodEnd || null;
    } catch (err) {
      console.error("SERVICE INVOICE PERIOD SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "periodEnd" FROM "ServiceInvoice"
     WHERE "tenantId" = $1 AND "status" = 'APPROVED' AND "periodEnd" IS NOT NULL
     ORDER BY "periodEnd" DESC LIMIT 1`,
    tenantId
  );
  return rows?.[0]?.periodEnd || null;
}

async function resolveInvoicePeriod(tenantId, invoiceKind) {
  const latest = await getLatestInvoice(tenantId);
  if (latest?.status === "REJECTED" && latest.periodStart && latest.periodEnd) {
    return {
      periodStart: new Date(latest.periodStart),
      periodEnd: new Date(latest.periodEnd),
    };
  }
  const now = new Date();
  let periodStart = now;
  if (invoiceKind === "RENEWAL") {
    const prevEnd = await lastPeriodEnd(tenantId);
    if (prevEnd && new Date(prevEnd) > now) periodStart = new Date(prevEnd);
  }
  return { periodStart, periodEnd: addOneMonth(periodStart) };
}

function splitPayment(totalAmount, availableCredit, useCredit) {
  const total = Math.max(0, Math.trunc(Number(totalAmount) || 0));
  const available = Math.max(0, Math.trunc(Number(availableCredit) || 0));
  const creditAmount = useCredit ? Math.min(total, available) : 0;
  const cashAmount = Math.max(0, total - creditAmount);
  let paymentMethod = "CASH";
  if (creditAmount > 0 && cashAmount > 0) paymentMethod = "MIXED";
  else if (creditAmount > 0) paymentMethod = "CREDIT";
  return { totalAmount: total, creditAmount, cashAmount, paymentMethod };
}

function paymentMethodLabel(method) {
  if (method === "CREDIT") return "تماماً اعتباری";
  if (method === "MIXED") return "ترکیبی";
  return "تماماً نقدی";
}

function buildQuote(packs, invoiceKind) {
  const seen = new Set();
  const items = [];
  for (const pack of packs || []) {
    if (!pack?.id || seen.has(pack.id)) continue;
    seen.add(pack.id);
    items.push({
      packageId: pack.id,
      code: pack.code,
      title: snapshotTitle(pack, invoiceKind),
      description: pack.description || null,
      unitPrice: Number(pack.priceToman),
      kind: pack.kind,
      billing: pack.billing,
      quantity: 1,
    });
  }
  const onceAmount = items
    .filter((item) => item.billing === "ONCE")
    .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const monthlyAmount = items
    .filter((item) => item.billing === "MONTHLY")
    .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  return {
    items,
    onceAmount,
    monthlyAmount,
    totalAmount: onceAmount + monthlyAmount,
  };
}

function invoiceStatusLabel(status) {
  if (status === "APPROVED") return "تایید شده";
  if (status === "REJECTED") return "رد شده";
  if (status === "WAITING_APPROVAL") return "در انتظار تایید پرداخت";
  return "در انتظار پرداخت";
}

function formatFaDotDate(value) {
  if (!value) return "—";
  return new Date(value)
    .toLocaleDateString("fa-IR")
    .replace(/‏/g, "")
    .replace(/[\/\-]/g, ".");
}

function formatPeriodButton(invoice) {
  return `اشتراک ${formatFaDotDate(invoice.periodStart)} الی ${formatFaDotDate(
    invoice.periodEnd
  )}`;
}

function formatInvoiceText(invoice) {
  const isInitial = invoice.kind === "INITIAL";
  const title = isInitial ? "🧾 فاکتور راه‌اندازی" : "🧾 فاکتور اشتراک ماهانه";
  const created = invoice.createdAt
    ? new Date(invoice.createdAt).toLocaleDateString("fa-IR")
    : "—";
  const lines = [
    title,
    `🔖 ${invoice.trackingCode}`,
    `📅 تاریخ ثبت: ${created}`,
    "━━━━━━━━━━━━━━━━━━",
    "",
    "پکیج‌ها و خدمات (قیمت قفل‌شده):",
    "",
  ];
  for (const item of invoice.items || []) {
    const qty = Number(item.quantity || 1);
    lines.push(`• ${item.title}`);
    if (qty > 1) lines.push(`  تعداد: ${qty}`);
    lines.push(`  ${formatPrice(item.unitPrice)}`);
    lines.push("");
  }
  lines.push("────────────────────────────");
  if (isInitial) {
    if (invoice.onceAmount) {
      lines.push(`اقلام یک‌بار: ${formatPrice(invoice.onceAmount)}`);
    }
    if (invoice.monthlyAmount) {
      lines.push(`ماه اول خدمات دوره‌ای: ${formatPrice(invoice.monthlyAmount)}`);
    }
    lines.push(`پرداخت اولیه: ${formatPrice(invoice.totalAmount)}`);
  } else {
    lines.push(`ماهانه: ${formatPrice(invoice.totalAmount)}`);
  }
  if (invoice.periodStart && invoice.periodEnd) {
    lines.push(
      `دوره اشتراک: ${formatFaDotDate(invoice.periodStart)} الی ${formatFaDotDate(
        invoice.periodEnd
      )}`
    );
  }
  const creditAmount = Number(invoice.creditAmount || 0);
  const cashAmount = Number(
    invoice.cashAmount != null ? invoice.cashAmount : invoice.totalAmount || 0
  );
  if (creditAmount > 0 || invoice.paymentMethod) {
    lines.push(`روش پرداخت: ${paymentMethodLabel(invoice.paymentMethod)}`);
    if (creditAmount > 0) {
      lines.push(`پرداخت اعتباری: ${formatPrice(creditAmount)}`);
    }
    lines.push(`قابل پرداخت نقدی: ${formatPrice(cashAmount)}`);
  }
  lines.push(`وضعیت: ${invoiceStatusLabel(invoice.status)}`);
  return lines.join("\n");
}

function formatQuoteText(quote, invoiceKind) {
  const draft = {
    trackingCode: "پیش‌نمایش",
    kind: invoiceKind,
    ...quote,
    status: "WAITING_PAYMENT",
  };
  return formatInvoiceText(draft).replace("🔖 پیش‌نمایش", "پیش‌نمایش — هنوز صادر نشده");
}

async function patchPaymentSplit(id, creditAmount, cashAmount, paymentMethod) {
  if (!id) return;
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "ServiceInvoice"
       SET "creditAmount" = $2, "cashAmount" = $3, "paymentMethod" = $4, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1`,
      id,
      creditAmount,
      cashAmount,
      paymentMethod
    );
  } catch (err) {
    console.error("SERVICE INVOICE PAY SPLIT SKIP:", err.message);
  }
}

async function createInvoice({ userId, tenantId, kind, packs, creditAmount = 0 }) {
  await ensureServiceInvoices();
  const invoiceKind = kind === "RENEWAL" ? "RENEWAL" : "INITIAL";
  const quote = buildQuote(packs, invoiceKind);
  if (!quote.items.length) {
    throw new Error("EMPTY_INVOICE");
  }
  const open = await getOpenInvoice(tenantId);
  if (open) {
    const err = new Error("OPEN_INVOICE");
    err.invoice = open;
    throw err;
  }
  const { periodStart, periodEnd } = await resolveInvoicePeriod(
    tenantId,
    invoiceKind
  );
  const split = splitPayment(quote.totalAmount, creditAmount, true);
  const payCredit = split.creditAmount;
  const payCash = split.cashAmount;
  const paymentMethod = split.paymentMethod;

  for (let i = 0; i < 4; i++) {
    const trackingCode = generateServiceInvoiceCode();
    const id = newId();
    if (hasInvoiceModel()) {
      try {
        const created = await prisma.serviceInvoice.create({
          data: {
            trackingCode,
            kind: invoiceKind,
            status: "WAITING_PAYMENT",
            onceAmount: quote.onceAmount,
            monthlyAmount: quote.monthlyAmount,
            totalAmount: quote.totalAmount,
            periodStart,
            periodEnd,
            userId,
            tenantId: tenantId || null,
            items: {
              create: quote.items.map((item) => ({
                packageId: item.packageId,
                code: item.code,
                title: item.title,
                description: item.description,
                unitPrice: item.unitPrice,
                kind: item.kind,
                billing: item.billing,
                quantity: item.quantity,
              })),
            },
          },
          include: { items: true },
        });
        await patchPaymentSplit(created.id, payCredit, payCash, paymentMethod);
        return mapInvoice(
          { ...created, creditAmount: payCredit, cashAmount: payCash, paymentMethod },
          created.items
        );
      } catch (err) {
        console.error("SERVICE INVOICE CREATE PRISMA SKIP:", err.message);
      }
    }
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ServiceInvoice"
          ("id","trackingCode","kind","status","onceAmount","monthlyAmount","totalAmount","creditAmount","cashAmount","paymentMethod","periodStart","periodEnd","userId","tenantId","createdAt","updatedAt")
         VALUES ($1,$2,$3,'WAITING_PAYMENT',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        id,
        trackingCode,
        invoiceKind,
        quote.onceAmount,
        quote.monthlyAmount,
        quote.totalAmount,
        payCredit,
        payCash,
        paymentMethod,
        periodStart,
        periodEnd,
        userId,
        tenantId || null
      );
      for (const item of quote.items) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "ServiceInvoiceItem"
            ("id","packageId","code","title","description","unitPrice","kind","billing","quantity","invoiceId")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          newId(),
          item.packageId,
          item.code,
          item.title,
          item.description,
          item.unitPrice,
          item.kind,
          item.billing,
          item.quantity,
          id
        );
      }
      return mapInvoice(
        {
          id,
          trackingCode,
          kind: invoiceKind,
          status: "WAITING_PAYMENT",
          onceAmount: quote.onceAmount,
          monthlyAmount: quote.monthlyAmount,
          totalAmount: quote.totalAmount,
          creditAmount: payCredit,
          cashAmount: payCash,
          paymentMethod,
          periodStart,
          periodEnd,
          userId,
          tenantId,
        },
        quote.items
      );
    } catch (err) {
      console.error("SERVICE INVOICE CREATE SKIP:", err.message);
    }
  }
  throw new Error("INVOICE_CREATE_FAILED");
}

async function listInvoices(tenantId, take = 10) {
  await ensureServiceInvoices();
  if (!tenantId) return [];
  if (hasInvoiceModel()) {
    try {
      return await prisma.serviceInvoice.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take,
        include: { items: true },
      });
    } catch (err) {
      console.error("SERVICE INVOICE LIST SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "ServiceInvoice" WHERE "tenantId" = $1 ORDER BY "createdAt" DESC LIMIT $2`,
    tenantId,
    take
  );
  const invoices = [];
  for (const row of rows || []) {
    const items = await prisma.$queryRawUnsafe(
      `SELECT * FROM "ServiceInvoiceItem" WHERE "invoiceId" = $1`,
      row.id
    );
    invoices.push(mapInvoice(row, (items || []).map(mapItem)));
  }
  return invoices;
}

module.exports = {
  ensureServiceInvoices,
  hasInitialInvoice,
  hasApprovedInitialInvoice,
  getInitialInvoice,
  getInvoice,
  getLatestInvoice,
  getOpenInvoice,
  listPendingInvoices,
  approveInvoice,
  rejectInvoice,
  markWaitingApproval,
  invoiceStatusLabel,
  formatPeriodButton,
  buildQuote,
  formatInvoiceText,
  formatQuoteText,
  createInvoice,
  listInvoices,
  splitPayment,
  paymentMethodLabel,
};
