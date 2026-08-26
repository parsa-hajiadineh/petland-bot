const prisma = require("../database/prisma");
const bale = require("./bale");
const { PUBLIC_BASE_URL } = require("../config");
const { decryptToken } = require("../utils/tokenCrypto");
const {
  motherContext,
  contextFromTenantBot,
  runWithContext,
} = require("./context");
const { getOrCreateUser } = require("../services/user");
const messageHandler = require("../handlers/router");

const pollers = new Map();
const hooked = new Set();
let lastLiveCount = -1;

function tenantWebhookUrl(botId) {
  if (!PUBLIC_BASE_URL) return null;
  return `${PUBLIC_BASE_URL.replace(/\/$/, "")}/webhook/bot/${botId}`;
}

async function loadBotTenant(bot) {
  let tenant = bot.tenant || null;
  if (!tenant && bot.tenantId) {
    try {
      tenant = await prisma.tenant.findUnique({
        where: { id: bot.tenantId },
      });
    } catch (err) {
      console.error("TENANT LOAD SKIP:", bot.id, err.message);
      return null;
    }
  }
  if (!tenant) return null;
  if (tenant.status === "SUSPENDED" || tenant.status === "INACTIVE") {
    return null;
  }

  let settings = tenant.settings || null;
  if (!settings) {
    try {
      settings = await prisma.tenantSettings.findUnique({
        where: { tenantId: tenant.id },
      });
    } catch (err) {
      console.error("SETTINGS LOAD SKIP:", bot.id, err.message);
      settings = null;
    }
  }

  return { ...tenant, settings };
}

async function processUpdate(update) {
  if (update.callback_query) {
    const cq = update.callback_query;
    try {
      await bale.answerCallbackQuery(cq.id);
    } catch (err) {
      console.error("ANSWER CALLBACK SKIP:", err.message);
    }
    const user = await getOrCreateUser({ from: cq.from });
    await messageHandler.handleCallbackQuery(cq, user);
    return;
  }

  if (!update.message) return;

  const msg = update.message;

  let referrerBaleId = null;
  if (msg.text && msg.text.startsWith("/start ref_")) {
    referrerBaleId = msg.text.replace("/start ref_", "").trim();
  }

  const user = await getOrCreateUser(msg, referrerBaleId);

  if (msg.photo?.length) {
    await messageHandler.handlePhoto(msg, user);
    return;
  }

  if (!msg.text) return;

  await messageHandler(msg, user);
}

function touchLastSeen(ctx, state) {
  if (ctx.isMother) return;
  const now = Date.now();
  if (state.lastSeenWrite && now - state.lastSeenWrite < 60000) return;
  state.lastSeenWrite = now;
  prisma.bot
    .update({
      where: { id: ctx.botId },
      data: { lastSeenAt: new Date() },
    })
    .catch((err) => {
      console.error("BOT LAST SEEN SKIP:", ctx.botId, err.message);
    });
}

