const prisma = require("../database/prisma");
const { reply, replyPhoto } = require("../bot/messenger");
const bale = require("../bot/bale");
const {
  BTN,
  kb,
  inlineKb,
  productDetailMenu,
  PRODUCT_CATEGORIES,
  productCategoriesMenu,
  subMenuKb,
} = require("../keyboards/menus");
const {
  getUnitPrice,
  formatPrice,
  isWholesaleUser,
} = require("../utils/price");

const PRODUCT_LIST_SELECT = {
  id: true,
  code: true,
  title: true,
  costPrice: true,
  profitPercent: true,
  status: true,
  brand: true,
};

function productRow(product, wholesale) {
  const price = getUnitPrice(product, wholesale);
  const availability = product.status === "AVAILABLE" ? "🟢" : "🔴";
  let label = `${availability} ${product.title} | ${formatPrice(price)}`;
  if (label.length > 60) label = `${label.slice(0, 59)}…`;
  return [{ text: label, callback_data: `product:${product.code}` }];
}

async function sendProductInlineList(user, chatId, products, header) {
  const wholesale = isWholesaleUser(user);
  const rows = products.map((product) => productRow(product, wholesale));
  const chunkSize = 8;
  let lastId = null;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const title =
      i === 0
        ? header
        : `ادامه فهرست (${i + 1}–${Math.min(i + chunkSize, rows.length)}):`;
    const inlineResult = await bale.sendKeyboard(
      chatId,
      title,
      inlineKb(chunk)
    );
    if (!inlineResult?.ok) {
      console.error("INLINE PRODUCTS FAILED:", inlineResult);
      await reply(
        user,
        chatId,
        "فهرست محصولات ارسال نشد. لطفاً دوباره تلاش کنید."
      );
      return;
    }
    lastId = inlineResult?.result?.message_id || lastId;
  }

  if (lastId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastMessageId: lastId },
    });
  }
}

module.exports = async function productsHandler(user, chatId) {
  await reply(
    user,
    chatId,
    "🛍 دسته‌بندی مورد نظر را انتخاب کنید:",
    productCategoriesMenu()
  );
};

module.exports.showSubMenu = async function showSubMenu(user, chatId, categoryBtn) {
  const cat = PRODUCT_CATEGORIES.find((c) => c.btn === categoryBtn);
  if (!cat) {
    await reply(user, chatId, "دسته‌بندی پیدا نشد.");
    return;
  }
  await reply(
    user,
    chatId,
    `${categoryBtn}\n\nیکی از زیر دسته‌ها را انتخاب کنید:`,
    subMenuKb(cat.subMenus)
  );
};

module.exports.showBrandProducts = async function showBrandProducts(
  user,
  chatId,
  categoryBtn,
  brand
) {
  let category;
  let products;
  try {
    category = await prisma.category.findFirst({
      where: { title: categoryBtn },
    });
    if (!category) {
      await reply(user, chatId, "دسته‌بندی پیدا نشد.");
      return;
    }
    products = await prisma.product.findMany({
      where: { categoryId: category.id, brand },
      orderBy: { title: "asc" },
      select: PRODUCT_LIST_SELECT,
    });
  } catch (err) {
    console.error("BRAND PRODUCTS QUERY:", err);
    await reply(
      user,
      chatId,
      "خواندن محصولات از دیتابیس ممکن نشد. لطفاً دوباره تلاش کنید.",
      kb([[{ text: BTN.BACK_PRODUCTS }], [{ text: BTN.BACK_MAIN }]])
    );
    return;
  }

  if (products.length === 0) {
    await reply(
      user,
      chatId,
      `📦 محصولات «${brand}»\nدسته: ${categoryBtn}\n\nمحصولی در این بخش یافت نشد.`,
      subMenuKb(
        (PRODUCT_CATEGORIES.find((c) => c.btn === categoryBtn) || { subMenus: [] }).subMenus
      )
    );
    return;
  }

  await reply(
    user,
    chatId,
    `📂 ${categoryBtn} › ${brand}`,
    kb([
      [{ text: BTN.BACK_PRODUCTS }],
      [{ text: BTN.BACK_MAIN }],
    ])
  );

  await sendProductInlineList(
    user,
    chatId,
    products,
    `${products.length} محصول — روی هر محصول برای جزئیات کلیک کنید:`
  );
};

module.exports.showCategory = async function showCategory(
  user,
  chatId,
  categoryTitle
) {
  let category;
  let products;
  try {
    category = await prisma.category.findFirst({
      where: { title: categoryTitle },
    });
    if (!category) {
      await reply(user, chatId, "دسته‌بندی پیدا نشد.");
      return;
    }
    products = await prisma.product.findMany({
      where: { categoryId: category.id },
      orderBy: { title: "asc" },
      select: PRODUCT_LIST_SELECT,
    });
  } catch (err) {
    console.error("CATEGORY PRODUCTS QUERY:", err);
    await reply(
      user,
      chatId,
      "خواندن محصولات از دیتابیس ممکن نشد. لطفاً دوباره تلاش کنید.",
      kb([[{ text: BTN.BACK_PRODUCTS }], [{ text: BTN.BACK_MAIN }]])
    );
    return;
  }

  if (products.length === 0) {
    await reply(user, chatId, "در این دسته محصولی وجود ندارد.");
    return;
  }

  await reply(
    user,
    chatId,
    `📂 ${category.title}`,
    kb([
      [{ text: BTN.BACK_PRODUCTS }],
      [{ text: BTN.BACK_MAIN }],
    ])
  );

  await sendProductInlineList(
    user,
    chatId,
    products,
    `${products.length} محصول — روی هر محصول برای جزئیات کلیک کنید:`
  );
};

