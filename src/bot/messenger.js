const prisma = require("../database/prisma");
const bale = require("../bot/bale");
const { BOT_TOKEN } = require("../config");

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

module.exports = {
  reply,
  replyPhoto,
  notify,
  notifyMother,
  clearLastMessage,
};
