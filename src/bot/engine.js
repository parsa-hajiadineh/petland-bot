const prisma = require("../database/prisma");
const bale = require("./bale");
const { decryptToken } = require("../utils/tokenCrypto");
const {
  motherContext,
  contextFromTenantBot,
  runWithContext,
} = require("./context");
const { getOrCreateUser } = require("../services/user");
const messageHandler = require("../handlers/router");

const pollers = new Map();
let lastLiveCount = -1;

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
        }
      });
    } catch (err) {
      console.error("POLLING ERROR:", ctx.name, err.message);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  console.log("POLL STOP:", ctx.name);
}

function startPoller(ctx) {
  if (pollers.has(ctx.botId)) return;
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
  const bots = await prisma.bot.findMany({
    where: { isEnabled: true, status: "ACTIVE" },
    include: { tenant: { include: { settings: true } } },
  });

  const contexts = [];
  for (const bot of bots) {
    if (!bot.tenant || bot.tenant.status !== "ACTIVE") continue;
    try {
      const token = decryptToken(bot.token);
      contexts.push(contextFromTenantBot(bot, token));
    } catch (err) {
      console.error("BOT TOKEN DECRYPT SKIP:", bot.id, err.message);
    }
  }
  return contexts;
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
    }
  }

  for (const ctx of contexts) {
    const running = pollers.get(ctx.botId);
    if (running) {
      running.ctx.token = ctx.token;
      Object.assign(running.ctx, ctx);
      continue;
    }
    startPoller(ctx);
  }

  if (liveIds.size !== lastLiveCount) {
    lastLiveCount = liveIds.size;
    console.log("TENANT BOTS LIVE:", liveIds.size);
  }
}

async function start() {
  const mother = motherContext();
  startPoller(mother);
  await runWithContext(mother, () => bale.testBot());
  await syncTenantBots();
  console.log("ENGINE READY: mother +", pollers.size - 1, "tenant bot(s)");
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
};
