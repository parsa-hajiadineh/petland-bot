const prisma = require("../database/prisma");
const {
  BOT_TOKEN,
  DEFAULT_PROFIT_PERCENT,
  PUBLIC_BASE_URL,
} = require("../config");
const bale = require("../bot/bale");
const { encryptToken, hashToken } = require("../utils/tokenCrypto");

function publicBaseUrl() {
  return (PUBLIC_BASE_URL || "").replace(/\/$/, "");
}

function tenantWebhookUrl(botId) {
  const base = publicBaseUrl();
  if (!base) return null;
  return `${base}/webhook/bot/${botId}`;
}

function defaultSettingsData(tenant) {
  const name = tenant.name || "فروشگاه";
  return {
    shopName: name,
    welcomeMessage: `خرید از ${name} با منوی زیر انجام می‌شود.`,
    supportPhone: tenant.phone || null,
    profitPercent: DEFAULT_PROFIT_PERCENT,
  };
}

function extractBotToken(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/(\d{5,}:[A-Za-z0-9_-]{20,})/);
  return match ? match[1] : text.replace(/\s+/g, "");
}

async function validateToken(plainToken) {
  const token = extractBotToken(plainToken);
  if (!token || token.length < 20) {
    return { ok: false, code: "INVALID_TOKEN" };
  }
  if (BOT_TOKEN && token === BOT_TOKEN) {
    return { ok: false, code: "MOTHER_TOKEN" };
  }

  try {
    const me = await bale.getMeWithToken(token);
    if (!me?.ok || !me.result?.id) {
      console.error("TOKEN VALIDATE FAIL:", me?.description || me?.error_code || "no result");
      return { ok: false, code: "VALIDATE_FAILED" };
    }
    return { ok: true, token, me };
  } catch (err) {
    console.error("TOKEN VALIDATE ERROR:", err.message);
    return { ok: false, code: "VALIDATE_FAILED" };
  }
}

async function attachTenantExtras(tenant) {
  if (!tenant) return null;
  if (tenant.bot === undefined) {
    try {
      tenant.bot = await prisma.bot.findUnique({
        where: { tenantId: tenant.id },
      });
    } catch (err) {
      console.error("BOT LOOKUP SKIP:", err.message);
      tenant.bot = null;
    }
  }
  if (tenant.settings === undefined) {
    try {
      tenant.settings = await prisma.tenantSettings.findUnique({
        where: { tenantId: tenant.id },
      });
    } catch (err) {
      console.error("SETTINGS LOOKUP SKIP:", err.message);
      tenant.settings = null;
    }
  }
  return tenant;
}

async function findOwnedTenant(userId) {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { ownerUserId: userId },
    });
    if (tenant) return attachTenantExtras(tenant);
  } catch (err) {
    console.error("TENANT LOOKUP OWNER SKIP:", err.message);
  }

  try {
    const member = await prisma.tenantMember.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    if (member) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: member.tenantId },
      });
      if (tenant) return attachTenantExtras(tenant);
    }
  } catch (err) {
    console.error("TENANT LOOKUP MEMBER SKIP:", err.message);
  }

  try {
    const customer = await prisma.customer.findFirst({
      where: { userId, type: "COLLEAGUE", tenantId: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    if (customer?.tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: customer.tenantId },
      });
      if (tenant) return attachTenantExtras(tenant);
    }
  } catch (err) {
    console.error("TENANT LOOKUP CUSTOMER SKIP:", err.message);
  }

  return null;
}