async function pollLoop(ctx, state) {
  console.log("POLL START:", ctx.name, ctx.isMother ? "(mother)" : ctx.tenantId);

  while (!state.stopped) {
    try {
      await runWithContext(ctx, async () => {
        const updates = await bale.getUpdates(state.offset);
        if (updates.ok) {
          touchLastSeen(ctx, state);
          if (updates.result.length > 0) {
            for (const update of updates.result) {
              try {
                await processUpdate(update);
              } catch (err) {
                console.error("UPDATE HANDLER ERROR:", ctx.name, err);
              }
              state.offset = update.update_id + 1;
            }
          }
        } else {
          console.error(
            "GET UPDATES FAIL:",
            ctx.name,
            updates?.description || updates?.error_code || "unknown"
          );
        }
      });
    } catch (err) {
      console.error("POLLING ERROR:", ctx.name, err.message);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  console.log("POLL STOP:", ctx.name);
}

async function startPoller(ctx) {
  if (pollers.has(ctx.botId)) return;
  if (!ctx.isMother) {
    hooked.delete(ctx.botId);
    try {
      await bale.deleteWebhook(ctx.token);
    } catch (err) {
      console.error("DELETE WEBHOOK BEFORE POLL:", err.message);
    }
  }
  const state = { stopped: false, offset: 0 };
  pollers.set(ctx.botId, { ctx, state });
  pollLoop(ctx, state).catch((err) => {
    console.error("POLL LOOP CRASH:", ctx.name, err);
    pollers.delete(ctx.botId);
  });
}

function stopPoller(botId) {
  const running = pollers.get(botId);
  if (!running) return;
  running.state.stopped = true;
  pollers.delete(botId);
}

async function loadTenantContexts() {
  let bots = [];
  try {
    bots = await prisma.bot.findMany({
      where: { isEnabled: true, status: "ACTIVE" },
    });
  } catch (err) {
    console.error("BOT LIST SKIP:", err.message);
    return [];
  }

  const contexts = [];
  for (const bot of bots) {
    const tenant = await loadBotTenant(bot);
    if (!tenant) continue;
    bot.tenant = tenant;
    try {
      const token = decryptToken(bot.token);
      contexts.push(contextFromTenantBot(bot, token));
    } catch (err) {
      console.error("BOT TOKEN DECRYPT SKIP:", bot.id, err.message);
    }
  }
  return contexts;
}

async function hookTenantBot(ctx) {
  const url = tenantWebhookUrl(ctx.botId);
  if (!url) return false;
  const result = await bale.setWebhook(ctx.token, url);
  if (!result?.ok) {
    console.error("SET WEBHOOK FAIL:", ctx.botId, result?.description || result);
    return false;
  }
  hooked.add(ctx.botId);
  stopPoller(ctx.botId);
  return true;
}

async function syncTenantBots() {
  let contexts = [];
  try {
    contexts = await loadTenantContexts();
  } catch (err) {
    console.error("TENANT BOT SYNC SKIP:", err.message);
    return;
  }

  const liveIds = new Set(contexts.map((c) => c.botId));

  for (const [botId] of pollers) {
    if (botId === "mother") continue;
    if (!liveIds.has(botId)) {
      stopPoller(botId);
      hooked.delete(botId);
    }
  }

  for (const ctx of contexts) {
    const running = pollers.get(ctx.botId);
    if (running) {
      running.ctx.token = ctx.token;
      Object.assign(running.ctx, ctx);
      continue;
    }
    await startPoller(ctx);
  }

  if (liveIds.size !== lastLiveCount) {
    lastLiveCount = liveIds.size;
    console.log("TENANT BOTS LIVE:", liveIds.size, "(poll)");
  }
}

async function handleWebhook(botId, update) {
  if (!botId || !update) return;

  let bot;
  try {
    bot = await prisma.bot.findUnique({ where: { id: botId } });
  } catch (err) {
    console.error("WEBHOOK BOT LOAD:", botId, err.message);
    return;
  }
  if (!bot?.isEnabled || bot.status !== "ACTIVE") return;

  const tenant = await loadBotTenant(bot);
  if (!tenant) return;
  bot.tenant = tenant;

  let token;
  try {
    token = decryptToken(bot.token);
  } catch (err) {
    console.error("WEBHOOK DECRYPT SKIP:", botId, err.message);
    return;
  }

  const ctx = contextFromTenantBot(bot, token);
  await runWithContext(ctx, async () => {
    prisma.bot
      .update({
        where: { id: botId },
        data: { lastSeenAt: new Date() },
      })
      .catch(() => {});
    await processUpdate(update);
  });
}

async function start() {
  try {
    await require("../services/shopProvision").ensureShopRuntimeTables();
  } catch (err) {
    console.error("SHOP TABLES START SKIP:", err.message);
  }

  const mother = motherContext();
  await startPoller(mother);
  await runWithContext(mother, () => bale.testBot());
  await syncTenantBots();
  console.log(
    "ENGINE READY: mother +",
    lastLiveCount < 0 ? 0 : lastLiveCount,
    "tenant bot(s)"
  );
  setInterval(() => {
    syncTenantBots().catch((err) => {
      console.error("TENANT BOT SYNC:", err.message);
    });
  }, 30000);
}

module.exports = {
  start,
  syncTenantBots,
  processUpdate,
  handleWebhook,
  tenantWebhookUrl,
};
