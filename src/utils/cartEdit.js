const { reply } = require("../bot/messenger");
const bale = require("../bot/bale");
const { cartMenu, inlineKb, backMain } = require("../keyboards/menus");

const PAGE = 10;
const ITEM_PREFIX = "ce:i:";
const MORE_PREFIX = "ce:m:";
const MOTHER_STEP = "CART_EDIT_QTY";
const TENANT_STEP = "TCK:EDIT";
const PROMPT =
  "لطفا تعداد مد نظر خود را (به عدد) وارد کنید، عدد 0  به معنای حذف این محصول از سبد خرید شماست:";

function itemLabel(item) {
  const qty = item.quantity;
  const title = String(item.product?.title || "محصول")
    .replace(/\s+/g, " ")
    .trim();
  const suffix = ` (${qty})`;
  const max = 60;
  if (title.length + suffix.length <= max) return title + suffix;
  return `${title.slice(0, Math.max(8, max - suffix.length - 1))}…${suffix}`;
}

async function sendEditList(user, chatId, items, offset = 0) {
  if (!items?.length) {
    await reply(user, chatId, "🛒 سبد خرید شما خالی است.", backMain());
    return;
  }

  let start = Number(offset) || 0;
  if (start >= items.length) {
    start = Math.max(0, items.length - PAGE);
  }

  const shown = items.slice(start, start + PAGE);
  const rows = shown.map((item) => [
    { text: itemLabel(item), callback_data: `${ITEM_PREFIX}${item.id}` },
  ]);
  if (items.length > start + PAGE) {
    rows.push([
      { text: "ده تای بعدی", callback_data: `${MORE_PREFIX}${start + PAGE}` },
    ]);
  }

  const pageInfo = start > 0 ? ` — صفحه ${Math.floor(start / PAGE) + 1}` : "";
  await reply(
    user,
    chatId,
    `✏️ اصلاح موجودی سبد${pageInfo}\nروی محصول بزنید:`,
    cartMenu()
  );
  await bale.sendKeyboard(
    chatId,
    "برای افزایش یا کاهش تعداد و یا حذف یک محصول از سبد روی نام آن کلیک کنید",
    inlineKb(rows)
  );
}

function isEditCallback(data) {
  return (
    String(data || "").startsWith(ITEM_PREFIX) ||
    String(data || "").startsWith(MORE_PREFIX)
  );
}

function parseEditCallback(data) {
  const raw = String(data || "");
  if (raw.startsWith(ITEM_PREFIX)) {
    return { kind: "item", id: raw.slice(ITEM_PREFIX.length) };
  }
  if (raw.startsWith(MORE_PREFIX)) {
    return { kind: "more", offset: Number(raw.slice(MORE_PREFIX.length)) || 0 };
  }
  return null;
}

module.exports = {
  PAGE,
  ITEM_PREFIX,
  MORE_PREFIX,
  MOTHER_STEP,
  TENANT_STEP,
  PROMPT,
  sendEditList,
  isEditCallback,
  parseEditCallback,
};
