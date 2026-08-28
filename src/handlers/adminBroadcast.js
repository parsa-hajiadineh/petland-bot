const prisma = require("../database/prisma");
const { ADMIN_BALE_IDS } = require("../config");
const { reply, notify, notifyShop, notifyMother } = require("../bot/messenger");
const bale = require("../bot/bale");
const {
  BTN,
  adminTicketsMenu,
  adminBackMenu,
  inlineKb,
  kb,
} = require("../keyboards/menus");
const { searchPeople } = require("./adminManage");

const STEP_HUB = "BC:HUB";
const STEP_SHOP = "BC:SHOP";
const STEP_PICK = "BC:PICK";
const STEP_MSG = "BC:MSG";
const STEP_CONFIRM = "BC:CONFIRM";
const PAGE = 10;

const AUDIENCE_FA = {
  mother: "مشتری‌های ربات مادر",
  colleagues: "همکاران",
  shop: "مشتری‌های یک همکار",
  all_cust: "مشتری‌های همه ربات‌ها",
  all_users: "تمام کاربرها",
  manual: "نفر / لیست دستی",
};

function isBroadcastStep(step) {
  return Boolean(step && String(step).startsWith("BC:"));
}

function readState(user) {
  try {
    const parsed = JSON.parse(user.tempDescription || "{}");
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    /* ignore */
  }
  return {};
}

async function writeState(user, patch) {
  const next = { ...readState(user), ...patch };
  await prisma.user.update({
    where: { id: user.id },
    data: {
      adminStep: user.adminStep,
      tempDescription: JSON.stringify(next),
    },
  });
  user.tempDescription = JSON.stringify(next);
  return next;
}

async function setStep(user, step, patch = {}) {
  const next = { ...readState(user), ...patch };
  await prisma.user.update({
    where: { id: user.id },
    data: {
      adminStep: step,
      tempDescription: JSON.stringify(next),
    },
  });
  user.adminStep = step;
  user.tempDescription = JSON.stringify(next);
  return next;
}

