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

function mapInvoice(row, items = []) {
  if (!row) return null;
  return {
    id: row.id,
    trackingCode: row.trackingCode,
    kind: row.kind,
    status: row.status,
    onceAmount: Number(row.onceAmount || 0),
    monthlyAmount: Number(row.monthlyAmount || 0),
    totalAmount: Number(row.totalAmount || 0),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    userId: row.userId,
    tenantId: row.tenantId,
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

async function lastPeriodEnd(tenantId) {
  if (!tenantId) return null;
  await ensureServiceInvoices();
  if (hasInvoiceModel()) {
    try {
      const row = await prisma.serviceInvoice.findFirst({
        where: { tenantId, periodEnd: { not: null } },
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
     WHERE "tenantId" = $1 AND "periodEnd" IS NOT NULL
     ORDER BY "periodEnd" DESC LIMIT 1`,
    tenantId
  );
  return rows?.[0]?.periodEnd || null;
}

function buildQuote(packs, invoiceKind) {
  const items = (packs || []).map((pack) => ({
    packageId: pack.id,
    code: pack.code,
    title: snapshotTitle(pack, invoiceKind),
    description: pack.description || null,
    unitPrice: Number(pack.priceToman),
    kind: pack.kind,
    billing: pack.billing,
    quantity: 1,
  }));
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

function formatInvoiceText(invoice) {
  const isInitial = invoice.kind === "INITIAL";
  const title = isInitial ? "🧾 فاکتور راه‌اندازی" : "🧾 فاکتور اشتراک ماهانه";
  const lines = [title, `🔖 ${invoice.trackingCode}`, "━━━━━━━━━━━━━━━━━━", ""];
  for (const item of invoice.items || []) {
    lines.push(`${item.title}`);
    lines.push(`${formatPrice(item.unitPrice)}`);
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
    const start = new Date(invoice.periodStart).toLocaleDateString("fa-IR");
    const end = new Date(invoice.periodEnd).toLocaleDateString("fa-IR");
    lines.push(`دوره: ${start} تا ${end}`);
  }
  lines.push(`وضعیت: در انتظار پرداخت`);
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

async function createInvoice({ userId, tenantId, kind, packs }) {
  await ensureServiceInvoices();
  const invoiceKind = kind === "RENEWAL" ? "RENEWAL" : "INITIAL";
  const quote = buildQuote(packs, invoiceKind);
  if (!quote.items.length) {
    throw new Error("EMPTY_INVOICE");
  }
  const now = new Date();
  let periodStart = now;
  if (invoiceKind === "RENEWAL") {
    const prevEnd = await lastPeriodEnd(tenantId);
    if (prevEnd && new Date(prevEnd) > now) periodStart = new Date(prevEnd);
  }
  const periodEnd = addOneMonth(periodStart);

  for (let i = 0; i < 4; i++) {
    const trackingCode = generateServiceInvoiceCode();
    const id = newId();
    if (hasInvoiceModel()) {
      try {
        return await prisma.serviceInvoice.create({
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
      } catch (err) {
        console.error("SERVICE INVOICE CREATE PRISMA SKIP:", err.message);
      }
    }
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ServiceInvoice"
          ("id","trackingCode","kind","status","onceAmount","monthlyAmount","totalAmount","periodStart","periodEnd","userId","tenantId","createdAt","updatedAt")
         VALUES ($1,$2,$3,'WAITING_PAYMENT',$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        id,
        trackingCode,
        invoiceKind,
        quote.onceAmount,
        quote.monthlyAmount,
        quote.totalAmount,
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
  buildQuote,
  formatInvoiceText,
  formatQuoteText,
  createInvoice,
  listInvoices,
};