module.exports.showProduct = async function showProduct(
  user,
  chatId,
  product
) {
  const wholesale = isWholesaleUser(user);
  const price = getUnitPrice(product, wholesale);
  const status =
    product.status === "AVAILABLE" ? "🟢 موجود" : "🔴 ناموجود";

  await prisma.user.update({
    where: { id: user.id },
    data: { lastProductCode: product.code },
  });

  const caption = `📦 ${product.title}

🔖 کد: ${product.code}
🏷 دسته: ${product.category.title}
💰 قیمت: ${formatPrice(price)}
${wholesale ? "🤝 قیمت همکار" : "🛒 قیمت مصرف‌کننده"}
${status}

📝 ${product.description || "بدون توضیحات"}

${
  product.status === "AVAILABLE"
    ? "برای انتخاب محصول از دکمه \"افزودن به سبد\" استفاده نمایید."
    : "این محصول ناموجود است."
}`;

  if (product.imageUrl) {
    await replyPhoto(
      user,
      chatId,
      product.imageUrl,
      caption,
      productDetailMenu(product)
    );
  } else {
    await reply(
      user,
      chatId,
      caption,
      productDetailMenu(product)
    );
  }
};

module.exports.backToProductList = async function backToProductList(user, chatId) {
  if (!user.lastProductCode) {
    await module.exports(user, chatId);
    return;
  }

  const product = await prisma.product.findUnique({
    where: { code: user.lastProductCode },
    include: { category: true },
  });

  if (!product?.category?.title || !product.brand) {
    await module.exports(user, chatId);
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: `CAT:${product.category.title}` },
  });
  user.orderStep = `CAT:${product.category.title}`;

  await module.exports.showBrandProducts(
    user,
    chatId,
    product.category.title,
    product.brand
  );
};

module.exports.handleSearch = async function handleSearch(user, chatId, query) {
  const term = (query || "").trim();
  if (!term || term.length < 2) {
    await reply(user, chatId, "⚠️ حداقل ۲ حرف وارد کن.", kb([[{ text: BTN.BACK_MAIN }]]));
    return;
  }

  let products;
  try {
    products = await prisma.product.findMany({
      where: {
        title: { contains: term, mode: "insensitive" },
        status: "AVAILABLE",
      },
      orderBy: { title: "asc" },
      take: 30,
      select: PRODUCT_LIST_SELECT,
    });
  } catch (err) {
    console.error("SEARCH PRODUCTS QUERY:", err);
    await reply(
      user,
      chatId,
      "خواندن محصولات از دیتابیس ممکن نشد. لطفاً دوباره تلاش کنید.",
      kb([[{ text: BTN.SEARCH }], [{ text: BTN.BACK_MAIN }]])
    );
    return;
  }

  if (products.length === 0) {
    await reply(
      user,
      chatId,
      `🔍 نتیجه‌ای برای «${term}» یافت نشد.\nنام دیگری امتحان کن.`,
      kb([[{ text: BTN.SEARCH }], [{ text: BTN.BACK_MAIN }]])
    );
    return;
  }

  await reply(
    user,
    chatId,
    `🔍 نتایج جستجو برای «${term}» — ${products.length} محصول:`,
    kb([[{ text: BTN.SEARCH }], [{ text: BTN.BACK_MAIN }]])
  );

  await sendProductInlineList(
    user,
    chatId,
    products,
    "روی هر محصول برای جزئیات کلیک کنید:"
  );
};

module.exports.startAddToCart = async function startAddToCart(user, chatId) {
  if (!user.lastProductCode) {
    await reply(user, chatId, "محصولی انتخاب نشده است.");
    return;
  }

  const product = await prisma.product.findUnique({
    where: { code: user.lastProductCode },
  });

  if (!product || product.status !== "AVAILABLE") {
    await reply(user, chatId, "این محصول موجود نیست.");
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: "PRODUCT_QTY" },
  });

  await reply(
    user,
    chatId,
    "🔢 تعداد مورد نظر را وارد کنید (عدد):",
    kb([[{ text: BTN.BACK_MAIN }]])
  );
};

module.exports.addToCartWithQty = async function addToCartWithQty(
  user,
  chatId,
  quantity
) {
  const product = await prisma.product.findUnique({
    where: { code: user.lastProductCode },
  });

  if (!product || product.status !== "AVAILABLE") {
    await reply(user, chatId, "محصول موجود نیست.");
    return;
  }

  let cart = await prisma.cart.findUnique({
    where: { userId: user.id },
  });

  if (!cart) {
    cart = await prisma.cart.create({
      data: { userId: user.id },
    });
  }

  const existing = await prisma.cartItem.findFirst({
    where: { cartId: cart.id, productId: product.id },
  });

  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: existing.quantity + quantity },
    });
  } else {
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: product.id,
        quantity,
      },
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: null },
  });

  await reply(
    user,
    chatId,
    `✅ ${quantity} عدد «${product.title}» به سبد اضافه شد.`,
    kb([
      [{ text: BTN.CART }],
      [{ text: BTN.PRODUCTS }],
      [{ text: BTN.BACK_MAIN }],
    ])
  );
};