async function logTenantSchema() {
  try {
    const cols = await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Tenant'
      ORDER BY ordinal_position
    `;
    const names = (cols || []).map((c) => c.column_name).join(",");
    console.error("TENANT COLUMNS:", names || "(none)");
    if (!cols || cols.length === 0) {
      console.error("TENANT TABLE MISSING: run prisma db push on Liara");
    }
  } catch (err) {
    console.error("TENANT TABLE CHECK:", err.message);
  }
}

async function createTenantWithFallback(payloads) {
  for (const data of payloads) {
    try {
      const tenant = await prisma.tenant.create({ data });
      console.log("TENANT CREATE OK:", Object.keys(data).join(","));
      return tenant;
    } catch (err) {
      console.error(
        "TENANT CREATE FAIL:",
        Object.keys(data).join(","),
        err.message
      );
    }
  }
  await logTenantSchema();
  return null;
}

async function updateTenantWithFallback(tenantId, payloads) {
  for (const data of payloads) {
    try {
      return await prisma.tenant.update({
        where: { id: tenantId },
        data,
      });
    } catch (err) {
      console.error(
        "TENANT UPDATE FAIL:",
        Object.keys(data).join(","),
        err.message
      );
    }
  }
  return null;
}

async function linkTenantOwner(tenant, user, profile) {
  try {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { ownerUserId: user.id },
    });
  } catch (err) {
    console.error("TENANT OWNER LINK SKIP:", err.message);
  }

  try {
    await prisma.tenantSettings.upsert({
      where: { tenantId: tenant.id },
      create: {
        tenantId: tenant.id,
        shopName: profile.brand,
        supportPhone: profile.phone,
      },
      update: {
        shopName: profile.brand,
        supportPhone: profile.phone,
      },
    });
  } catch (err) {
    console.error("COLLEAGUE SETTINGS SKIP:", err.message);
  }

  try {
    await prisma.tenantMember.upsert({
      where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        role: "OWNER",
      },
      update: { role: "OWNER" },
    });
  } catch (err) {
    console.error("COLLEAGUE MEMBER UPSERT SKIP:", err.message);
    try {
      await prisma.tenantMember.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
        },
      });
    } catch (createErr) {
      console.error("COLLEAGUE MEMBER CREATE SKIP:", createErr.message);
    }
  }

  try {
    const existingCustomer = await prisma.customer.findFirst({
      where: { userId: user.id, tenantId: tenant.id, type: "COLLEAGUE" },
    });
    const customerData = {
      fullName: profile.fullName,
      phone: profile.phone,
      shopName: profile.brand,
      address: profile.mode === "ONLINE" ? null : profile.address || null,
      notes: profile.mode === "PHYSICAL" ? null : profile.page || null,
    };
    if (existingCustomer) {
      await prisma.customer.update({
        where: { id: existingCustomer.id },
        data: customerData,
      });
    } else {
      await prisma.customer.create({
        data: {
          type: "COLLEAGUE",
          userId: user.id,
          tenantId: tenant.id,
          ...customerData,
        },
      });
    }
  } catch (err) {
    console.error("COLLEAGUE CUSTOMER SKIP:", err.message);
  }
}

function colleagueTenantPayloads(user, profile) {
  const page = profile.mode === "PHYSICAL" ? null : profile.page || null;
  const address = profile.mode === "ONLINE" ? null : profile.address || null;
  const both = profile.mode === "BOTH";

  const full = {
    name: profile.brand,
    type: profile.mode === "ONLINE" ? "ONLINE_SHOP" : "PET_SHOP",
    status: "ACTIVE",
    ownerName: profile.fullName,
    phone: profile.phone,
    address,
    pageName: page,
    pageDetails: page,
    description: both ? "ONLINE+PHYSICAL" : null,
    province: profile.mode || null,
    city: page,
    ownerUserId: user.id,
  };

  const compatible = {
    name: profile.brand,
    type: "PET_SHOP",
    status: "ACTIVE",
    ownerName: profile.fullName,
    phone: profile.phone,
    address: profile.address || null,
    description: [profile.mode, profile.page].filter(Boolean).join(" | ") || null,
    province: profile.mode || null,
    city: profile.page || null,
    ownerUserId: user.id,
  };

  const coreWithOwner = {
    name: profile.brand,
    type: "PET_SHOP",
    status: "ACTIVE",
    ownerName: profile.fullName,
    phone: profile.phone,
    address: profile.address || null,
    ownerUserId: user.id,
  };

  const coreNoOwner = {
    name: profile.brand,
    type: "PET_SHOP",
    status: "ACTIVE",
    ownerName: profile.fullName,
    phone: profile.phone,
    address: profile.address || null,
  };

  const minimal = {
    name: profile.brand,
    type: "PET_SHOP",
    status: "ACTIVE",
  };

  const nameOnly = { name: profile.brand };

  return [full, compatible, coreWithOwner, coreNoOwner, minimal, nameOnly];
}

async function ensureTenantSchema() {
  let cols = [];
  try {
    cols = await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Tenant'
    `;
  } catch (err) {
    console.error("TENANT SCHEMA CHECK:", err.message);
    return;
  }

  if (!cols || cols.length === 0) {
    try {
      await prisma.$executeRawUnsafe(`
        DO $$ BEGIN
          CREATE TYPE "TenantType" AS ENUM ('CLINIC','VET','PET_SHOP','ONLINE_SHOP','OTHER');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `);
      await prisma.$executeRawUnsafe(`
        DO $$ BEGIN
          CREATE TYPE "TenantStatus" AS ENUM ('PENDING','ACTIVE','SUSPENDED','INACTIVE');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "Tenant" (
          "id" TEXT NOT NULL,
          "name" TEXT NOT NULL,
          "type" "TenantType" NOT NULL DEFAULT 'PET_SHOP',
          "status" "TenantStatus" NOT NULL DEFAULT 'PENDING',
          "ownerName" TEXT,
          "phone" TEXT,
          "province" TEXT,
          "city" TEXT,
          "address" TEXT,
          "postalCode" TEXT,
          "nationalId" TEXT,
          "description" TEXT,
          "pageName" TEXT,
          "pageDetails" TEXT,
          "ownerUserId" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_ownerUserId_key" ON "Tenant"("ownerUserId")`
      );
      console.log("TENANT TABLE CREATED");
    } catch (err) {
      console.error("TENANT TABLE CREATE FAIL:", err.message);
    }
    return;
  }

  const have = new Set(cols.map((c) => c.column_name));
  const needed = [
    "ownerUserId",
    "pageName",
    "pageDetails",
    "ownerName",
    "phone",
    "address",
    "province",
    "city",
    "description",
    "postalCode",
    "nationalId",
  ];
  for (const col of needed) {
    if (have.has(col)) continue;
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "${col}" TEXT`
      );
      console.log("TENANT COLUMN ADDED:", col);
    } catch (err) {
      console.error("TENANT COLUMN ADD SKIP:", col, err.message);
    }
  }
  try {
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_ownerUserId_key" ON "Tenant"("ownerUserId")`
    );
  } catch (err) {
    console.error("TENANT OWNER INDEX SKIP:", err.message);
  }
}

