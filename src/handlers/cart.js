const prisma = require("../database/prisma");
const { CART_ITEMS_SELECT } = require("../database/selects");
const { reply } = require("../bot/messenger");
const { BTN, cartMenu, backMain } = require("../keyboards/menus");
const {
  getUnitPrice,
  formatPrice,
  isWholesaleUser,
  getMinOrderAmount,
} = require("../utils/price");

async function getCartWithItems(userId) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      cart: {
        include: {
          items: {
            select: CART_ITEMS_SELECT,
          },
        },
      },
    },
  });
}

function calcCartTotal(items, wholesale) {
  return items.reduce((sum, item) => {
    const unit = getUnitPrice(item.product, wholesale);
    return sum + unit * item.quantity;
  }, 0);
}

module.exports.getCartTotal = calcCartTotal;

module.exports.showCart = async function showCart(user, chatId) {
  let data;
  try {
    data = await getCartWithItems(user.id);
  } catch (err) {
    console.error("SHOW CART:", err);
    await reply(user, chatId, "خواندن سبد خرید ممکن نشد. لطفاً دوباره تلاش کنید.", backMain());
    return;
  }

  if (!data?.cart?.items?.length) {
    await reply(user, chatId, "🛒 سبد خرید شما خالی است.", backMain());
    return;
  }

  const wholesale = isWholesaleUser(user);
  let text = "🛒 سبد خرید\n\n";
  let total = 0;

  for (const item of data.cart.items) {
    const unit = getUnitPrice(item.product, wholesale);
    const line = unit * item.quantity;
    total += line;

    text += `📦 ${item.product.title}\n`;
    text += `🔖 ${item.product.code}\n`;
    text += `تعداد: ${item.quantity} | واحد: ${formatPrice(unit)}\n`;
    text += `جمع: ${formatPrice(line)}\n\n`;
  }

  text += `💰 جمع کل: ${formatPrice(total)}`;

  if (wholesale) {
    const minOrder = getMinOrderAmount(user);
    if (minOrder > 0) {
      text += `\n🤝 حداقل سفارش همکار: ${formatPrice(minOrder)}`;
    }
  }

  await reply(user, chatId, text, cartMenu());
};

module.exports.clearCart = async function clearCart(user, chatId) {
  const data = await getCartWithItems(user.id);

  if (!data?.cart) {
    await reply(user, chatId, "سبد خرید خالی است.");
    return;
  }

  await prisma.cartItem.deleteMany({
    where: { cartId: data.cart.id },
  });

  await reply(user, chatId, "✅ سبد خرید خالی شد.");
};

module.exports.validateCheckout = async function validateCheckout(user) {
  const data = await getCartWithItems(user.id);

  if (!data?.cart?.items?.length) {
    return { ok: false, message: "سبد خرید خالی است." };
  }

  const wholesale = isWholesaleUser(user);
  const total = calcCartTotal(data.cart.items, wholesale);
  const min = getMinOrderAmount(user);

  if (wholesale && total < min) {
    return {
      ok: false,
      message: `حداقل مبلغ سفارش همکار ${formatPrice(min)} است.\nمبلغ فعلی: ${formatPrice(total)}`,
    };
  }

  for (const item of data.cart.items) {
    if (item.product.status !== "AVAILABLE") {
      return {
        ok: false,
        message: `محصول «${item.product.title}» ناموجود است.`,
      };
    }
  }

  return { ok: true, items: data.cart.items, total, wholesale };
};
