const prisma = require("../database/prisma");
const {
  COLLEAGUE_ACCESS_CODE,
  WHOLESALE_MIN_ORDER,
} = require("../config");
const { reply } = require("../bot/messenger");
const { BTN, mainMenu, backMain, kb } = require("../keyboards/menus");
const { formatPrice } = require("../utils/price");
const { provisionShop } = require("../services/shopProvision");

const PROFILE_STEPS = [
  "COLLEAGUE_NAME",
  "COLLEAGUE_PHONE",
  "COLLEAGUE_BRAND",
  "COLLEAGUE_SHOP_TYPE",
  "COLLEAGUE_PAGE",
  "COLLEAGUE_ADDRESS",
  "COLLEAGUE_CONFIRM",
];

function profileNavKb() {
  return kb([[{ text: BTN.BACK_QUESTION }], [{ text: BTN.BACK_MAIN }]]);
}

function shopTypeMenu() {
  return kb([
    [{ text: BTN.SHOP_ONLINE }],
    [{ text: BTN.SHOP_PHYSICAL }],
    [{ text: BTN.SHOP_BOTH }],
    [{ text: BTN.BACK_QUESTION }],
    [{ text: BTN.BACK_MAIN }],
  ]);
}

function confirmMenu() {
  return kb([
    [{ text: BTN.CONFIRM_PROFILE }],
    [{ text: BTN.BACK_QUESTION }],
    [{ text: BTN.BACK_MAIN }],
  ]);
}

function shopModeLabel(mode) {
  if (mode === "ONLINE") return "آنلاین";
  if (mode === "PHYSICAL") return "حضوری";
  if (mode === "BOTH") return "آنلاین و حضوری";
  return "نامشخص";
}

function tenantTypeFor(mode) {
  if (mode === "ONLINE") return "ONLINE_SHOP";
  if (mode === "PHYSICAL") return "PET_SHOP";
  return "OTHER";
}

function profileData(user) {
  const mode = user.tempProvince || "";
  return {
    fullName: (user.fullName || "").trim(),
    phone: (user.phone || "").trim(),
    brand: (user.tempDescription || "").trim(),
    mode,
    page: (user.tempCity || "").trim(),
    address: (user.tempAddress || "").trim(),
  };
}

function summaryText(user) {
  const d = profileData(user);
  const lines = [
    "📋 خلاصه اطلاعات همکار",
    "━━━━━━━━━━━━━━━━━━",
    `👤 نام: ${d.fullName || "—"}`,
    `📞 تلفن: ${d.phone || "—"}`,
    `🏷 برند: ${d.brand || "—"}`,
    `🏪 نوع فعالیت: ${shopModeLabel(d.mode)}`,
  ];
  if (d.mode === "ONLINE" || d.mode === "BOTH") {
    lines.push(`🌐 پیج آنلاین: ${d.page || "—"}`);
  }
  if (d.mode === "PHYSICAL" || d.mode === "BOTH") {
    lines.push(`📍 آدرس حضوری: ${d.address || "—"}`);
  }
  lines.push("", "اگر موردی اشتباه است با بازگشت اصلاح کنید.");
  return lines.join("\n");
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

async function askStep(user, chatId, step) {
  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: step },
  });
  user.orderStep = step;

  if (step === "COLLEAGUE_NAME") {
    await reply(
      user,
      chatId,
      "برای تکمیل حساب همکار این اطلاعات را وارد کنید.\n\n👤 نام و نام خانوادگی:",
      backMain()
    );
    return;
  }

  if (step === "COLLEAGUE_PHONE") {
    await reply(user, chatId, "📞 شماره تماس:", profileNavKb());
    return;
  }

  if (step === "COLLEAGUE_BRAND") {
    await reply(user, chatId, "🏷 نام برند:", profileNavKb());
    return;
  }

  if (step === "COLLEAGUE_SHOP_TYPE") {
    await reply(
      user,
      chatId,
      "فروشگاه شما تا به امروز به چه شکلی فعالیت داشته است؟",
      shopTypeMenu()
    );
    return;
  }

  if (step === "COLLEAGUE_PAGE") {
    await reply(
      user,
      chatId,
      "🌐 نام و مشخصات پیج آنلاین را ارسال کنید:",
      profileNavKb()
    );
    return;
  }

  if (step === "COLLEAGUE_ADDRESS") {
    await reply(
      user,
      chatId,
      "📍 آدرس فروشگاه حضوری را ارسال کنید:",
      profileNavKb()
    );
    return;
  }

  if (step === "COLLEAGUE_CONFIRM") {
    await reply(user, chatId, summaryText(user), confirmMenu());
  }
}

