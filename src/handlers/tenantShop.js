const { reply } = require("../bot/messenger");
const { getBotContext } = require("../bot/context");
const { BTN, tenantMainMenu } = require("../keyboards/menus");
const productsHandler = require("./products");

function welcomeText(ctx) {
  const name = ctx.name || "فروشگاه";
  const extra = ctx.welcomeMessage ? `\n\n${ctx.welcomeMessage}` : "";
  return `🌿 به ${name} خوش آمدید${extra}

از منوی زیر استفاده کنید:`;
}

async function showStart(user, chatId) {
  const ctx = getBotContext();
  await reply(user, chatId, welcomeText(ctx), tenantMainMenu());
}

async function showHelp(user, chatId) {
  const ctx = getBotContext();
  const phone = ctx.supportPhone ? `\n📞 ${ctx.supportPhone}` : "";
  await reply(
    user,
    chatId,
    `📖 راهنما\n\nاز دکمه محصولات برای دیدن کالاهای این فروشگاه استفاده کنید.${phone}`,
    tenantMainMenu()
  );
}

async function showProducts(user, chatId) {
  const ctx = getBotContext();
  await productsHandler.showTenantProducts(user, chatId, ctx.tenantId);
}

async function handleMessage(message, user) {
  const text = (message.text || "").trim();
  const chatId = message.chat.id;

  if (
    text === BTN.BACK_MAIN ||
    text === BTN.BACK_PRODUCTS ||
    text === BTN.BACK_PRODUCT_LIST ||
    text === BTN.PRODUCTS ||
    text === BTN.HELP ||
    text === "/start" ||
    text.startsWith("/start ")
  ) {
    await productsHandler.clearProductListMessages(user, chatId);
  }

  if (
    text === BTN.BACK_MAIN ||
    text === "/start" ||
    text.startsWith("/start ") ||
    !text
  ) {
    await showStart(user, chatId);
    return;
  }

  if (text === BTN.HELP) {
    await showHelp(user, chatId);
    return;
  }

  if (
    text === BTN.PRODUCTS ||
    text === BTN.BACK_PRODUCTS ||
    text === BTN.BACK_PRODUCT_LIST
  ) {
    await showProducts(user, chatId);
    return;
  }

  await reply(
    user,
    chatId,
    "لطفاً از دکمه‌های منو استفاده کنید.",
    tenantMainMenu()
  );
}

async function handleCallbackQuery(cq, user) {
  const data = (cq.data || "").trim();
  const chatId = cq.message.chat.id;
  const ctx = getBotContext();

  if (data.startsWith("product:")) {
    const code = data.replace("product:", "");
    const product = await productsHandler.loadTenantProductByCode(
      code,
      ctx.tenantId
    );
    if (!product) {
      await reply(user, chatId, "این محصول در این فروشگاه موجود نیست.");
      return;
    }
    await productsHandler.showProduct(user, chatId, product);
    return;
  }

  await showStart(user, chatId);
}

module.exports = {
  handleMessage,
  handleCallbackQuery,
  showStart,
};
