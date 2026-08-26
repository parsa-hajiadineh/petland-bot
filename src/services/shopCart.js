const prisma = require("../database/prisma");
const { CART_ITEMS_SELECT } = require("../database/selects");
const { reply } = require("../bot/messenger");
const { BTN, cartMenu, backMain, kb } = require("../keyboards/menus");
const { getUnitPrice, formatPrice } = require("../utils/price");
const { ensureShopRuntimeTables } = require("./shopProvision");

async function getCartWithItems(userId, tenantId) {
  await ensureShopRuntimeTables().catch((err) => {
    console.error("SHOP CART TABLES:", err.message);
  });
  if (typeof prisma.shopCart?.findUnique !== "function") {
    const err = new Error("ShopCart client missing");
    err.code = "SHOP_CART_CLIENT";
    throw err;
  }
  return prisma.shopCart.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    include: {
      items: { select: CART_ITEMS_SELECT },
    },
  });
}

async function getOrCreateCart(userId, tenantId) {
  await ensureShopRuntimeTables().catch((err) => {
    console.error("SHOP CART TABLES:", err.message);
  });
  if (typeof prisma.shopCart?.findUnique !== "function") {
    const err = new Error("ShopCart client missing");
    err.code = "SHOP_CART_CLIENT";
    throw err;
  }
  let cart = await prisma.shopCart.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
  });
  if (!cart) {
    cart = await prisma.shopCart.create({
      data: { userId, tenantId },
    });
  }
  return cart;
}

function calcCartTotal(items) {
  return items.reduce((sum, item) => {
    const unit = getUnitPrice(item.product, false);
    return sum + unit * item.quantity;
  }, 0);
}

async function addItem(userId, tenantId, product, quantity) {
  const cart = await getOrCreateCart(userId, tenantId);
  const existing = await prisma.shopCartItem.findFirst({
    where: { cartId: cart.id, productId: product.id },
  });
  if (existing) {
    await prisma.shopCartItem.update({
      where: { id: existing.id },
      data: { quantity: existing.quantity + quantity },
    });
  } else {
    await prisma.shopCartItem.create({
      data: {
        cartId: cart.id,
        productId: product.id,
        quantity,
      },
    });
  }
}

async function showCart(user, chatId, tenantId) {
  let cart;
  try {
    cart = await getCartWithItems(user.id, tenantId);
  } catch (err) {
    console.error("SHOW SHOP CART:", err);
    const msg =
      err.code === "SHOP_CART_CLIENT"
        ? "سبد این فروشگاه بعد از به‌روزرسانی ربات فعال می‌شود. لطفاً کمی بعد دوباره تلاش کنید."
        : "خواندن سبد خرید ممکن نشد. لطفاً دوباره تلاش کنید.";
    await reply(user, chatId, msg, backMain());
    return;
  }

  if (!cart?.items?.length) {
    await reply(
      user,
      chatId,
      "🛒 سبد خرید شما خالی است.",
      kb([[{ text: BTN.PRODUCTS }], [{ text: BTN.BACK_MAIN }]])
    );
    return;
  }

  let text = "🛒 سبد خرید\n\n";
  let total = 0;

  for (const item of cart.items) {
    const unit = getUnitPrice(item.product, false);
    const line = unit * item.quantity;
    total += line;
    text += `📦 ${item.product.title}\n`;
    text += `🔖 ${item.product.code}\n`;
    text += `تعداد: ${item.quantity} | واحد: ${formatPrice(unit)}\n`;
    text += `جمع: ${formatPrice(line)}\n\n`;
  }

  text += `💰 جمع کل: ${formatPrice(total)}`;
  await reply(user, chatId, text, cartMenu());
}

async function clearCart(user, chatId, tenantId) {
  const cart = await getCartWithItems(user.id, tenantId);
  if (!cart) {
    await reply(user, chatId, "سبد خرید خالی است.", backMain());
    return;
  }
  await prisma.shopCartItem.deleteMany({ where: { cartId: cart.id } });
  await reply(
    user,
    chatId,
    "✅ سبد خرید خالی شد.",
    kb([[{ text: BTN.PRODUCTS }], [{ text: BTN.BACK_MAIN }]])
  );
}

async function validateCheckout(userId, tenantId) {
  const cart = await getCartWithItems(userId, tenantId);
  if (!cart?.items?.length) {
    return { ok: false, message: "سبد خرید خالی است." };
  }
  for (const item of cart.items) {
    if (item.product.status !== "AVAILABLE") {
      return {
        ok: false,
        message: `محصول «${item.product.title}» ناموجود است.`,
      };
    }
  }
  return {
    ok: true,
    items: cart.items,
    total: calcCartTotal(cart.items),
    cartId: cart.id,
  };
}

module.exports = {
  getCartWithItems,
  getOrCreateCart,
  addItem,
  showCart,
  clearCart,
  validateCheckout,
  calcCartTotal,
};
