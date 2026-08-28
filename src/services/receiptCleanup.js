const prisma = require("../database/prisma");

const ORDER_DAYS = 30;
const SERVICE_DAYS = 45;

async function purgeExpiredReceipts() {
  let orders = 0;
  let services = 0;
  try {
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "Order"
       SET "receiptImage" = NULL
       WHERE "receiptImage" IS NOT NULL
         AND "receiptImage" <> ''
         AND (
           EXISTS (
             SELECT 1 FROM "OrderReceipt" r
             WHERE r."orderId" = "Order"."id"
               AND r."uploadedAt" < CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 day')
           )
           OR (
             NOT EXISTS (
               SELECT 1 FROM "OrderReceipt" r WHERE r."orderId" = "Order"."id"
             )
             AND "updatedAt" < CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 day')
           )
         )`,
      ORDER_DAYS
    );
    orders = Number(result || 0);
  } catch (err) {
    console.error("RECEIPT PURGE ORDER SKIP:", err.message);
  }

  try {
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "ServiceInvoice"
       SET "receiptImage" = NULL
       WHERE "receiptImage" IS NOT NULL
         AND "receiptImage" <> ''
         AND COALESCE("receiptUploadedAt", "updatedAt") < CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 day')`,
      SERVICE_DAYS
    );
    services = Number(result || 0);
  } catch (err) {
    console.error("RECEIPT PURGE SERVICE SKIP:", err.message);
  }

  if (orders || services) {
    console.log("RECEIPT PURGE:", { orders, services });
  }
  return { orders, services };
}

module.exports = {
  ORDER_DAYS,
  SERVICE_DAYS,
  purgeExpiredReceipts,
};
