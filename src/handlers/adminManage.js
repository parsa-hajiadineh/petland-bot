const prisma = require("../database/prisma");
const { reply } = require("../bot/messenger");
const bale = require("../bot/bale");
const { formatPrice } = require("../utils/price");
const {
  BTN,
  inlineKb,
  adminBackMenu,
  adminManageMenu,
  adminColleagueActions,
} = require("../keyboards/menus");
const shopBlock = require("../services/shopBlock");
const subscriptions = require("../services/tenantSubscriptions");
const creditLedger = require("../services/creditLedger");
const campaign = require("../services/goldenCampaign");
const { sqlCompact, buildAndLikes, scoreText } = require("../utils/smartSearch");

const STEP_HUB = "MGR:HUB";
const STEP_LIST = "MGR:LIST";
const STEP_VIEW = "MGR:VIEW";
const STEP_BLOCKED = "MGR:BLOCKED";
const PAGE_SIZE = 10;

const ROLE_FA = {
  CUSTOMER: "مشتری",
  COLLEAGUE: "همکار",
  ADMIN: "ادمین",
};

const TYPE_FA = {
  CLINIC: "کلینیک",
  VET: "دامپزشکی",
  PET_SHOP: "پت‌شاپ",
  ONLINE_SHOP: "فروشگاه آنلاین",
  OTHER: "سایر",
};

const LIFE_FA = {
  ACTIVE: "فعال",
  EXPIRING_SOON: "در حال انقضا",
  EXPIRED: "منقضی",
  SUSPENDED: "معلق / مسدود",
  CANCELLED: "لغو شده",
  PENDING: "در انتظار",
};

const BOT_FA = {
  ACTIVE: "فعال",
  DISABLED: "غیرفعال",
  PENDING: "در انتظار",
  EXPIRED: "منقضی",
};

const TENANT_FA = {
  PENDING: "در انتظار",
  ACTIVE: "فعال",
  SUSPENDED: "مسدود",
  INACTIVE: "غیرفعال",
};

function isManageStep(step) {
  return Boolean(step && String(step).startsWith("MGR:"));
}

function dash(value) {
  const text = String(value ?? "").trim();
  return text || "—";
}

function faDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("fa-IR");
  } catch {
    return "—";
  }
}

async function setStep(user, step, extras = {}) {
  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: step, ...extras },
  });
  user.adminStep = step;
  Object.assign(user, extras);
}

function isColleaguePerson(user, tenant) {
  return Boolean(tenant) || user?.role === "COLLEAGUE";
}

async function showHub(user, chatId) {
  await setStep(user, STEP_HUB, {
    pendingOrderId: null,
    tempDescription: null,
    lastProductCode: null,
  });
  await reply(
    user,
    chatId,
    "🛡 مدیریت\n\nنام، نام کوچک، شماره تماس، آیدی بله یا هر مشخصهٔ دیگری را بفرستید تا در پرونده‌های هویتی جستجو شود.",
    adminManageMenu()
  );
}