async function execSql(label, sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (err) {
    console.error(label, err.message);
  }
}

async function tableExists(tableName) {
  try {
    const cols = await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${tableName}
      LIMIT 1
    `;
    return Boolean(cols && cols.length);
  } catch (err) {
    console.error("TABLE CHECK:", tableName, err.message);
    return false;
  }
}

async function ensureShopRuntimeTables() {
  await execSql(
    "ENUM BotStatus SKIP:",
    `DO $$ BEGIN
      CREATE TYPE "BotStatus" AS ENUM ('PENDING','ACTIVE','DISABLED','EXPIRED');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;`
  );
  await execSql(
    "ENUM TenantMemberRole SKIP:",
    `DO $$ BEGIN
      CREATE TYPE "TenantMemberRole" AS ENUM ('OWNER','ADMIN','STAFF');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;`
  );

  if (!(await tableExists("Bot"))) {
    await execSql(
      "BOT TABLE CREATE FAIL:",
      `CREATE TABLE IF NOT EXISTS "Bot" (
        "id" TEXT NOT NULL,
        "token" TEXT NOT NULL,
        "tokenHash" TEXT NOT NULL,
        "username" TEXT,
        "baleBotId" TEXT,
        "status" "BotStatus" NOT NULL DEFAULT 'PENDING',
        "isEnabled" BOOLEAN NOT NULL DEFAULT false,
        "activatedAt" TIMESTAMP(3),
        "lastSeenAt" TIMESTAMP(3),
        "tenantId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Bot_pkey" PRIMARY KEY ("id")
      )`
    );
    await execSql(
      "BOT HASH INDEX SKIP:",
      `CREATE UNIQUE INDEX IF NOT EXISTS "Bot_tokenHash_key" ON "Bot"("tokenHash")`
    );
    await execSql(
      "BOT TENANT INDEX SKIP:",
      `CREATE UNIQUE INDEX IF NOT EXISTS "Bot_tenantId_key" ON "Bot"("tenantId")`
    );
    console.log("BOT TABLE READY");
  }

  if (!(await tableExists("TenantSettings"))) {
    await execSql(
      "SETTINGS TABLE CREATE FAIL:",
      `CREATE TABLE IF NOT EXISTS "TenantSettings" (
        "id" TEXT NOT NULL,
        "shopName" TEXT,
        "welcomeMessage" TEXT,
        "supportPhone" TEXT,
        "bankCard" TEXT,
        "bankIban" TEXT,
        "bankHolder" TEXT,
        "bankName" TEXT,
        "profitPercent" INTEGER,
        "minOrderAmount" INTEGER,
        "logoFileId" TEXT,
        "shopDescription" TEXT,
        "shopAddress" TEXT,
        "openingHours" TEXT,
        "tenantId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "TenantSettings_pkey" PRIMARY KEY ("id")
      )`
    );
    await execSql(
      "SETTINGS TENANT INDEX SKIP:",
      `CREATE UNIQUE INDEX IF NOT EXISTS "TenantSettings_tenantId_key" ON "TenantSettings"("tenantId")`
    );
    console.log("TENANT SETTINGS TABLE READY");
  }

  if (!(await tableExists("TenantMember"))) {
    await execSql(
      "MEMBER TABLE CREATE FAIL:",
      `CREATE TABLE IF NOT EXISTS "TenantMember" (
        "id" TEXT NOT NULL,
        "role" "TenantMemberRole" NOT NULL DEFAULT 'STAFF',
        "tenantId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "TenantMember_pkey" PRIMARY KEY ("id")
      )`
    );
    await execSql(
      "MEMBER UNIQUE SKIP:",
      `CREATE UNIQUE INDEX IF NOT EXISTS "TenantMember_tenantId_userId_key" ON "TenantMember"("tenantId", "userId")`
    );
    console.log("TENANT MEMBER TABLE READY");
  }

  const settingsCols = [
    "logoFileId",
    "shopDescription",
    "shopAddress",
    "openingHours",
  ];
  for (const col of settingsCols) {
    await execSql(
      `SETTINGS COL ${col} SKIP:`,
      `ALTER TABLE "TenantSettings" ADD COLUMN IF NOT EXISTS "${col}" TEXT`
    );
  }
  await execSql(
    "CATEGORY TENANT COL SKIP:",
    `ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "tenantId" TEXT`
  );
}

async function persistColleagueShop(user, profile) {
  if (!profile?.fullName || !profile?.phone || !profile?.brand) {
    return { ok: false };
  }

  await ensureTenantSchema();
  await ensureShopRuntimeTables();

  let tenant = await findOwnedTenant(user.id);
  const payloads = colleagueTenantPayloads(user, profile);

  if (tenant) {
    const updated = await updateTenantWithFallback(tenant.id, payloads);
    if (updated) tenant = updated;
  } else {
    tenant = await createTenantWithFallback(payloads);
  }

  if (!tenant) return { ok: false };

  await linkTenantOwner(tenant, user, profile);
  return { ok: true, tenant: await attachTenantExtras(tenant) };
}

async function loadDefaultSettings(tenant) {
  const defaults = defaultSettingsData(tenant);
  const current = tenant.settings;

  await prisma.tenantSettings.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      ...defaults,
    },
    update: {
      shopName: current?.shopName || defaults.shopName,
      welcomeMessage: current?.welcomeMessage || defaults.welcomeMessage,
      supportPhone: current?.supportPhone || defaults.supportPhone,
      profitPercent: current?.profitPercent ?? defaults.profitPercent,
    },
  });
}

async function connectBot(token, botId) {
  try {
    await bale.deleteWebhook(token);
  } catch (err) {
    console.error("DELETE WEBHOOK SKIP:", err.message);
  }

  try {
    await bale.setMyCommands(token, [
      { command: "start", description: "شروع فروشگاه" },
    ]);
  } catch (err) {
    console.error("SET COMMANDS SKIP:", err.message);
  }

  return "poll";
}

async function provisionShop(user, rawToken) {
  try {
    await ensureTenantSchema();
    await ensureShopRuntimeTables();

    let tenant = await findOwnedTenant(user.id);
    if (!tenant && user.pendingOrderId) {
      try {
        const byId = await prisma.tenant.findUnique({
          where: { id: user.pendingOrderId },
        });
        if (byId) tenant = await attachTenantExtras(byId);
      } catch (err) {
        console.error("TENANT LOOKUP PENDING SKIP:", err.message);
      }
    }
    if (!tenant) {
      return { ok: false, code: "NEED_PROFILE" };
    }
    if (tenant.bot) {
      return {
        ok: false,
        code: "ALREADY_HAS_BOT",
        username: tenant.bot.username || null,
        shopName: tenant.name,
      };
    }

    const checked = await validateToken(rawToken);
    if (!checked.ok) return checked;

    const { token, me } = checked;
    const tokenHash = hashToken(token);
    let existing = null;
    try {
      existing = await prisma.bot.findUnique({ where: { tokenHash } });
    } catch (err) {
      console.error("BOT HASH LOOKUP SKIP:", err.message);
    }
    if (existing) {
      return { ok: false, code: "DUPLICATE_TOKEN" };
    }

    const bot = await prisma.bot.create({
      data: {
        tenantId: tenant.id,
        token: encryptToken(token),
        tokenHash,
        username: me.result.username || null,
        baleBotId: String(me.result.id),
        status: "ACTIVE",
        isEnabled: true,
        activatedAt: new Date(),
      },
    });

    await loadDefaultSettings(tenant);

    const connectMode = await connectBot(token, bot.id);

    try {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: "ACTIVE" },
      });
    } catch (err) {
      console.error("TENANT ACTIVATE SKIP:", err.message);
    }

    setImmediate(() => {
      require("../bot/engine")
        .syncTenantBots()
        .catch((err) => {
          console.error("BOT SYNC AFTER PROVISION:", err.message);
        });
    });

    return {
      ok: true,
      connectMode,
      username: me.result.username || null,
      shopName: tenant.settings?.shopName || tenant.name,
      botName: me.result.first_name || null,
    };
  } catch (err) {
    console.error("SHOP PROVISION:", err);
    return { ok: false, code: "SAVE_FAILED" };
  }
}

module.exports = {
  provisionShop,
  findOwnedTenant,
  persistColleagueShop,
  ensureShopRuntimeTables,
  tenantWebhookUrl,
  publicBaseUrl,
};