function broadcastMenu() {
  return kb([
    [{ text: BTN.BC_MOTHER }, { text: BTN.BC_COLLEAGUES }],
    [{ text: BTN.BC_SHOP }, { text: BTN.BC_ALL_CUST }],
    [{ text: BTN.BC_ALL_USERS }, { text: BTN.BC_MANUAL }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function confirmMenu() {
  return kb([
    [{ text: BTN.BC_CONFIRM }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function pickMenu() {
  return kb([
    [{ text: BTN.BC_DONE_PICK }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function dash(value) {
  return String(value || "").trim() || "نامشخص";
}

function uniqueUsers(list) {
  const map = new Map();
  for (const item of list || []) {
    if (!item?.id || !item?.baleId) continue;
    if (ADMIN_BALE_IDS.includes(String(item.baleId))) continue;
    map.set(item.id, item);
  }
  return [...map.values()];
}

async function shopCustomerIds(tenantId) {
  const ids = new Set();
  try {
    const customers = await prisma.customer.findMany({
      where: { tenantId, type: { not: "COLLEAGUE" } },
      select: { userId: true },
    });
    for (const row of customers) if (row.userId) ids.add(row.userId);
  } catch (err) {
    console.error("BC CUSTOMER SKIP:", err.message);
  }
  try {
    const orders = await prisma.order.findMany({
      where: { tenantId, trackingCode: { startsWith: "TS-" } },
      select: { userId: true },
    });
    for (const row of orders) if (row.userId) ids.add(row.userId);
  } catch (err) {
    console.error("BC ORDER SKIP:", err.message);
  }
  try {
    const carts = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT "userId" FROM "ShopCart" WHERE "tenantId" = $1`,
      tenantId
    );
    for (const row of carts || []) if (row.userId) ids.add(row.userId);
  } catch (err) {
    console.error("BC CART SKIP:", err.message);
  }
  if (!ids.size) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] }, role: "CUSTOMER" },
    select: { id: true, baleId: true, fullName: true },
  });
  return uniqueUsers(users);
}

async function allShopCustomers() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } }).catch(() => []);
  const merged = [];
  for (const tenant of tenants) {
    const people = await shopCustomerIds(tenant.id);
    for (const person of people) {
      merged.push({ ...person, tenantId: tenant.id });
    }
  }
  return merged;
}

async function resolveTargets(state) {
  const audience = state.audience;
  if (audience === "mother") {
    const users = await prisma.user.findMany({
      where: { role: "CUSTOMER" },
      select: { id: true, baleId: true, fullName: true },
    });
    return uniqueUsers(users).map((u) => ({ ...u, via: "mother" }));
  }
  if (audience === "colleagues") {
    const users = await prisma.user.findMany({
      where: { role: "COLLEAGUE" },
      select: { id: true, baleId: true, fullName: true },
    });
    return uniqueUsers(users).map((u) => ({ ...u, via: "mother" }));
  }
  if (audience === "shop") {
    if (!state.tenantId) return [];
    return (await shopCustomerIds(state.tenantId)).map((u) => ({
      ...u,
      via: "shop",
      tenantId: state.tenantId,
    }));
  }
  if (audience === "all_cust") {
    const shops = (await allShopCustomers()).map((u) => ({
      ...u,
      via: "shop",
    }));
    const shopIds = new Set(shops.map((u) => u.id));
    const mother = uniqueUsers(
      await prisma.user.findMany({
        where: { role: "CUSTOMER" },
        select: { id: true, baleId: true, fullName: true },
      })
    )
      .filter((u) => !shopIds.has(u.id))
      .map((u) => ({ ...u, via: "mother" }));
    const seen = new Set();
    const out = [];
    for (const item of [...mother, ...shops]) {
      const key = `${item.via}:${item.tenantId || "m"}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }
  if (audience === "all_users") {
    const base = await resolveTargets({ audience: "all_cust" });
    const colleagues = uniqueUsers(
      await prisma.user.findMany({
        where: { role: "COLLEAGUE" },
        select: { id: true, baleId: true, fullName: true },
      })
    ).map((u) => ({ ...u, via: "mother" }));
    return [...base, ...colleagues];
  }
  if (audience === "manual") {
    const ids = Array.isArray(state.ids) ? state.ids : [];
    if (!ids.length) return [];
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, baleId: true, fullName: true, role: true },
    });
    return users
      .filter((u) => u.baleId)
      .map((u) => ({ ...u, via: u.role === "COLLEAGUE" ? "mother" : "mother" }));
  }
  return [];
}

async function deliver(target, text) {
  if (target.via === "shop" && target.tenantId) {
    return notifyShop(target.baleId, text, target.tenantId);
  }
  return notifyMother(target.baleId, text);
}

async function showHub(user, chatId) {
  await setStep(user, STEP_HUB, {
    audience: null,
    tenantId: null,
    ids: [],
    q: "",
    msg: "",
  });
  await reply(
    user,
    chatId,
    "✉️ ارسال پیام\n\nمخاطب را انتخاب کنید:",
    broadcastMenu()
  );
}

async function askMessage(user, chatId, state) {
  const targets = await resolveTargets(state);
  const shopNote = state.shopName ? `\nفروشگاه: ${state.shopName}` : "";
  await setStep(user, STEP_MSG, state);
  await reply(
    user,
    chatId,
    `مخاطب: ${AUDIENCE_FA[state.audience] || ""}${shopNote}\nتعداد گیرنده: ${targets.length.toLocaleString("fa-IR")}\n\nمتن پیام را بنویسید:`,
    adminBackMenu()
  );
}

async function showShops(user, chatId, offset = 0) {
  const skip = Math.max(0, Number(offset) || 0);
  await setStep(user, STEP_SHOP, { audience: "shop" });
  const rows = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    skip,
    take: PAGE + 1,
    include: {
      ownerUser: { select: { fullName: true, baleId: true } },
      settings: { select: { shopName: true } },
    },
  });
  if (!rows.length) {
    await reply(user, chatId, "فروشگاهی ثبت نشده است.", broadcastMenu());
    return;
  }
  const hasMore = rows.length > PAGE;
  const page = hasMore ? rows.slice(0, PAGE) : rows;
  const buttons = page.map((t) => {
    const name = t.settings?.shopName || t.name || "فروشگاه";
    const owner = t.ownerUser?.fullName || t.ownerName || t.ownerUser?.baleId || "";
    return [
      {
        text: `${name}${owner ? ` | ${owner}` : ""}`.slice(0, 64),
        callback_data: `bcsh:${t.id}`.slice(0, 64),
      },
    ];
  });
  if (hasMore) {
    buttons.push([
      { text: "ده مورد قبلی", callback_data: `bcm:${skip + PAGE}` },
    ]);
  }
  await reply(user, chatId, "همکار / فروشگاه را انتخاب کنید:", adminBackMenu());
  await bale.sendKeyboard(chatId, "روی فروشگاه بزنید:", inlineKb(buttons));
}

async function showPickResults(user, chatId, query, offset = 0) {
  const state = await setStep(user, STEP_PICK, {
    audience: "manual",
    q: query,
    ids: readState(user).ids || [],
  });
  const selected = new Set(state.ids || []);
  const people = await searchPeople(query);
  if (!people.length) {
    await reply(
      user,
      chatId,
      selected.size
        ? `کسی پیدا نشد.\nانتخاب‌شده: ${selected.size} نفر`
        : "کسی پیدا نشد. نام، تلفن یا آیدی را دوباره بفرستید.",
      pickMenu()
    );
    return;
  }
  const skip = Math.max(0, Number(offset) || 0);
  const page = people.slice(skip, skip + PAGE);
  const hasMore = people.length > skip + PAGE;
  const buttons = page.map((person) => {
    const on = selected.has(person.id);
    return [
      {
        text: `${on ? "✅ " : ""}${dash(person.fullName)} | ${person.role === "COLLEAGUE" ? "همکار" : "یوزر"} | ${dash(person.phone || person.baleId)}`.slice(0, 64),
        callback_data: `bcu:${person.id}`.slice(0, 64),
      },
    ];
  });
  if (hasMore) {
    buttons.push([{ text: "ده مورد قبلی", callback_data: `bcp:${skip + PAGE}` }]);
  }
  await reply(
    user,
    chatId,
    `جستجو: ${query}\nانتخاب‌شده: ${selected.size} نفر\nروی هر نفر بزنید تا به لیست اضافه/حذف شود.`,
    pickMenu()
  );
  await bale.sendKeyboard(chatId, "انتخاب کنید:", inlineKb(buttons));
}

async function previewConfirm(user, chatId, message) {
  const state = await setStep(user, STEP_CONFIRM, { msg: message });
  const targets = await resolveTargets(state);
  const preview = String(message).slice(0, 400);
  await reply(
    user,
    chatId,
    `✉️ پیش‌نمایش\nمخاطب: ${AUDIENCE_FA[state.audience] || ""}\nگیرنده: ${targets.length.toLocaleString("fa-IR")} نفر\n━━━━━━━━━━━━━━━━━━\n${preview}${message.length > 400 ? "…" : ""}\n━━━━━━━━━━━━━━━━━━\nارسال را تایید کنید.`,
    confirmMenu()
  );
}

async function runSend(adminBaleId, state) {
  const targets = await resolveTargets(state);
  const text = String(state.msg || "").trim();
  let sent = 0;
  let failed = 0;
  for (const target of targets) {
    try {
      const result = await deliver(target, text);
      if (result?.ok) sent += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  await notify(
    adminBaleId,
    `✅ ارسال پیام تمام شد.\nموفق: ${sent.toLocaleString("fa-IR")}\nناموفق: ${failed.toLocaleString("fa-IR")}`
  );
}

async function goBack(user, chatId) {
  const step = user.adminStep || "";
  if (!isBroadcastStep(step)) return false;
  const state = readState(user);
  if (step === STEP_CONFIRM) {
    await setStep(user, STEP_MSG, state);
    await reply(user, chatId, "متن پیام را بنویسید:", adminBackMenu());
    return true;
  }
  if (step === STEP_MSG) {
    if (state.audience === "shop") {
      await showShops(user, chatId, 0);
      return true;
    }
    if (state.audience === "manual") {
      await setStep(user, STEP_PICK, state);
      await reply(
        user,
        chatId,
        "نام، تلفن یا آیدی را بفرستید. بعد از انتخاب‌ها «ادامه و نوشتن پیام» را بزنید.",
        pickMenu()
      );
      return true;
    }
    await showHub(user, chatId);
    return true;
  }
  if (step === STEP_SHOP || step === STEP_PICK) {
    await showHub(user, chatId);
    return true;
  }
  const support = require("./support");
  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: "ADMIN_TICKETS", tempDescription: null },
  });
  user.adminStep = "ADMIN_TICKETS";
  user.tempDescription = null;
  await support.adminListTickets(user, chatId);
  return true;
}

async function handleCallback(user, chatId, data) {
  if (data.startsWith("bcsh:")) {
    const tenantId = data.slice(5);
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { settings: { select: { shopName: true } } },
    });
    if (!tenant) {
      await reply(user, chatId, "فروشگاه پیدا نشد.", adminBackMenu());
      return true;
    }
    await askMessage(user, chatId, {
      audience: "shop",
      tenantId,
      shopName: tenant.settings?.shopName || tenant.name,
      ids: [],
    });
    return true;
  }
  if (data.startsWith("bcm:")) {
    await showShops(user, chatId, Number(data.slice(4)) || 0);
    return true;
  }
  if (data.startsWith("bcu:")) {
    const id = data.slice(4);
    const state = readState(user);
    const ids = new Set(state.ids || []);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    await writeState(user, { ids: [...ids] });
    user.tempDescription = JSON.stringify({ ...state, ids: [...ids] });
    await showPickResults(user, chatId, state.q || "", 0);
    return true;
  }
  if (data.startsWith("bcp:")) {
    const state = readState(user);
    await showPickResults(user, chatId, state.q || "", Number(data.slice(4)) || 0);
    return true;
  }
  return false;
}

async function handleText(user, chatId, text) {
  if (text === BTN.TICKET_BROADCAST) {
    await showHub(user, chatId);
    return true;
  }
  if (!isBroadcastStep(user.adminStep)) return false;
  if (text === BTN.BACK_PRODUCT_LIST || text === BTN.BACK_MAIN) return false;

  if (text === BTN.BC_MOTHER) {
    await askMessage(user, chatId, { audience: "mother", ids: [], tenantId: null });
    return true;
  }
  if (text === BTN.BC_COLLEAGUES) {
    await askMessage(user, chatId, { audience: "colleagues", ids: [], tenantId: null });
    return true;
  }
  if (text === BTN.BC_SHOP) {
    await showShops(user, chatId, 0);
    return true;
  }
  if (text === BTN.BC_ALL_CUST) {
    await askMessage(user, chatId, { audience: "all_cust", ids: [], tenantId: null });
    return true;
  }
  if (text === BTN.BC_ALL_USERS) {
    await askMessage(user, chatId, { audience: "all_users", ids: [], tenantId: null });
    return true;
  }
  if (text === BTN.BC_MANUAL) {
    await setStep(user, STEP_PICK, { audience: "manual", ids: [], q: "", msg: "" });
    await reply(
      user,
      chatId,
      "نام، تلفن یا آیدی بله را بفرستید و افراد را از لیست انتخاب کنید.\nمی‌توانید چند بار جستجو کنید.",
      pickMenu()
    );
    return true;
  }

  if (text === BTN.BC_DONE_PICK && user.adminStep === STEP_PICK) {
    const state = readState(user);
    if (!(state.ids || []).length) {
      await reply(user, chatId, "حداقل یک نفر را انتخاب کنید.", pickMenu());
      return true;
    }
    await askMessage(user, chatId, state);
    return true;
  }

  if (text === BTN.BC_CONFIRM && user.adminStep === STEP_CONFIRM) {
    const state = readState(user);
    const targets = await resolveTargets(state);
    if (!String(state.msg || "").trim()) {
      await reply(user, chatId, "متن پیام خالی است.", adminBackMenu());
      return true;
    }
    if (!targets.length) {
      await reply(user, chatId, "گیرنده‌ای پیدا نشد.", broadcastMenu());
      return true;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: "ADMIN_TICKETS" },
    });
    user.adminStep = "ADMIN_TICKETS";
    const support = require("./support");
    await reply(
      user,
      chatId,
      `ارسال برای ${targets.length.toLocaleString("fa-IR")} نفر شروع شد.\nنتیجه بعد از اتمام برایتان می‌آید.`,
      adminTicketsMenu()
    );
    setImmediate(() => {
      runSend(user.baleId, state).catch((err) => {
        console.error("BROADCAST SEND:", err);
        notify(user.baleId, "ارسال پیام با خطا متوقف شد.").catch(() => {});
      });
    });
    return true;
  }

  if (user.adminStep === STEP_PICK) {
    await showPickResults(user, chatId, text.trim(), 0);
    return true;
  }

  if (user.adminStep === STEP_MSG) {
    const message = String(text || "").trim();
    if (!message) {
      await reply(user, chatId, "متن پیام را بنویسید:", adminBackMenu());
      return true;
    }
    if (message.length > 3900) {
      await reply(
        user,
        chatId,
        "متن خیلی بلند است. کوتاه‌تر بنویسید.",
        adminBackMenu()
      );
      return true;
    }
    await previewConfirm(user, chatId, message);
    return true;
  }

  return false;
}

module.exports = {
  isBroadcastStep,
  handleText,
  handleCallback,
  goBack,
  showHub,
};
