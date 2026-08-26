const prisma = require("../database/prisma");
const {
  COLLEAGUE_ACCESS_CODE,
  WHOLESALE_MIN_ORDER,
  BOT_TOKEN,
} = require("../config");
const { reply } = require("../bot/messenger");
const bale = require("../bot/bale");
const { BTN, mainMenu, backMain, kb } = require("../keyboards/menus");
const { formatPrice } = require("../utils/price");
const { encryptToken, hashToken } = require("../utils/tokenCrypto");

function shopTypeMenu() {
  return kb([
    [{ text: BTN.SHOP_ONLINE }],
    [{ text: BTN.SHOP_PHYSICAL }],
    [{ text: BTN.BACK_MAIN }],
  ]);
}

async function getOwnedTenant(userId) {
  try {
    return await prisma.tenant.findUnique({
      where: { ownerUserId: userId },
      include: { bot: true },
    });
  } catch (err) {
    console.error("TENANT LOOKUP SKIP:", err.message);
    return null;
  }
}

async function startProfile(user, chatId) {
  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: "COLLEAGUE_NAME" },
  });
  user.orderStep = "COLLEAGUE_NAME";

  await reply(
    user,
    chatId,
    "برای تکمیل حساب همکار این اطلاعات را وارد کنید.\n\n👤 نام و نام خانوادگی:",
    backMain()
  );
}

async function finishProfile(user, chatId, extra) {
  const fullName = (user.fullName || "").trim();
  const phone = (user.phone || "").trim();
  const brand = (user.tempDescription || "").trim();
  const isOnline = user.tempProvince === "ONLINE";

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.tenant.findUnique({
        where: { ownerUserId: user.id },
      });
      if (existing) return;

      const tenant = await tx.tenant.create({
        data: {
          name: brand,
          type: isOnline ? "ONLINE_SHOP" : "PET_SHOP",
          status: "ACTIVE",
          ownerName: fullName,
          phone,
          address: isOnline ? null : extra,
          pageName: isOnline ? extra : null,
          pageDetails: isOnline ? extra : null,
          ownerUserId: user.id,
        },
      });

      await tx.tenantSettings.create({
        data: {
          tenantId: tenant.id,
          shopName: brand,
          supportPhone: phone,
        },
      });

      await tx.tenantMember.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          role: "OWNER",
        },
      });

      await tx.customer.create({
        data: {
          type: "COLLEAGUE",
          fullName,
          phone,
          shopName: brand,
          address: isOnline ? null : extra,
          notes: isOnline ? extra : null,
          userId: user.id,
          tenantId: tenant.id,
        },
      });
    });
  } catch (err) {
    console.error("COLLEAGUE PROFILE SAVE:", err);
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: null },
    });
    await reply(
      user,
      chatId,
      "ثبت اطلاعات الان ممکن نشد. از منوی اصلی می‌توانید ادامه دهید و بعداً دوباره تلاش کنید.",
      mainMenu(user)
    );
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      orderStep: null,
      tempDescription: null,
      tempAddress: null,
      tempProvince: null,
    },
  });
  user.orderStep = null;

  await reply(
    user,
    chatId,
    `✅ اطلاعات همکار ثبت شد.

🏷 برند: ${brand}
👤 ${fullName}
📞 ${phone}
${isOnline ? `🌐 ${extra}` : `📍 ${extra}`}`,
    mainMenu(user)
  );
}

async function startBotCreate(user, chatId) {
  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: "BOT_CREATE_TOKEN" },
  });
  user.orderStep = "BOT_CREATE_TOKEN";

  await reply(
    user,
    chatId,
    `🤖 ساخت ربات فروشگاهی

آموزش دریافت Token در بله:
۱. در بله به @botfather بروید
۲. دستور /newbot را بزنید
۳. نام نمایشی و یوزرنیم ربات را وارد کنید
۴. Token را کپی کنید

حالا Token را در همین چت ارسال کنید.`,
    backMain()
  );
}

