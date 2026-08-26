const { reply, replyPhoto } = require("../bot/messenger");
const { getBotContext } = require("../bot/context");
const { reloadUser } = require("../services/user");
const {
  BTN,
  tenantMainMenu,
} = require("../keyboards/menus");
const productsHandler = require("./products");
const tenantAdmin = require("./tenantAdmin");
const { ensureShopRuntimeTables } = require("../services/shopProvision");

async function shopMenu(user) {
  const ctx = getBotContext();
  const owner = await tenantAdmin.isShopOwner(user, ctx.tenantId);
  return tenantMainMenu(owner);
}

async function showStart(user, chatId) {
  try {
    const ctx = getBotContext();
    await ensureShopRuntimeTables().catch((err) => {
      console.error("SHOP TABLES START:", err.message);
    });
    await tenantAdmin.clearTenantAdminState(user);
    const shop = await tenantAdmin.loadShopView(ctx.tenantId);
    const text = tenantAdmin.shopIntroText(shop);
    const menu = await shopMenu(user);
    if (shop.logoFileId) {
      try {
        const sent = await replyPhoto(user, chatId, shop.logoFileId, text, menu);
        if (sent?.ok || sent?.result?.message_id) return;
      } catch (err) {
        console.error("SHOP LOGO START:", err.message);
      }
    }
    await reply(user, chatId, text, menu);
  } catch (err) {
    console.error("TENANT START:", err);
    await reply(
      user,
      chatId,
      "🌿 به فروشگاه خوش آمدید\n\nاز منوی زیر استفاده کنید:",
      tenantMainMenu(false)
    );
  }
}

async function showHelp(user, chatId) {
  const ctx = getBotContext();
  const shop = await tenantAdmin.loadShopView(ctx.tenantId);
  const phone = shop.phone ? `\n📞 ${shop.phone}` : "";
  const address = shop.address ? `\n📍 ${shop.address}` : "";
  const hours = shop.openingHours ? `\n🕐 ${shop.openingHours}` : "";
  await reply(
    user,
    chatId,
    `📖 راهنما\n\nاز دکمه محصولات، کالاهای همین فروشگاه را ببینید.${phone}${address}${hours}`,
    await shopMenu(user)
  );
}

async function handleMessage(message, user) {
  try {
    await handleMessageInner(message, user);
  } catch (err) {
    console.error("TENANT MESSAGE:", err);
    try {
      await reply(
        user,
        message.chat.id,
        "فروشگاه الان پاسخ داد، ولی یک خطا رخ داد. دوباره /start بزنید.",
        tenantMainMenu(false)
      );
    } catch (replyErr) {
      console.error("TENANT REPLY FAIL:", replyErr.message);
    }
  }
}

async function handleMessageInner(message, user) {
  const text = (message.text || "").trim();
  const chatId = message.chat.id;
  user = (await reloadUser(user.id)) || user;

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

  if (await tenantAdmin.handleAdminText(user, chatId, text)) {
    return;
  }

  if (text === BTN.HELP) {
    await showHelp(user, chatId);
    return;
  }

  if (
    text === BTN.PRODUCTS ||
    text === BTN.BACK_PRODUCTS
  ) {
    await productsHandler.showTenantProducts(user, chatId, getBotContext().tenantId);
    return;
  }

  if (text === BTN.BACK_PRODUCT_LIST) {
    let categoryTitle;
    if (user.lastProductCode) {
      const product = await productsHandler.loadTenantProductByCode(
        user.lastProductCode,
        getBotContext().tenantId
      );
      categoryTitle = product?.category?.title;
    }
    await productsHandler.showTenantProducts(
      user,
      chatId,
      getBotContext().tenantId,
      categoryTitle
    );
    return;
  }

  if (user.orderStep && String(user.orderStep).startsWith("TSC:")) {
    await productsHandler.showTenantProducts(
      user,
      chatId,
      getBotContext().tenantId,
      text
    );
    return;
  }

  await reply(
    user,
    chatId,
    "لطفاً از دکمه‌های منو استفاده کنید.",
    await shopMenu(user)
  );
}

async function handleCallbackQuery(cq, user) {
  const data = (cq.data || "").trim();
  const chatId = cq.message.chat.id;
  const ctx = getBotContext();
  user = (await reloadUser(user.id)) || user;

  if (await tenantAdmin.handleAdminCallback(user, chatId, data)) {
    return;
  }

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

  if (data.startsWith("tcat:")) {
    const categoryTitle = data.slice(5);
    await productsHandler.showTenantProducts(
      user,
      chatId,
      ctx.tenantId,
      categoryTitle
    );
    return;
  }

  await showStart(user, chatId);
}

async function handlePhoto(message, user) {
  const chatId = message.chat.id;
  user = (await reloadUser(user.id)) || user;
  const photo = message.photo;
  if (!photo?.length) return;
  if (await tenantAdmin.handleAdminPhoto(user, chatId, photo)) return;
  await reply(
    user,
    chatId,
    "عکس دریافت شد ولی در این مرحله نیاز نیست.",
    await shopMenu(user)
  );
}

module.exports = {
  handleMessage,
  handleCallbackQuery,
  handlePhoto,
  showStart,
};