async function searchPeople(query) {
  const like = buildAndLikes(
    sqlCompact(`concat_ws(' ',
      u."fullName", u."phone", u."baleId", u."id",
      c."fullName", c."phone", c."shopName",
      t."name", t."ownerName", t."phone", t."nationalId", t."pageName",
      s."shopName", s."supportPhone", s."shopAddress",
      a."fullName", a."phone", a."address",
      o."fullName", o."phone"
    )`),
    query
  );
  if (!like) return [];
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT u."id", u."fullName", u."phone", u."baleId", u."role"
       FROM "User" u
       LEFT JOIN "Customer" c ON c."userId" = u."id"
       LEFT JOIN "Tenant" t ON t."ownerUserId" = u."id"
       LEFT JOIN "TenantSettings" s ON s."tenantId" = t."id"
       LEFT JOIN "SavedAddress" a ON a."userId" = u."id"
       LEFT JOIN "Order" o ON o."userId" = u."id"
       WHERE ${like.sql}
       LIMIT 80`,
      ...like.params
    );
    return (rows || [])
      .map((row) => ({
        ...row,
        _score: scoreText(
          `${row.fullName || ""} ${row.phone || ""} ${row.baleId || ""}`,
          query
        ),
      }))
      .sort((a, b) => b._score - a._score)
      .slice(0, 50);
  } catch (err) {
    console.error("ADMIN MANAGE SEARCH:", err.message);
    return [];
  }
}

async function sendInline(user, chatId, title, rows, keyboard) {
  await reply(user, chatId, title, keyboard);
  const result = await bale.sendKeyboard(chatId, "انتخاب کنید:", inlineKb(rows));
  const msgId = result?.result?.message_id;
  if (msgId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastMessageId: msgId },
    });
  }
}

async function showSearchResults(user, chatId, query, offset = 0) {
  const skip = Math.max(0, Number(offset) || 0);
  const people = await searchPeople(query);
  await setStep(user, STEP_LIST, {
    pendingOrderId: null,
    tempDescription: query,
    lastProductCode: "search",
  });
  if (!people.length) {
    await reply(
      user,
      chatId,
      skip ? "مورد دیگری پیدا نشد." : "کسی با این مشخصه پیدا نشد.",
      adminManageMenu()
    );
    return;
  }
  const page = people.slice(skip, skip + PAGE_SIZE);
  const hasMore = people.length > skip + PAGE_SIZE;
  if (!page.length) {
    await reply(user, chatId, "مورد قدیمی‌تری نیست.", adminManageMenu());
    return;
  }
  const rows = page.map((person) => [
    {
      text: `${dash(person.fullName)} | ${ROLE_FA[person.role] || person.role} | ${dash(
        person.phone || person.baleId
      )}`.slice(0, 64),
      callback_data: `mgru:${person.id}`.slice(0, 64),
    },
  ]);
  if (hasMore) {
    rows.push([
      {
        text: "ده مورد قبلی",
        callback_data: `mgrq:${skip + PAGE_SIZE}`.slice(0, 64),
      },
    ]);
  }
  await sendInline(
    user,
    chatId,
    `نتایج جستجو (${people.length} نفر)\nروی هر مورد بزنید.`,
    rows,
    adminManageMenu()
  );
}

async function showBlockedList(user, chatId, offset = 0) {
  const skip = Math.max(0, Number(offset) || 0);
  await setStep(user, STEP_BLOCKED, {
    pendingOrderId: null,
    lastProductCode: "blocked",
  });
  const rows = await shopBlock.listBlockedShops(skip, PAGE_SIZE + 1);
  if (!rows.length) {
    await reply(
      user,
      chatId,
      skip ? "مسدودشدهٔ قدیمی‌تری نیست." : "🚫 مسدود شدگان\n\nربات مسدودی نیست.",
      adminManageMenu()
    );
    return;
  }
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const buttons = page.map((row) => {
    const botLabel = row.username
      ? `@${row.username}`
      : row.baleBotId || row.botId || "بدون ربات";
    return [
      {
        text: `${botLabel} | ${dash(row.tenantName)}`.slice(0, 64),
        callback_data: `mgrb:${row.tenantId}`.slice(0, 64),
      },
    ];
  });
  if (hasMore) {
    buttons.push([
      {
        text: "ده مورد قبلی",
        callback_data: `mgrk:${skip + PAGE_SIZE}`.slice(0, 64),
      },
    ]);
  }
  await sendInline(
    user,
    chatId,
    "🚫 مسدود شدگان\nروی هر مورد بزنید تا پروندهٔ صاحب ربات را ببینید.",
    buttons,
    adminManageMenu()
  );
}

function formatAddress(item) {
  const parts = [
    item.fullName,
    item.phone,
    [item.province, item.city].filter(Boolean).join("، "),
    item.address,
    item.postalCode ? `کدپستی ${item.postalCode}` : "",
  ].filter((part) => String(part || "").trim());
  return parts.join(" | ");
}

async function uniqueAddresses(userId) {
  const saved = await prisma.savedAddress.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  }).catch(() => []);
  const orders = await prisma.order.findMany({
    where: { userId },
    select: {
      fullName: true,
      phone: true,
      province: true,
      city: true,
      address: true,
      postalCode: true,
    },
    take: 40,
    orderBy: { createdAt: "desc" },
  }).catch(() => []);
  const seen = new Set();
  const list = [];
  for (const item of [...saved, ...orders]) {
    const line = formatAddress(item);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    list.push(line);
  }
  return list;
}

async function shopNamesForUser(userId) {
  const names = [];
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT t."name" AS "name"
       FROM "Order" o
       JOIN "Tenant" t ON t."id" = o."tenantId"
       WHERE o."userId" = $1 AND o."tenantId" IS NOT NULL`,
      userId
    );
    for (const row of rows || []) {
      if (row.name) names.push(row.name);
    }
  } catch (err) {
    console.error("ADMIN MANAGE SHOPS SKIP:", err.message);
  }
  const mother = await prisma.order
    .findFirst({
      where: { userId, trackingCode: { startsWith: "PL-" } },
      select: { id: true },
    })
    .catch(() => null);
  return { names, hasMother: Boolean(mother) };
}

