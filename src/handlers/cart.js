const prisma = require("../database/prisma");
const { CART_ITEMS_SELECT } = require("../database/selects");
const { reply } = require("../bot/messenger");
const { cartMenu, backMain } = require("../keyboards/menus");
const {
  getUnitPrice,
  formatPrice,
  isWholesaleUser,
  getMinOrderAmount,
} = require("../utils/price");
const { MOTHER_STEP, PROMPT, sendEditList } = require("../utils/cartEdit");

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

function editItemId(user) {
  const raw = String(user.tempDescription || "");
  return raw.startsWith("CE:") ? raw.slice(3) : "";
}

async function clearEditStep(user) {
  if (user.orderStep !== MOTHER_STEP) return;
  const data = { orderStep: null };
  if (String(user.tempDescription || "").startsWith("CE:")) {
    data.tempDescription = null;
  }
  await prisma.user.update({
    where: { id: user.id },
    data,
  });
  user.orderStep = null;
  if (data.tempDescription !== undefined) user.tempDescription = null;
}

module.exports.showCart = async function showCart(user, chatId) {
  await clearEditStep(user);
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
  await clearEditStep(user);
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

module.exports.showEditList = async function showEditList(user, chatId, offset = 0) {
  await clearEditStep(user);
  let data;
  try {
    data = await getCartWithItems(user.id);
  } catch (err) {
    console.error("EDIT CART LIST:", err);
    await reply(user, chatId, "خواندن سبد خرید ممکن نشد. لطفاً دوباره تلاش کنید.", backMain());
    return;
  }
  await sendEditList(user, chatId, data?.cart?.items || [], offset);
};

module.exports.startEditItem = async function startEditItem(user, chatId, itemId) {
  const data = await getCartWithItems(user.id);
  const item = data?.cart?.items?.find((row) => row.id === itemId);
  if (!item) {
    await reply(user, chatId, "این محصول در سبد خرید شما نیست.", cartMenu());
    return;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: MOTHER_STEP, tempDescription: `CE:${itemId}` },
  });
  user.orderStep = MOTHER_STEP;
  user.tempDescription = `CE:${itemId}`;
  await reply(user, chatId, PROMPT, cartMenu());
};

module.exports.applyEditQty = async function applyEditQty(user, chatId, qty) {
  const itemId = editItemId(user);
  const data = await getCartWithItems(user.id);
  const item = data?.cart?.items?.find((row) => row.id === itemId);

  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: null, tempDescription: null },
  });
  user.orderStep = null;
  user.tempDescription = null;

  if (!item) {
    await reply(user, chatId, "این محصول در سبد خرید شما نیست.", backMain());
    return;
  }

  if (qty === 0) {
    await prisma.cartItem.delete({ where: { id: item.id } });
  } else {
    await prisma.cartItem.update({
      where: { id: item.id },
      data: { quantity: qty },
    });
  }

  await module.exports.showCart(user, chatId);
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
