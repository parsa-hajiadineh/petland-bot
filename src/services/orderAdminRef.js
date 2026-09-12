const { Prisma } = require("@prisma/client");
const prisma = require("../database/prisma");

const MAX_REF_LEN = 80;

let ensurePromise = null;

async function ensureOrderAdminRef() {
  if (!ensurePromise) {
    ensurePromise = prisma
      .$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "OrderAdminRef" (
          "orderId" TEXT NOT NULL,
          "refNo" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "OrderAdminRef_pkey" PRIMARY KEY ("orderId")
        )`
      )
      .catch((err) => {
        ensurePromise = null;
        console.error("ORDER ADMIN REF TABLE SKIP:", err.message);
      });
  }
  return ensurePromise;
}

function normalizeRef(text) {
  const ref = String(text || "").trim().replace(/\s+/g, " ");
  if (!ref || ref.length > MAX_REF_LEN) return null;
  return ref;
}

function refLabelSuffix(order) {
  return order?.adminRefNo ? ` | 🏷️ ${order.adminRefNo}` : "";
}

function adminRefLine(order) {
  return order?.adminRefNo ? `🏷️ شماره مرجع: ${order.adminRefNo}` : "";
}

async function setAdminRef(orderId, refNo) {
  const ref = normalizeRef(refNo);
  if (!orderId || !ref) return null;
  await ensureOrderAdminRef();
  await prisma.$executeRaw`
    INSERT INTO "OrderAdminRef" ("orderId", "refNo", "createdAt", "updatedAt")
    VALUES (${orderId}, ${ref}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("orderId") DO UPDATE SET
      "refNo" = ${ref},
      "updatedAt" = CURRENT_TIMESTAMP
  `;
  return ref;
}

async function getAdminRef(orderId) {
  if (!orderId) return null;
  try {
    await ensureOrderAdminRef();
    const rows = await prisma.$queryRaw`
      SELECT "refNo" FROM "OrderAdminRef" WHERE "orderId" = ${orderId}
    `;
    return rows?.[0]?.refNo || null;
  } catch (err) {
    console.error("ORDER ADMIN REF READ SKIP:", err.message);
    return null;
  }
}

async function getAdminRefs(orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  const map = {};
  if (!ids.length) return map;
  try {
    await ensureOrderAdminRef();
    const rows = await prisma.$queryRaw`
      SELECT "orderId", "refNo"
      FROM "OrderAdminRef"
      WHERE "orderId" IN (${Prisma.join(ids)})
    `;
    for (const row of rows || []) {
      if (row?.orderId && row.refNo) map[row.orderId] = row.refNo;
    }
  } catch (err) {
    console.error("ORDER ADMIN REF LIST SKIP:", err.message);
  }
  return map;
}

async function attachAdminRef(order) {
  if (!order?.id) return order;
  if (order.adminRefNo) return order;
  const adminRefNo = await getAdminRef(order.id);
  return { ...order, adminRefNo };
}

async function attachAdminRefs(orders) {
  if (!orders?.length) return orders;
  const map = await getAdminRefs(orders.map((order) => order.id));
  return orders.map((order) => ({
    ...order,
    adminRefNo: order.adminRefNo || map[order.id] || null,
  }));
}

module.exports = {
  MAX_REF_LEN,
  ensureOrderAdminRef,
  normalizeRef,
  refLabelSuffix,
  adminRefLine,
  setAdminRef,
  getAdminRef,
  getAdminRefs,
  attachAdminRef,
  attachAdminRefs,
};