async function registerBot(user, chatId, rawToken) {
  const token = (rawToken || "").trim();
  const tenant = await getOwnedTenant(user.id);

  if (!tenant) {
    await startProfile(user, chatId);
    return;
  }

  if (tenant.bot) {
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: null },
    });
    await reply(
      user,
      chatId,
      `ربات این فروشگاه قبلاً ثبت شده است${
        tenant.bot.username ? `: @${tenant.bot.username}` : ""
      }.`,
      mainMenu(user)
    );
    return;
  }

  if (!token || token.length < 20) {
    await reply(
      user,
      chatId,
      "❌ Token نامعتبر است. لطفاً Token کامل را ارسال کنید.",
      backMain()
    );
    return;
  }

  if (BOT_TOKEN && token === BOT_TOKEN) {
    await reply(
      user,
      chatId,
      "❌ این Token مربوط به ربات مادر است. Token ربات خودتان را ارسال کنید.",
      backMain()
    );
    return;
  }

  const me = await bale.getMeWithToken(token);
  if (!me?.ok || !me.result?.id) {
    await reply(
      user,
      chatId,
      "❌ اعتبارسنجی Token ناموفق بود. Token را بررسی کنید و دوباره ارسال کنید.",
      backMain()
    );
    return;
  }

  try {
    const tokenHash = hashToken(token);
    const existing = await prisma.bot.findUnique({ where: { tokenHash } });
    if (existing) {
      await reply(user, chatId, "❌ این Token قبلاً ثبت شده است.", backMain());
      return;
    }

    await prisma.bot.create({
      data: {
        tenantId: tenant.id,
        token: encryptToken(token),
        tokenHash,
        username: me.result.username || null,
        baleBotId: String(me.result.id),
        status: "ACTIVE",
        isEnabled: true,
        activatedAt: new Date(),
      },
    });

    await prisma.tenantSettings.upsert({
      where: { tenantId: tenant.id },
      create: {
        tenantId: tenant.id,
        shopName: tenant.name,
        supportPhone: tenant.phone,
      },
      update: {},
    });
  } catch (err) {
    console.error("BOT REGISTER:", err);
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: null },
    });
    await reply(
      user,
      chatId,
      "ثبت ربات الان ممکن نشد. بعداً دوباره از دکمه ساخت ربات تلاش کنید.",
      mainMenu(user)
    );
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: null },
  });

  const username = me.result.username ? `@${me.result.username}` : "";
  await reply(
    user,
    chatId,
    `✅ ربات ثبت شد.
${username}

این ربات متعلق به فروشگاه «${tenant.name}» است.`,
    mainMenu(user)
  );

  setImmediate(() => {
    require("../bot/engine")
      .syncTenantBots()
      .catch((err) => {
        console.error("BOT SYNC AFTER REGISTER:", err.message);
      });
  });
}

