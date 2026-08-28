const prisma = require("../database/prisma");
const bale = require("../bot/bale");
const { BOT_TOKEN } = require("../config");
const { decryptToken } = require("../utils/tokenCrypto");

async function clearLastMessage(user, chatId) {
  if (!user?.lastMessageId) return;

  try {
    await bale.deleteMessage(chatId, user.lastMessageId);
  } catch (err) {
    console.log("DELETE MESSAGE SKIP:", err.message);
  }
}

async function reply(user, chatId, text, keyboard, options = {}) {
  if (!options.keepLast) {
    await clearLastMessage(user, chatId);
  }

  const result = keyboard
    ? await bale.sendKeyboard(chatId, text, keyboard)
    : await bale.sendMessage(chatId, text);

  const messageId = result?.result?.message_id;

  if (messageId && user?.id) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastMessageId: messageId },
    });
    user.lastMessageId = messageId;
  }

  return result;
}

async function replyPhoto(user, chatId, photo, caption, keyboard, options = {}) {
  if (!options.keepLast) {
    await clearLastMessage(user, chatId);
  }

  const result = await bale.sendPhoto(chatId, photo, caption, keyboard);
  const messageId = result?.result?.message_id;

  if (messageId && user?.id) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastMessageId: messageId },
    });
    user.lastMessageId = messageId;
  }

  return result;
}

async function notify(chatId, text, token) {
  return bale.sendMessage(chatId, text, {}, token);
}

async function notifyMother(chatId, text) {
  return bale.sendMessage(chatId, text, {}, BOT_TOKEN);
}

async function getShopBotToken(tenantId) {
  if (!tenantId) return null;
  let payload = null;
  try {
    if (prisma.bot?.findUnique) {
      const bot = await prisma.bot.findUnique({
        where: { tenantId },
        select: { token: true },
      });
      payload = bot?.token || null;
    }
  } catch (err) {
    console.error("SHOP BOT TOKEN PRISMA SKIP:", err.message);
  }
  if (!payload) {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT "token" FROM "Bot" WHERE "tenantId" = $1 LIMIT 1`,
        tenantId
      );
      payload = rows?.[0]?.token || null;
    } catch (err) {
      console.error("SHOP BOT TOKEN SQL SKIP:", err.message);
    }
  }
  if (!payload) return null;
  try {
    return decryptToken(payload);
  } catch (err) {
    console.error("SHOP BOT TOKEN DECRYPT SKIP:", err.message);
    return null;
  }
}

async function notifyShop(chatId, text, tenantId) {
  const token = await getShopBotToken(tenantId);
  if (token) return bale.sendMessage(chatId, text, {}, token);
  return notifyMother(chatId, text);
}

module.exports = {
  reply,
  replyPhoto,
  notify,
  notifyMother,
  notifyShop,
  clearLastMessage,
};
