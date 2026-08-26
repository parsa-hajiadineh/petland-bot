const prisma = require("../database/prisma");
const { reloadUser } = require("../services/user");
const { isAdmin } = require("../services/user");
const { BTN, kb, backMain, mainMenu, PRODUCT_CATEGORIES } = require("../keyboards/menus");
const { reply } = require("../bot/messenger");
const bale = require("../bot/bale");
const { MARKETING_ACCESS_CODE } = require("../config");

const productsHandler = require("./products");
const cartHandler = require("./cart");
const orderHandler = require("./order");
const colleagueHandler = require("./colleague");
const helpHandler = require("./help");
const supportHandler = require("./support");
const adminHandler = require("./admin");
const startHandler = require("./start");
const marketingHandler = require("./marketing");
const walletHandler = require("./wallet");

module.exports = async function messageHandler(message, user) {
  const text = (message.text || "").trim();
  const chatId = message.chat.id;

  user = await reloadUser(user.id);

  if (text === BTN.BACK_MAIN || text === "/start" || text.startsWith("/start ")) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        orderStep: null,
        adminStep: null,
        pendingOrderId: null,
      },
    });
    user = await reloadUser(user.id);
    await startHandler(user, message);
    return;
  }

  if (text.startsWith("PL-") && user.adminStep === "VIEW_MY_ORDERS") {
    const shown = await orderHandler.showOrderByTracking(user, chatId, text);
    if (!shown) {
      await reply(user, chatId, "❌ سفارشی با این کد پیگیری یافت نشد.\nلطفاً کد را بررسی و دوباره ارسال کنید.");
    }
    return;
  }

  if (isAdmin(user) && (await adminHandler.handleAdmin(user, chatId, text))) {
    return;
  }

  if (await colleagueHandler(user, chatId, text)) return;

  if (await supportHandler.handleSupport(user, chatId, text)) return;

  if (text === BTN.HELP) {
    await helpHandler(user, chatId);
    return;
  }

  if (text === BTN.MARKETING) {
    await marketingHandler.showMarketing(user, chatId);
    return;
  }

  if (text === BTN.WALLET) {
    await walletHandler.showWallet(user, chatId);
    return;
  }

  if (text === BTN.WITHDRAW_NEW) {
    await walletHandler.startWithdrawal(user, chatId);
    return;
  }

  if (text === BTN.WITHDRAW_HISTORY) {
    await walletHandler.showWithdrawalHistory(user, chatId);
    return;
  }

  if (text === BTN.SEARCH) {
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: "SEARCH" },
    });
    await reply(
      user,
      chatId,
      "🔍 نام یا بخشی از نام محصول مورد نظرت را بنویس:",
      kb([[{ text: BTN.BACK_MAIN }]])
    );
    return;
  }

  if (user.orderStep === "SEARCH") {
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: null },
    });
    user = await reloadUser(user.id);
    await productsHandler.handleSearch(user, chatId, text);
    return;
  }

  if (text === BTN.BACK_PRODUCT_LIST) {
    await productsHandler.backToProductList(user, chatId);
    return;
  }

  if (text === BTN.PRODUCTS || text === BTN.BACK_PRODUCTS) {
    if (user.orderStep && user.orderStep.startsWith("CAT:")) {
      await prisma.user.update({
        where: { id: user.id },
        data: { orderStep: null },
      });
      user = await reloadUser(user.id);
    }
    await productsHandler(user, chatId);
    return;
  }

  if (text === BTN.CART) {
    await cartHandler.showCart(user, chatId);
    return;
  }

  if (text === BTN.CLEAR_CART) {
    await cartHandler.clearCart(user, chatId);
    return;
  }

  if (text === BTN.CHECKOUT) {
    await orderHandler.startCheckout(user, chatId);
    return;
  }

  if (text === BTN.ORDERS) {
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: null, pendingOrderId: null, adminStep: "VIEW_MY_ORDERS" },
    });
    user = await reloadUser(user.id);
    await orderHandler.showMyOrders(user, chatId);
    return;
  }

  if (text === BTN.ADD_CART) {
    await productsHandler.startAddToCart(user, chatId);
    return;
  }

  if (text === BTN.UPLOAD_RECEIPT) {
    let pendingId = user.pendingOrderId;

    if (!pendingId) {
      const pending = await prisma.order.findFirst({
        where: {
          userId: user.id,
          status: "WAITING_PAYMENT",
        },
        orderBy: { createdAt: "desc" },
      });
      pendingId = pending?.id;
    }

    if (!pendingId) {
      await reply(user, chatId, "سفارشی در انتظار پرداخت ندارید.");
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        orderStep: "UPLOAD_RECEIPT",
        pendingOrderId: pendingId,
      },
    });
    await reply(user, chatId, "📸 لطفاً اسکرین‌شات رسید پرداخت را ارسال کنید.");
    return;
  }

  if (text.startsWith("PL-") && !isAdmin(user)) {
    const shown = await orderHandler.showOrderByTracking(user, chatId, text);
    if (!shown) {
      await reply(user, chatId, "❌ سفارشی با این کد پیگیری یافت نشد.\nلطفاً کد را بررسی و دوباره ارسال کنید.");
    }
    return;
  }

  if (user.orderStep === "PRODUCT_QTY") {
    const qty = parseInt(text, 10);
    if (!qty || qty < 1 || qty > 999) {
      await reply(user, chatId, "لطفاً یک عدد معتبر (1 تا 999) وارد کنید.");
      return;
    }
    await productsHandler.addToCartWithQty(user, chatId, qty);
    return;
  }

  if (await walletHandler.handleWithdrawalStep(user, chatId, text)) {
    return;
  }

  if (text === BTN.CONFIRM_ADDRESS) {
    await orderHandler.confirmSavedAddress(user, chatId);
    return;
  }

  if (text === BTN.DELETE_ADDRESS) {
    await orderHandler.deleteSavedAddress(user, chatId);
    return;
  }

  if (await orderHandler.handleCheckoutStep(user, chatId, text)) {
    return;
  }

  const mainCat = PRODUCT_CATEGORIES.find((c) => c.btn === text);
  if (mainCat) {
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: `CAT:${mainCat.btn}` },
    });
    await productsHandler.showSubMenu(user, chatId, mainCat.btn);
    return;
  }

  if (user.orderStep && user.orderStep.startsWith("CAT:")) {
    const parentCatBtn = user.orderStep.replace("CAT:", "");
    const parentCat = PRODUCT_CATEGORIES.find((c) => c.btn === parentCatBtn);
    if (parentCat && parentCat.subMenus.includes(text)) {
      await productsHandler.showBrandProducts(user, chatId, parentCatBtn, text);
      return;
    }
  }

  let product = null;
  try {
    product = await productsHandler.loadProductByCode(text.trim().toUpperCase());
  } catch (err) {
    console.error("PRODUCT CODE LOOKUP SKIP:", err.message);
  }

  if (product) {
    await productsHandler.showProduct(user, chatId, product);
    return;
  }

  if (text.trim() === MARKETING_ACCESS_CODE) {
    await prisma.user.update({
      where: { id: user.id },
      data: { marketingEnabled: true },
    });
    user = await reloadUser(user.id);
    await reply(
      user,
      chatId,
      "✅ دسترسی به بازاریابی و کیف پول فعال شد.",
      mainMenu(user)
    );
    return;
  }

  await reply(
    user,
    chatId,
    "لطفاً از دکمه‌های منو استفاده کنید.\nبرای راهنما: 📖 راهنما"
  );
};