async function monthMotherPurchases(userId) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  try {
    const agg = await prisma.order.aggregate({
      where: {
        userId,
        trackingCode: { startsWith: "PL-" },
        createdAt: { gte: start },
        status: { in: ["APPROVED", "PACKAGING", "SHIPPED", "DELIVERED"] },
      },
      _sum: { totalAmount: true },
    });
    return Number(agg?._sum?.totalAmount || 0);
  } catch (err) {
    console.error("ADMIN MANAGE MONTH SUM SKIP:", err.message);
    return 0;
  }
}

function identityBlock(person) {
  return [
    `👤 ${dash(person.fullName)}`,
    `نقش: ${ROLE_FA[person.role] || person.role}`,
    `شماره تماس: ${dash(person.phone)}`,
    `آیدی بله: ${dash(person.baleId)}`,
    `شناسه داخلی: ${person.id}`,
    `عضویت: ${faDate(person.createdAt)}`,
  ];
}

async function formatCustomerText(person) {
  const lines = ["مشتری", "━━━━━━━━━━━━━━━━━━", ...identityBlock(person), ""];
  const shops = await shopNamesForUser(person.id);
  const botNames = [];
  if (shops.hasMother) botNames.push("ربات مادر (پت‌لند)");
  botNames.push(...shops.names.map((name) => `ربات همکار «${name}»`));
  lines.push(`مشتری کدام ربات: ${botNames.length ? botNames.join("، ") : "هنوز سفارشی ندارد"}`);
  const addresses = await uniqueAddresses(person.id);
  lines.push("", "آدرس‌های ثبت‌شده:");
  if (!addresses.length) lines.push("—");
  else addresses.forEach((line, i) => lines.push(`${i + 1}. ${line}`));
  return lines.join("\n");
}

