const prisma = require("../database/prisma");
const bale = require("../bot/bale");
const { decryptToken } = require("../utils/tokenCrypto");

let ensurePromise = null;

async function execSql(label, sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (err) {
    console.error(label, err.message);
  }
}

async function ensureBlockColumns() {
  if (!ensurePromise) {
    ensurePromise = Promise.all([
      execSql(
        "TENANT BLOCK COL SKIP:",
        `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "statusBeforeBlock" TEXT`
      ),
      execSql(
        "BOT BLOCK STATUS COL SKIP:",
        `ALTER TABLE "Bot" ADD COLUMN IF NOT EXISTS "statusBeforeBlock" TEXT`
      ),
      execSql(
        "BOT BLOCK ENABLED COL SKIP:",
        `ALTER TABLE "Bot" ADD COLUMN IF NOT EXISTS "isEnabledBeforeBlock" BOOLEAN`
      ),
    ]).catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

async function loadShop(tenantId) {
  if (!tenantId) return null;
  try {
    return await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { bot: true, settings: true, ownerUser: true },
    });
  } catch (err) {
    console.error("SHOP BLOCK LOAD SKIP:", err.message);
  }
  const tenants = await prisma.$queryRawUnsafe(
    `SELECT * FROM "Tenant" WHERE "id" = $1 LIMIT 1`,
    tenantId
  );
  const tenant = tenants?.[0];
  if (!tenant) return null;
  const bots = await prisma.$queryRawUnsafe(
    `SELECT * FROM "Bot" WHERE "tenantId" = $1 LIMIT 1`,
    tenantId
  );
  return { ...tenant, bot: bots?.[0] || null };
}

async function silenceBot(bot) {
  if (!bot?.token) return;
  try {
    const token = decryptToken(bot.token);
    await bale.deleteWebhook(token);
  } catch (err) {
    console.error("SHOP BLOCK WEBHOOK SKIP:", err.message);
  }
}

async function blockShop(tenantId) {
  await ensureBlockColumns();
  const shop = await loadShop(tenantId);
  if (!shop) return null;
  await prisma.$executeRawUnsafe(
    `UPDATE "Tenant"
     SET "statusBeforeBlock" = CASE
           WHEN "status" = 'SUSPENDED' THEN "statusBeforeBlock"
           ELSE "status"::text
         END,
         "status" = 'SUSPENDED',
         "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1`,
    tenantId
  );
  if (shop.bot?.id) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Bot"
       SET "statusBeforeBlock" = CASE
             WHEN "status" = 'DISABLED' AND "isEnabled" = false THEN "statusBeforeBlock"
             ELSE "status"::text
           END,
           "isEnabledBeforeBlock" = CASE
             WHEN "status" = 'DISABLED' AND "isEnabled" = false THEN "isEnabledBeforeBlock"
             ELSE "isEnabled"
           END,
           "status" = 'DISABLED',
           "isEnabled" = false,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1`,
      shop.bot.id
    );
    await silenceBot(shop.bot);
  }
  try {
    await require("../bot/engine").syncTenantBots();
  } catch (err) {
    console.error("SHOP BLOCK SYNC SKIP:", err.message);
  }
  return loadShop(tenantId);
}

async function unblockShop(tenantId) {
  await ensureBlockColumns();
  const shop = await loadShop(tenantId);
  if (!shop) return null;
  await prisma.$executeRawUnsafe(
    `UPDATE "Tenant"
     SET "status" = COALESCE("statusBeforeBlock", 'ACTIVE')::"TenantStatus",
         "statusBeforeBlock" = NULL,
         "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1`,
    tenantId
  );
  if (shop.bot?.id) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Bot"
       SET "status" = COALESCE("statusBeforeBlock", 'ACTIVE')::"BotStatus",
           "isEnabled" = COALESCE("isEnabledBeforeBlock", true),
           "statusBeforeBlock" = NULL,
           "isEnabledBeforeBlock" = NULL,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1`,
      shop.bot.id
    );
  }
  try {
    await require("../bot/engine").syncTenantBots();
  } catch (err) {
    console.error("SHOP UNBLOCK SYNC SKIP:", err.message);
  }
  return loadShop(tenantId);
}

async function listBlockedShops(skip = 0, take = 10) {
  await ensureBlockColumns();
  const offset = Math.max(0, Number(skip) || 0);
  const limit = Math.max(1, Number(take) || 10);
  try {
    return await prisma.$queryRawUnsafe(
      `SELECT t."id" AS "tenantId", t."name" AS "tenantName",
              t."ownerUserId",
              b."id" AS "botId", b."username", b."baleBotId"
       FROM "Tenant" t
       LEFT JOIN "Bot" b ON b."tenantId" = t."id"
       WHERE t."status" = 'SUSPENDED'
       ORDER BY t."updatedAt" DESC
       LIMIT $1 OFFSET $2`,
      limit,
      offset
    );
  } catch (err) {
    console.error("SHOP BLOCK LIST SKIP:", err.message);
    return [];
  }
}

function isBlocked(shop) {
  return shop?.status === "SUSPENDED";
}

module.exports = {
  ensureBlockColumns,
  loadShop,
  blockShop,
  unblockShop,
  listBlockedShops,
  isBlocked,
};
