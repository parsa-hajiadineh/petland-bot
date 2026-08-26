const { Prisma } = require("@prisma/client");
const prisma = require("../database/prisma");
const { PRODUCT_SAFE_SELECT } = require("../database/selects");
const { reply } = require("../bot/messenger");
const { BTN, cartMenu, backMain, kb } = require("../keyboards/menus");
const { getUnitPrice, formatPrice } = require("../utils/price");
const { ensureShopRuntimeTables } = require("./shopProvision");

function newId() {
  return `sc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

async function getCartRow(userId, tenantId) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM "ShopCart"
    WHERE "userId" = ${userId} AND "tenantId" = ${tenantId}
    LIMIT 1
  `;
  return rows?.[0] || null;
}

async function getCartWithItems(userId, tenantId) {
  await ensureShopRuntimeTables().catch((err) => {
    console.error("SHOP CART TABLES:", err.message);
  });
  const cart = await getCartRow(userId, tenantId);
  if (!cart) return null;

  const itemRows = await prisma.$queryRaw`
    SELECT id, quantity, "productId" FROM "ShopCartItem" WHERE "cartId" = ${cart.id}
  `;
  if (!itemRows?.length) return { id: cart.id, items: [] };

  const products = await prisma.product.findMany({
    where: { id: { in: itemRows.map((row) => row.productId) } },
    select: PRODUCT_SAFE_SELECT,
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  return {
    id: cart.id,
    items: itemRows
      .map((row) => ({
        id: row.id,
        quantity: row.quantity,
        productId: row.productId,
        product: byId.get(row.productId),
      }))
      .filter((item) => item.product),
  };
}

async function getOrCreateCart(userId, tenantId) {
  await ensureShopRuntimeTables().catch((err) => {
    console.error("SHOP CART TABLES:", err.message);
  });
  let cart = await getCartRow(userId, tenantId);
  if (!cart) {
    const id = newId();
    await prisma.$executeRaw`
      INSERT INTO "ShopCart" ("id", "userId", "tenantId", "createdAt")
      VALUES (${id}, ${userId}, ${tenantId}, NOW())
    `;
    cart = { id };
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
  const existing = await prisma.$queryRaw`
    SELECT id, quantity FROM "ShopCartItem"
    WHERE "cartId" = ${cart.id} AND "productId" = ${product.id}
    LIMIT 1
  `;
  const row = existing?.[0];
  if (row) {
    await prisma.$executeRaw`
      UPDATE "ShopCartItem"
      SET quantity = ${row.quantity + quantity}
      WHERE id = ${row.id}
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO "ShopCartItem" ("id", "quantity", "cartId", "productId")
      VALUES (${newId()}, ${quantity}, ${cart.id}, ${product.id})
    `;
  }
}

async function clearItems(cartId) {
  if (!cartId) return;
  await prisma.$executeRaw`DELETE FROM "ShopCartItem" WHERE "cartId" = ${cartId}`;
}

async function deleteItemsForProducts(productIds) {
  if (!productIds?.length) return;
  await prisma.$executeRaw`
    DELETE FROM "ShopCartItem" WHERE "productId" IN (${Prisma.join(productIds)})
  `;
}

async function showCart(user, chatId, tenantId) {
  let cart;
  try {
    cart = await getCartWithItems(user.id, tenantId);
  } catch (err) {
    console.error("SHOW SHOP CART:", err);
    await reply(
      user,
      chatId,
      "خواندن سبد خرید ممکن نشد. لطفاً دوباره تلاش کنید.",
      backMain()
    );
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
  await clearItems(cart.id);
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
  clearItems,
  deleteItemsForProducts,
  validateCheckout,
  calcCartTotal,
};