async function formatColleagueText(person, tenant) {
  const shop = tenant ? await shopBlock.loadShop(tenant.id) : null;
  const settings = shop?.settings || tenant?.settings || {};
  const bot = shop?.bot || tenant?.bot || null;
  const sub = tenant
    ? await subscriptions.getForTenant(tenant.id, shop?.status || tenant.status)
    : null;
  const credit = { balance: 0 };
  if (tenant) {
    try {
      const wallets = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "CreditWallet" WHERE "tenantId" = $1 OR "userId" = $2 LIMIT 1`,
        tenant.id,
        person.id
      );
      if (wallets?.[0]?.id) {
        credit.balance = await creditLedger.getBalance(wallets[0].id);
      }
    } catch (err) {
      console.error("ADMIN MANAGE CREDIT SKIP:", err.message);
    }
  }
  const monthSum = await monthMotherPurchases(person.id);
  let goldenLine = "ثبت نشده";
  try {
    const period = await campaign.getGoldenPeriod(person.id);
    const settingsCamp = await campaign.getSettings();
    if (period?.startedAt) {
      const hours = Number(settingsCamp.goldenHours || 48);
      const ends = new Date(period.startedAt.getTime() + hours * 60 * 60 * 1000);
      const live = Date.now() <= ends.getTime();
      goldenLine = live
        ? `فعال تا ${faDate(ends)}`
        : `منقضی (شروع ${faDate(period.startedAt)})`;
    }
  } catch (err) {
    console.error("ADMIN MANAGE GOLDEN SKIP:", err.message);
  }
  const services = (sub?.services || []).map((item) => item.title).filter(Boolean);
  const days = sub?.daysRemaining;
  const expireHint =
    days == null
      ? "—"
      : days < 0
        ? `منقضی شده (${Math.abs(days)} روز پیش)`
        : `${days} روز مانده`;
  const lines = [
    "همکار",
    "━━━━━━━━━━━━━━━━━━",
    ...identityBlock(person),
    "",
    "اطلاعات شخصی و خرید از ربات مادر",
    `نام ثبت‌شده برای سفارش: ${dash(person.fullName)}`,
  ];
  const addresses = await uniqueAddresses(person.id);
  lines.push("آدرس‌های خرید از ربات مادر:");
  if (!addresses.length) lines.push("—");
  else addresses.forEach((line, i) => lines.push(`${i + 1}. ${line}`));
  lines.push(
    "",
    "فروشگاه",
    `نام برند: ${dash(shop?.name || tenant?.name)}`,
    `نوع: ${TYPE_FA[shop?.type || tenant?.type] || dash(shop?.type)}`,
    `وضعیت فروشگاه: ${TENANT_FA[shop?.status || tenant?.status] || dash(shop?.status)}`,
    `نام مالک: ${dash(shop?.ownerName || tenant?.ownerName)}`,
    `تلفن فروشگاه: ${dash(shop?.phone || tenant?.phone || settings.supportPhone)}`,
    `کد ملی: ${dash(shop?.nationalId || tenant?.nationalId)}`,
    `استان / شهر: ${dash(shop?.province || tenant?.province)} / ${dash(shop?.city || tenant?.city)}`,
    `آدرس فروشگاه: ${dash(settings.shopAddress || shop?.address || tenant?.address)}`,
    `کدپستی: ${dash(shop?.postalCode || tenant?.postalCode)}`,
    `ساعات کاری: ${dash(settings.openingHours)}`,
    "",
    "ربات فروشگاه",
    `آیدی ربات: ${dash(bot?.baleBotId || bot?.id)}`,
    `یوزرنیم: ${bot?.username ? `@${bot.username}` : "—"}`,
    `وضعیت ربات: ${BOT_FA[bot?.status] || (bot ? dash(bot.status) : "ربات ساخته نشده")}`,
    `سرویس‌دهی: ${bot?.isEnabled ? "روشن" : "خاموش"}`,
    "",
    "اشتراک جاری",
    `وضعیت: ${LIFE_FA[sub?.lifecycle] || dash(sub?.lifecycle)}`,
    `شروع دوره: ${faDate(sub?.periodStart)}`,
    `پایان دوره: ${faDate(sub?.periodEnd)}`,
    `زمان باقی‌مانده: ${expireHint}`,
    `مبلغ دوره: ${sub ? formatPrice(sub.price || 0) : "—"}`,
    `خدمات پکیج: ${services.length ? services.join("، ") : "—"}`,
    "",
    `اعتبار کیف پول خدمات: ${formatPrice(credit.balance || 0)}`,
    `خرید این ماه از ربات مادر: ${formatPrice(monthSum)}`,
    `دوره طلایی: ${goldenLine}`
  );
  return lines.join("\n");
}

async function showPerson(user, chatId, personId, source) {
  const person = await prisma.user.findUnique({ where: { id: personId } });
  if (!person) {
    await reply(user, chatId, "این شخص پیدا نشد.", adminManageMenu());
    return;
  }
  let tenant = null;
  try {
    tenant = await prisma.tenant.findUnique({
      where: { ownerUserId: person.id },
      include: { bot: true, settings: true },
    });
  } catch (err) {
    console.error("ADMIN MANAGE TENANT SKIP:", err.message);
  }
  await setStep(user, STEP_VIEW, {
    pendingOrderId: person.id,
    lastProductCode: source || user.lastProductCode || "search",
    tempCity: null,
  });
  const colleague = isColleaguePerson(person, tenant);
  const text = colleague
    ? await formatColleagueText(person, tenant)
    : await formatCustomerText(person);
  if (colleague && tenant) {
    await reply(user, chatId, text, adminColleagueActions(shopBlock.isBlocked(tenant)));
    return;
  }
  await reply(user, chatId, text, adminBackMenu());
}

async function showBlockedShop(user, chatId, tenantId) {
  const shop = await shopBlock.loadShop(tenantId);
  if (!shop) {
    await reply(user, chatId, "این فروشگاه پیدا نشد.", adminManageMenu());
    return;
  }
  if (shop.ownerUserId) {
    await showPerson(user, chatId, shop.ownerUserId, "blocked");
    return;
  }
  await setStep(user, STEP_VIEW, {
    pendingOrderId: null,
    lastProductCode: "blocked",
    tempCity: tenantId,
  });
  await reply(
    user,
    chatId,
    `فروشگاه بدون مالک ثبت‌شده\n${dash(shop.name)}\nوضعیت: مسدود`,
    adminColleagueActions(true)
  );
}

async function goBack(user, chatId) {
  const step = user.adminStep || "";
  if (!isManageStep(step)) return false;
  if (step === STEP_HUB) return false;
  if (step === STEP_LIST || step === STEP_BLOCKED) {
    await showHub(user, chatId);
    return true;
  }
  if (step === STEP_VIEW) {
    if (user.lastProductCode === "blocked") {
      await showBlockedList(user, chatId, 0);
      return true;
    }
    if (user.tempDescription) {
      await showSearchResults(user, chatId, user.tempDescription, 0);
      return true;
    }
    await showHub(user, chatId);
    return true;
  }
  await showHub(user, chatId);
  return true;
}

async function handleCallback(user, chatId, data) {
  if (data.startsWith("mgru:")) {
    await showPerson(user, chatId, data.slice(5), user.lastProductCode || "search");
    return true;
  }
  if (data.startsWith("mgrb:")) {
    await showBlockedShop(user, chatId, data.slice(5));
    return true;
  }
  if (data.startsWith("mgrq:")) {
    const offset = Number(data.slice(5)) || 0;
    await showSearchResults(user, chatId, user.tempDescription || "", offset);
    return true;
  }
  if (data.startsWith("mgrk:")) {
    await showBlockedList(user, chatId, Number(data.slice(5)) || 0);
    return true;
  }
  return false;
}

async function handleText(user, chatId, text) {
  if (text === BTN.ADMIN_MANAGE) {
    await showHub(user, chatId);
    return true;
  }
  if (!isManageStep(user.adminStep)) return false;
  if (text === BTN.BACK_PRODUCT_LIST || text === BTN.BACK_MAIN) return false;
  if (text === BTN.ADMIN_BLOCKED) {
    await showBlockedList(user, chatId, 0);
    return true;
  }
  if (
    (text === BTN.BLOCK_SHOP || text === BTN.UNBLOCK_SHOP) &&
    user.adminStep === STEP_VIEW
  ) {
    let tenantId = user.tempCity;
    if (user.pendingOrderId) {
      const tenant = await prisma.tenant.findUnique({
        where: { ownerUserId: user.pendingOrderId },
        select: { id: true },
      }).catch(() => null);
      tenantId = tenant?.id || tenantId;
    }
    if (!tenantId) {
      await reply(user, chatId, "برای این شخص ربات فروشگاهی ثبت نشده.", adminBackMenu());
      return true;
    }
    if (text === BTN.BLOCK_SHOP) {
      await shopBlock.blockShop(tenantId);
      await reply(user, chatId, "ربات فروشگاه مسدود شد. خود همکار و مشتریانش به ربات فروشگاه دسترسی ندارند.");
    } else {
      await shopBlock.unblockShop(tenantId);
      await reply(user, chatId, "مسدودی برداشته شد. ربات به حالت سرویس‌دهی قبلی برگشت.");
    }
    if (user.pendingOrderId) {
      await showPerson(user, chatId, user.pendingOrderId, user.lastProductCode);
    } else {
      await showBlockedShop(user, chatId, tenantId);
    }
    return true;
  }

  const isMenuBtn = Object.values(BTN).includes(text);
  if (isMenuBtn) return false;
  if (
    user.adminStep === STEP_HUB ||
    user.adminStep === STEP_LIST ||
    user.adminStep === STEP_BLOCKED
  ) {
    await showSearchResults(user, chatId, text, 0);
    return true;
  }
  if (user.adminStep === STEP_VIEW) {
    await reply(user, chatId, "از دکمه‌های منو استفاده کنید.", adminBackMenu());
    return true;
  }
  return false;
}

module.exports = {
  isManageStep,
  handleText,
  handleCallback,
  goBack,
  showHub,
  searchPeople,
};
