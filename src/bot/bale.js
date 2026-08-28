const { BOT_TOKEN } = require("../config");
const { getToken } = require("./context");
const fetch = require("node-fetch");

function botApiUrl(token) {
  return `https://tapi.bale.ai/bot${token || getToken() || BOT_TOKEN}`;
}

async function apiCall(method, body, token, timeoutMs = 15000) {
  const options = { method: "POST", timeout: timeoutMs };

  if (body) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${botApiUrl(token)}/${method}`, options);
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    console.error("BALE PARSE ERROR:", text);
    return { ok: false, description: text };
  }
}

async function testBot(token) {
  const data = await apiCall("getMe", undefined, token);
  console.log("BALE getMe:", data);
  return data;
}

async function getMeWithToken(token) {
  return apiCall("getMe", undefined, token);
}

async function getUpdates(offset = 0, token) {
  const response = await fetch(
    `${botApiUrl(token)}/getUpdates?offset=${offset}&timeout=30`,
    { timeout: 45000 }
  );
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    console.error("UPDATES PARSE ERROR:", text);
    return { ok: false, result: [] };
  }
}

async function sendMessage(chatId, text, extra = {}, token) {
  return apiCall(
    "sendMessage",
    {
      chat_id: chatId,
      text,
      ...extra,
    },
    token
  );
}

async function sendKeyboard(chatId, text, keyboard) {
  console.log(
    "KEYBOARD SENT:",
    JSON.stringify(keyboard, null, 2)
  );

  const result = await sendMessage(chatId, text, {
    reply_markup: keyboard,
  });

  console.log(
    "KEYBOARD RESPONSE:",
    JSON.stringify(result, null, 2)
  );

  return result;
}

async function sendPhoto(chatId, photo, caption, keyboard) {
  const body = {
    chat_id: chatId,
    photo,
    caption: caption || "",
  };

  if (keyboard) {
    body.reply_markup = keyboard;
  }

  return apiCall("sendPhoto", body);
}

async function deleteMessage(chatId, messageId) {
  if (!messageId) return { ok: false };
  return apiCall("deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}

async function sendDocument(chatId, document, caption) {
  const FormData = require("form-data");
  const form = new FormData();

  form.append("chat_id", chatId);
  form.append("document", document);

  if (caption) {
    form.append("caption", caption);
  }

  const response = await fetch(`${botApiUrl()}/sendDocument`, {
    method: "POST",
    body: form,
    headers: form.getHeaders(),
  });

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, description: text };
  }
}

async function getFile(fileId) {
  return apiCall("getFile", { file_id: fileId });
}

async function answerCallbackQuery(callbackQueryId, text = "") {
  return apiCall("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

async function setWebhook(url, token) {
  return apiCall("setWebhook", { url: url || "" }, token);
}

async function deleteWebhook(token) {
  return apiCall("setWebhook", { url: "" }, token);
}

async function setMyCommands(token, commands) {
  try {
    return await apiCall("setMyCommands", { commands }, token);
  } catch (err) {
    console.error("SET COMMANDS SKIP:", err.message);
    return { ok: false };
  }
}

module.exports = {
  testBot,
  getMeWithToken,
  getUpdates,
  sendMessage,
  sendKeyboard,
  deleteMessage,
  sendPhoto,
  sendDocument,
  getFile,
  answerCallbackQuery,
  setWebhook,
  deleteWebhook,
  setMyCommands,
};