async function goProfileBack(user, chatId) {
  const step = user.orderStep;
  const mode = user.tempProvince;

  if (step === "COLLEAGUE_PHONE") return askStep(user, chatId, "COLLEAGUE_NAME");
  if (step === "COLLEAGUE_BRAND") return askStep(user, chatId, "COLLEAGUE_PHONE");
  if (step === "COLLEAGUE_SHOP_TYPE") return askStep(user, chatId, "COLLEAGUE_BRAND");
  if (step === "COLLEAGUE_PAGE") return askStep(user, chatId, "COLLEAGUE_SHOP_TYPE");
  if (step === "COLLEAGUE_ADDRESS") {
    if (mode === "BOTH") return askStep(user, chatId, "COLLEAGUE_PAGE");
    return askStep(user, chatId, "COLLEAGUE_SHOP_TYPE");
  }
  if (step === "COLLEAGUE_CONFIRM") {
    if (mode === "PHYSICAL" || mode === "BOTH") {
      return askStep(user, chatId, "COLLEAGUE_ADDRESS");
    }
    return askStep(user, chatId, "COLLEAGUE_PAGE");
  }
  return askStep(user, chatId, "COLLEAGUE_NAME");
}

async function persistColleague(user) {
  const d = profileData(user);
  const tenantFields = {
    name: d.brand,
    type: tenantTypeFor(d.mode),
    status: "ACTIVE",
    ownerName: d.fullName,
    phone: d.phone,
    address: d.mode === "ONLINE" ? null : d.address || null,
    pageName: d.mode === "PHYSICAL" ? null : d.page || null,
    pageDetails: d.mode === "PHYSICAL" ? null : d.page || null,
  };

  try {
    let tenant = await prisma.tenant.findUnique({
      where: { ownerUserId: user.id },
    });

    if (tenant) {
      tenant = await prisma.tenant.update({
        where: { id: tenant.id },
        data: tenantFields,
      });
    } else {
      tenant = await prisma.tenant.create({
        data: {
          ...tenantFields,
          ownerUserId: user.id,
        },
      });
    }

    try {
      await prisma.tenantSettings.upsert({
        where: { tenantId: tenant.id },
        create: {
          tenantId: tenant.id,
          shopName: d.brand,
          supportPhone: d.phone,
        },
        update: {
          shopName: d.brand,
          supportPhone: d.phone,
        },
      });
    } catch (err) {
      console.error("COLLEAGUE SETTINGS SKIP:", err.message);
    }

    try {
      await prisma.tenantMember.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
        create: {
          tenantId: tenant.id,
          userId: user.id,
          role: "OWNER",
        },
        update: { role: "OWNER" },
      });
    } catch (err) {
      console.error("COLLEAGUE MEMBER SKIP:", err.message);
    }

    try {
      const existingCustomer = await prisma.customer.findFirst({
        where: { userId: user.id, tenantId: tenant.id, type: "COLLEAGUE" },
      });
      const customerData = {
        fullName: d.fullName,
        phone: d.phone,
        shopName: d.brand,
        address: d.mode === "ONLINE" ? null : d.address || null,
        notes: d.mode === "PHYSICAL" ? null : d.page || null,
      };
      if (existingCustomer) {
        await prisma.customer.update({
          where: { id: existingCustomer.id },
          data: customerData,
        });
      } else {
        await prisma.customer.create({
          data: {
            type: "COLLEAGUE",
            userId: user.id,
            tenantId: tenant.id,
            ...customerData,
          },
        });
      }
    } catch (err) {
      console.error("COLLEAGUE CUSTOMER SKIP:", err.message);
    }

    return { ok: true, tenant };
  } catch (err) {
    console.error("COLLEAGUE PROFILE SAVE:", err);
    return { ok: false };
  }
}

async function startProfile(user, chatId) {
  await askStep(user, chatId, "COLLEAGUE_NAME");
}

