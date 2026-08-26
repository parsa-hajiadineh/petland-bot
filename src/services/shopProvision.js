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

async function validateToken(plainToken) {
  const token = (plainToken || "").trim();
  if (!token || token.length < 20) {
    return { ok: false, code: "INVALID_TOKEN" };
  }
  if (BOT_TOKEN && token === BOT_TOKEN) {
    return { ok: false, code: "MOTHER_TOKEN" };
  }

  const me = await bale.getMeWithToken(token);
  if (!me?.ok || !me.result?.id) {
    return { ok: false, code: "VALIDATE_FAILED" };
  }

  return { ok: true, token, me };
}

async function ensureTenant(userId) {
  return prisma.tenant.findUnique({
    where: { ownerUserId: userId },
    include: { bot: true, settings: true },
  });
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
  const webhookUrl = tenantWebhookUrl(botId);

  await bale.deleteWebhook(token);

  await bale.setMyCommands(token, [
    { command: "start", description: "شروع فروشگاه" },
  ]);

  if (!webhookUrl) {
    return "poll";
  }

  const result = await bale.setWebhook(token, webhookUrl);
  if (!result?.ok) {
    console.error("SET WEBHOOK FAIL:", botId, result?.description || result);
    return "poll";
  }

  return "webhook";
}

async function provisionShop(user, rawToken) {
  const tenant = await ensureTenant(user.id);
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
  const existing = await prisma.bot.findUnique({ where: { tokenHash } });
  if (existing) {
    return { ok: false, code: "DUPLICATE_TOKEN" };
  }

  try {
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

    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { status: "ACTIVE" },
    });

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
  tenantWebhookUrl,
  publicBaseUrl,
};
