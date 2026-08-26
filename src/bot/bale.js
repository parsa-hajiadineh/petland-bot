const fetch = require("node-fetch");
const { BOT_TOKEN } = require("../config");

const API_URL = `https://tapi.bale.ai/bot${BOT_TOKEN}`;

async function apiCall(method, body) {
  const options = { method: "POST" };

  if (body) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_URL}/${method}`, options);
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    console.error("BALE PARSE ERROR:", text);
    return { ok: false, description: text };
  }
}

async function testBot() {
  const data = await apiCall("getMe");
  console.log("BALE getMe:", data);
  return data;
}

async function getMeWithToken(token) {
  const response = await fetch(`https://tapi.bale.ai/bot${token}/getMe`, {
    method: "POST",
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, description: text };
  }
}

async function getUpdates(offset = 0) {
  const response = await fetch(
    `${API_URL}/getUpdates?offset=${offset}&timeout=30`
  );
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    console.error("UPDATES PARSE ERROR:", text);
    return { ok: false, result: [] };
  }
}

async function sendMessage(chatId, text, extra = {}) {
  return apiCall("sendMessage", {
    chat_id: chatId,
    text,
    ...extra,
  });
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

  const response = await fetch(`${API_URL}/sendDocument`, {
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
  API_URL,
};