async function finishProfile(user, chatId) {
  const snapshot = summaryText(user).replace(
    "\n\nاگر موردی اشتباه است با بازگشت اصلاح کنید.",
    ""
  );
  const saved = await persistColleague(user);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      orderStep: null,
      tempDescription: null,
      tempAddress: null,
      tempProvince: null,
      tempCity: null,
    },
  });
  user.orderStep = null;

  if (!saved.ok) {
    await reply(
      user,
      chatId,
      `✅ اطلاعات تماس همکار روی حساب شما ثبت شد.

${snapshot}
ساخت ربات فروشگاهی را بعداً از منو ادامه دهید.`,
      mainMenu(user)
    );
    return;
  }

  await reply(user, chatId, `✅ اطلاعات همکار ثبت شد.\n\n${snapshot}`);

  const tenant = await getOwnedTenant(user.id);
  if (tenant && !tenant.bot) {
    await startBotCreate(user, chatId);
    return;
  }

  await reply(user, chatId, "از منوی زیر استفاده کنید:", mainMenu(user));
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
  const result = await provisionShop(user, rawToken);

  if (result.code === "NEED_PROFILE") {
    await startProfile(user, chatId);
    return;
  }

  if (result.code === "ALREADY_HAS_BOT") {
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: null },
    });
    const at = result.username ? `: @${result.username}` : "";
    await reply(
      user,
      chatId,
      `ربات این فروشگاه قبلاً ثبت شده است${at}.`,
      mainMenu(user)
    );
    return;
  }

  if (!result.ok) {
    const messages = {
      INVALID_TOKEN: "❌ Token نامعتبر است. لطفاً Token کامل را ارسال کنید.",
      MOTHER_TOKEN:
        "❌ این Token مربوط به ربات مادر است. Token ربات خودتان را ارسال کنید.",
      VALIDATE_FAILED:
        "❌ اعتبارسنجی Token ناموفق بود. Token را بررسی کنید و دوباره ارسال کنید.",
      DUPLICATE_TOKEN: "❌ این Token قبلاً ثبت شده است.",
      SAVE_FAILED:
        "ثبت ربات الان ممکن نشد. بعداً دوباره از دکمه ساخت ربات تلاش کنید.",
    };
    const msg = messages[result.code] || messages.SAVE_FAILED;
    const clearStep = result.code === "SAVE_FAILED";
    if (clearStep) {
      await prisma.user.update({
        where: { id: user.id },
        data: { orderStep: null },
      });
    }
    await reply(user, chatId, msg, clearStep ? mainMenu(user) : backMain());
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: null },
  });

  const at = result.username ? `@${result.username}` : "ربات شما";
  await reply(
    user,
    chatId,
    `✅ فروشگاه آماده تحویل است.

🏷 ${result.shopName}
🤖 ${at}

الان در بله ${at} را باز کنید و /start بزنید.
منوی محصولات و راهنما فعال است.
کالا و کارت بانکی را بعداً از داخل ربات خودتان اضافه می‌کنید.`,
    mainMenu(user)
  );
}

function afterShopType(user) {
  const mode = user.tempProvince;
  if (mode === "PHYSICAL") return "COLLEAGUE_ADDRESS";
  return "COLLEAGUE_PAGE";
}

function afterPage(user) {
  if (user.tempProvince === "BOTH") return "COLLEAGUE_ADDRESS";
  return "COLLEAGUE_CONFIRM";
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

  if (text === BTN.BACK_QUESTION && PROFILE_STEPS.includes(user.orderStep)) {
    await goProfileBack(user, chatId);
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
      data: { fullName: name },
    });
    user.fullName = name;
    await askStep(user, chatId, "COLLEAGUE_PHONE");
    return true;
  }

  if (user.orderStep === "COLLEAGUE_PHONE") {
    const phone = text.trim();
    if (!phone) {
      await reply(user, chatId, "لطفاً شماره تماس را وارد کنید.", profileNavKb());
      return true;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { phone },
    });
    user.phone = phone;
    await askStep(user, chatId, "COLLEAGUE_BRAND");
    return true;
  }

  if (user.orderStep === "COLLEAGUE_BRAND") {
    const brand = text.trim();
    if (!brand) {
      await reply(user, chatId, "لطفاً نام برند را وارد کنید.", profileNavKb());
      return true;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { tempDescription: brand },
    });
    user.tempDescription = brand;
    await askStep(user, chatId, "COLLEAGUE_SHOP_TYPE");
    return true;
  }

  if (user.orderStep === "COLLEAGUE_SHOP_TYPE") {
    let mode = null;
    if (text === BTN.SHOP_ONLINE) mode = "ONLINE";
    if (text === BTN.SHOP_PHYSICAL) mode = "PHYSICAL";
    if (text === BTN.SHOP_BOTH) mode = "BOTH";
    if (!mode) {
      await reply(
        user,
        chatId,
        "لطفاً یکی از دکمه‌ها را انتخاب کنید.",
        shopTypeMenu()
      );
      return true;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { tempProvince: mode },
    });
    user.tempProvince = mode;
    await askStep(user, chatId, afterShopType(user));
    return true;
  }

  if (user.orderStep === "COLLEAGUE_PAGE") {
    const page = text.trim();
    if (!page) {
      await reply(
        user,
        chatId,
        "لطفاً نام و مشخصات پیج را ارسال کنید.",
        profileNavKb()
      );
      return true;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { tempCity: page },
    });
    user.tempCity = page;
    await askStep(user, chatId, afterPage(user));
    return true;
  }

  if (user.orderStep === "COLLEAGUE_ADDRESS") {
    const address = text.trim();
    if (!address) {
      await reply(
        user,
        chatId,
        "لطفاً آدرس فروشگاه را ارسال کنید.",
        profileNavKb()
      );
      return true;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { tempAddress: address },
    });
    user.tempAddress = address;
    await askStep(user, chatId, "COLLEAGUE_CONFIRM");
    return true;
  }

  if (user.orderStep === "COLLEAGUE_CONFIRM") {
    if (text === BTN.CONFIRM_PROFILE) {
      await finishProfile(user, chatId);
      return true;
    }
    await reply(
      user,
      chatId,
      "برای ثبت، دکمه تأیید را بزنید یا با بازگشت اطلاعات را اصلاح کنید.",
      confirmMenu()
    );
    return true;
  }

  if (user.orderStep === "BOT_CREATE_TOKEN") {
    await registerBot(user, chatId, text);
    return true;
  }

  return false;
};