module.exports.handleCallbackQuery = async function handleCallbackQuery(cq, user) {
  const data = (cq.data || "").trim();
  const chatId = cq.message.chat.id;

  user = await reloadUser(user.id);

  if (data.startsWith("PL-")) {
    const shown = await orderHandler.showOrderByTracking(user, chatId, data);
    if (!shown) {
      await reply(user, chatId, "❌ سفارشی با این کد پیگیری یافت نشد.");
    }
    return;
  }

  if (data.startsWith("addr:view:")) {
    const addressId = data.replace("addr:view:", "");
    await orderHandler.handleSavedAddressView(user, chatId, addressId);
    return;
  }

  if (data === "addr:new") {
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: "CHECKOUT_NAME", tempAddressId: null },
    });
    await reply(
      user,
      chatId,
      "📝 ثبت سفارش\n\n👤 نام و نام خانوادگی گیرنده را وارد کنید:",
      backMain()
    );
    return;
  }

  if (data === "main:back") {
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: null, adminStep: null, pendingOrderId: null },
    });
    user = await reloadUser(user.id);
    await startHandler(user, { chat: { id: chatId } });
    return;
  }

  if (data === "cat:back") {
    await productsHandler(user, chatId);
    return;
  }

  if (data.startsWith("product:")) {
    const code = data.replace("product:", "");
    try {
      const product = await productsHandler.loadProductByCode(code);
      if (product) {
        await productsHandler.showProduct(user, chatId, product);
      } else {
        await reply(user, chatId, "خواندن این محصول ممکن نشد.");
      }
    } catch (err) {
      console.error("PRODUCT CALLBACK:", err);
      try {
        await bale.sendMessage(
          chatId,
          `نمایش این محصول با خطا مواجه شد.\n${err.message || ""}`.slice(0, 500)
        );
      } catch (err2) {
        console.error("PRODUCT CALLBACK REPLY:", err2);
      }
    }
    return;
  }

  if (data.startsWith("tkt:view:") && isAdmin(user)) {
    const ticketId = data.replace("tkt:view:", "");
    const support = require("./support");
    await support.adminShowTicket(user, chatId, ticketId);
    return;
  }

  if (data.startsWith("tkt:more:") && isAdmin(user)) {
    const offset = parseInt(data.replace("tkt:more:", ""), 10) || 0;
    const support = require("./support");
    await support.adminAnsweredTickets(user, chatId, offset);
    return;
  }

  if (data.startsWith("ordr:") && isAdmin(user)) {
    const orderId = data.replace("ordr:", "");
    await adminHandler.viewOrderById(user, chatId, orderId);
    return;
  }

  if (data.startsWith("wdr:") && isAdmin(user)) {
    const withdrawalId = data.replace("wdr:", "");
    await adminHandler.showWithdrawalDetail(user, chatId, withdrawalId);
    return;
  }

  if (data.startsWith("stats:") && isAdmin(user)) {
    const parts = data.split(":");
    const yearMonth = parts[1];
    const isLive = parts[2] === "live";
    await adminHandler.showMonthStats(user, chatId, yearMonth, isLive);
    return;
  }

  if (data.startsWith("rej_more:") && isAdmin(user)) {
    const offset = parseInt(data.replace("rej_more:", ""), 10) || 0;
    await adminHandler.showRejectedOrders(user, chatId, offset);
    return;
  }

  if (data.startsWith("shipd_more:") && isAdmin(user)) {
    const offset = parseInt(data.replace("shipd_more:", ""), 10) || 0;
    await adminHandler.showShippedOrders(user, chatId, offset);
    return;
  }

  if (data.startsWith("ship:snapp:") && isAdmin(user)) {
    const orderId = data.replace("ship:snapp:", "");
    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: "SHIP_SNAPP", pendingOrderId: orderId },
    });
    await reply(user, chatId,
      "🚗 ارسال با اسنپ\n\nاطلاعات را در یک پیام ارسال کنید:\nشماره تماس راننده، پلاک، مدل ماشین",
      backMain()
    );
    return;
  }

  if (data.startsWith("ship:post:") && isAdmin(user)) {
    const orderId = data.replace("ship:post:", "");
    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: "SHIP_POST", pendingOrderId: orderId },
    });
    await reply(user, chatId, "📦 ارسال با پست\n\nکد پیگیری مرسوله را وارد کنید:", backMain());
    return;
  }
};

module.exports.handlePhoto = async function handlePhoto(message, user) {
  const chatId = message.chat.id;
  user = await reloadUser(user.id);
  const photo = message.photo;

  if (!photo?.length) return;

  if (isAdmin(user) && (await adminHandler.handleAdminPhoto(user, chatId, photo))) {
    return;
  }

  if (await orderHandler.handleReceiptPhoto(user, chatId, photo)) {
    return;
  }

  await reply(user, chatId, "عکس دریافت شد ولی در این مرحله نیاز نیست.");
};
