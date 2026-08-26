const { AsyncLocalStorage } = require("async_hooks");
const {
  BOT_TOKEN,
  SHOP_NAME,
  BOT_USERNAME,
  BANK_CARD,
  BANK_IBAN,
  BANK_HOLDER,
  BANK_NAME,
  DEFAULT_PROFIT_PERCENT,
} = require("../config");

const storage = new AsyncLocalStorage();

const CATALOG_MODE = {
  MOTHER: "MOTHER",
  TENANT_OWN: "TENANT_OWN",
};

function buildRuntime(fields) {
  return {
    isMother: fields.isMother,
    tenantId: fields.tenantId,
    botId: fields.botId,
    token: fields.token,
    catalogMode: fields.catalogMode,
    identity: {
      tenantId: fields.tenantId,
      botId: fields.botId,
      name: fields.name,
      username: fields.username,
    },
    branding: {
      name: fields.name,
      welcomeMessage: fields.welcomeMessage,
      supportPhone: fields.supportPhone,
      logoFileId: fields.logoFileId,
    },
    payment: {
      bank: fields.bank,
      profitPercent: fields.profitPercent,
      minOrderAmount: fields.minOrderAmount,
    },
    name: fields.name,
    username: fields.username,
    welcomeMessage: fields.welcomeMessage,
    supportPhone: fields.supportPhone,
    logoFileId: fields.logoFileId,
    bank: fields.bank,
    profitPercent: fields.profitPercent,
    minOrderAmount: fields.minOrderAmount,
  };
}

function motherContext() {
  return buildRuntime({
    isMother: true,
    tenantId: null,
    botId: "mother",
    token: BOT_TOKEN,
    name: SHOP_NAME,
    username: BOT_USERNAME || null,
    welcomeMessage: null,
    supportPhone: null,
    logoFileId: null,
    bank: {
      card: BANK_CARD,
      iban: BANK_IBAN,
      holder: BANK_HOLDER,
      name: BANK_NAME,
    },
    profitPercent: DEFAULT_PROFIT_PERCENT,
    minOrderAmount: null,
    catalogMode: CATALOG_MODE.MOTHER,
  });
}

function contextFromTenantBot(bot, token) {
  const tenant = bot.tenant || {};
  const settings = tenant.settings || {};
  return buildRuntime({
    isMother: false,
    tenantId: tenant.id,
    botId: bot.id,
    token,
    name: settings.shopName || tenant.name,
    username: bot.username || null,
    welcomeMessage: settings.welcomeMessage || null,
    supportPhone: settings.supportPhone || tenant.phone || null,
    logoFileId: settings.logoFileId || null,
    bank: {
      card: settings.bankCard || "",
      iban: settings.bankIban || "",
      holder: settings.bankHolder || "",
      name: settings.bankName || "",
    },
    profitPercent: settings.profitPercent,
    minOrderAmount: settings.minOrderAmount,
    catalogMode: CATALOG_MODE.TENANT_OWN,
  });
}

function runWithContext(ctx, fn) {
  return storage.run(ctx, fn);
}

function getBotContext() {
  return storage.getStore() || motherContext();
}

function getToken() {
  return getBotContext().token || BOT_TOKEN;
}

function isMother() {
  return getBotContext().isMother !== false;
}

module.exports = {
  CATALOG_MODE,
  motherContext,
  contextFromTenantBot,
  runWithContext,
  getBotContext,
  getToken,
  isMother,
};