module.exports = async function colleagueHandler(user, chatId, text) {
  if (text === BTN.COLLEAGUE) {
    await reply(
      user,
      chatId,
      `🤝 خرید همکار ${formatPrice(WHOLESALE_MIN_ORDER).replace(" تومان", "")} تومان

در حالت همکار:
• قیمت‌ها = قیمت همکاری (بدون سود)
• حداقل سفارش: ${formatPrice(WHOLESALE_MIN_ORDER)}
• مناسب فروشندگان و همکاران

🔐 لطفاً کد دسترسی همکار را وارد کنید:`,
      backMain()
    );

    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: "COLLEAGUE_CODE" },
    });

    return true;
  }

  if (text === BTN.RETAIL_MODE) {
    await prisma.user.update({
      where: { id: user.id },
      data: { role: "CUSTOMER", orderStep: null },
    });

    user.role = "CUSTOMER";

    await reply(
      user,
      chatId,
      "✅ به حالت خرید عادی بازگشتید.",
      mainMenu(user)
    );

    return true;
  }

  if (text === BTN.CREATE_SHOP_BOT) {
    if (user.role !== "COLLEAGUE") return false;

    const tenant = await getOwnedTenant(user.id);
    if (!tenant) {
      await startProfile(user, chatId);
      return true;
    }
    if (tenant.bot) {
      await reply(
        user,
        chatId,
        `ربات این فروشگاه قبلاً ثبت شده است${
          tenant.bot.username ? `: @${tenant.bot.username}` : ""
        }.`,
        mainMenu(user)
      );
      return true;
    }
    await startBotCreate(user, chatId);
    return true;
  }

  if (user.orderStep === "COLLEAGUE_CODE") {
    if (text.trim() !== COLLEAGUE_ACCESS_CODE) {
      await reply(
        user,
        chatId,
        "❌ کد دسترسی اشتباه است. دوباره تلاش کنید یا به منوی اصلی برگردید.",
        backMain()
      );
      return true;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { role: "COLLEAGUE", orderStep: null },
    });
    user.role = "COLLEAGUE";

    await reply(
      user,
      chatId,
      `✅ حالت خرید همکار فعال شد.

قیمت‌ها به صورت همکاری نمایش داده می‌شوند.
حداقل مبلغ سفارش: ${formatPrice(WHOLESALE_MIN_ORDER)}

📦 راهنمای خرید همکار:
• می‌توانید آدرس مشتری خودتان را مستقیم وارد کنید
• محصول را به هر قیمتی که صلاح می‌دانید به مشتریتان بفروشید
• تسویه با ما به قیمت همکاری انجام می‌شود
• فاکتور برای مشتریان همکاران ارسال نمی‌شود — فاکتور فقط در همین چت قابل مشاهده است`
    );

    const tenant = await getOwnedTenant(user.id);
    if (!tenant) {
      await startProfile(user, chatId);
    } else {
      await reply(user, chatId, "از منوی زیر استفاده کنید:", mainMenu(user));
    }

    return true;
  }

  if (user.orderStep === "COLLEAGUE_NAME") {
    const name = text.trim();
    if (!name) {
      await reply(user, chatId, "لطفاً نام و نام خانوادگی را وارد کنید.", backMain());
      return true;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { fullName: name, orderStep: "COLLEAGUE_PHONE" },
    });
    user.fullName = name;
    user.orderStep = "COLLEAGUE_PHONE";
    await reply(user, chatId, "📞 شماره تماس:", backMain());
    return true;
  }

  if (user.orderStep === "COLLEAGUE_PHONE") {
    const phone = text.trim();
    if (!phone) {
      await reply(user, chatId, "لطفاً شماره تماس را وارد کنید.", backMain());
      return true;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { phone, orderStep: "COLLEAGUE_BRAND" },
    });
    user.phone = phone;
    user.orderStep = "COLLEAGUE_BRAND";
    await reply(user, chatId, "🏷 نام برند:", backMain());
    return true;
  }

  if (user.orderStep === "COLLEAGUE_BRAND") {
    const brand = text.trim();
    if (!brand) {
      await reply(user, chatId, "لطفاً نام برند را وارد کنید.", backMain());
      return true;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { tempDescription: brand, orderStep: "COLLEAGUE_SHOP_TYPE" },
    });
    user.tempDescription = brand;
    user.orderStep = "COLLEAGUE_SHOP_TYPE";
    await reply(user, chatId, "نوع فروشگاه را انتخاب کنید:", shopTypeMenu());
    return true;
  }

  if (user.orderStep === "COLLEAGUE_SHOP_TYPE") {
    if (text === BTN.SHOP_ONLINE) {
      await prisma.user.update({
        where: { id: user.id },
        data: { tempProvince: "ONLINE", orderStep: "COLLEAGUE_PAGE" },
      });
      user.tempProvince = "ONLINE";
      user.orderStep = "COLLEAGUE_PAGE";
      await reply(user, chatId, "🌐 نام و مشخصات پیج را ارسال کنید:", backMain());
      return true;
    }
    if (text === BTN.SHOP_PHYSICAL) {
      await prisma.user.update({
        where: { id: user.id },
        data: { tempProvince: "PHYSICAL", orderStep: "COLLEAGUE_ADDRESS" },
      });
      user.tempProvince = "PHYSICAL";
      user.orderStep = "COLLEAGUE_ADDRESS";
      await reply(user, chatId, "📍 آدرس فروشگاه را ارسال کنید:", backMain());
      return true;
    }
    await reply(user, chatId, "لطفاً یکی از دکمه‌ها را انتخاب کنید.", shopTypeMenu());
    return true;
  }

  if (user.orderStep === "COLLEAGUE_PAGE") {
    const page = text.trim();
    if (!page) {
      await reply(user, chatId, "لطفاً نام و مشخصات پیج را ارسال کنید.", backMain());
      return true;
    }
    await finishProfile(user, chatId, page);
    return true;
  }

  if (user.orderStep === "COLLEAGUE_ADDRESS") {
    const address = text.trim();
    if (!address) {
      await reply(user, chatId, "لطفاً آدرس فروشگاه را ارسال کنید.", backMain());
      return true;
    }
    await finishProfile(user, chatId, address);
    return true;
  }

  if (user.orderStep === "BOT_CREATE_TOKEN") {
    await registerBot(user, chatId, text);
    return true;
  }

  return false;
};
