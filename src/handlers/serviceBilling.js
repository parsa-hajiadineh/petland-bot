const prisma = require("../database/prisma");
const { reply, notify } = require("../bot/messenger");
const bale = require("../bot/bale");
const { getBotContext } = require("../bot/context");
const { ADMIN_BALE_IDS } = require("../config");
const { BTN, kb, inlineKb, backMain, mainMenu, tenantAdminMenu } = require("../keyboards/menus");
const { formatPrice } = require("../utils/price");
const packages = require("../services/servicePackages");
const invoices = require("../services/serviceInvoices");

const MOTHER_LIST = "SB:I:LIST";
const MOTHER_VIEW = "SB:I:VIEW";
const MOTHER_CART = "SB:I:CART";
const TENANT_LIST = "TS:SUB:LIST";
const TENANT_VIEW = "TS:SUB:VIEW";
const TENANT_CART = "TS:SUB:CART";
const REQUIRED_INITIAL = "SETUP_FIRST_MONTH";
const REQUIRED_RENEWAL = "MONTHLY_SUB";

function catalogMenu(source) {
  const rows = [[{ text: BTN.SVC_PROFORMA }], [{ text: BTN.BACK_PRODUCT_LIST }]];
  if (source === "mother") rows.push([{ text: BTN.BACK_MAIN }]);
  return kb(rows);
}

function detailMenu() {
  return kb([[{ text: BTN.SVC_SELECT }], [{ text: BTN.BACK_PRODUCT_LIST }]]);
}

function proformaMenu() {
  return kb([[{ text: BTN.SVC_ISSUE }], [{ text: BTN.BACK_PRODUCT_LIST }]]);
}

function isMotherStep(step) {
  return Boolean(step && String(step).startsWith("SB:I:"));
}

function isTenantStep(step) {
  return Boolean(step && String(step).startsWith("TS:SUB:"));
}

async function shopHasBot(tenantId) {
  if (!tenantId) return false;
  try {
    if (prisma.bot?.findUnique) {
      const bot = await prisma.bot.findUnique({ where: { tenantId } });
      if (bot) return true;
    }
  } catch (err) {
    console.error("SHOP BOT LOOKUP SKIP:", err.message);
  }
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Bot" WHERE "tenantId" = $1 LIMIT 1`,
      tenantId
    );
    return Boolean(rows?.[0]);
  } catch (err) {
    console.error("SHOP BOT SQL SKIP:", err.message);
    return false;
  }
}

async function tenantFlowKind(tenantId) {
  if (await shopHasBot(tenantId)) return "RENEWAL";
  const hasInitial = await invoices.hasInitialInvoice(tenantId);
  return hasInitial ? "RENEWAL" : "INITIAL";
}

async function visiblePackages(tenantId) {
  const list = await packages.listActivePackages();
  if (!(await shopHasBot(tenantId))) return list;
  return list.filter((pack) => pack.code !== REQUIRED_INITIAL);
}

async function notifyMotherAdmins(text) {
  for (const adminId of ADMIN_BALE_IDS || []) {
    try {
      await notify(adminId, text);
    } catch (err) {
      console.error("SERVICE INVOICE ADMIN NOTIFY:", adminId, err.message);
    }
  }
}

function requiredCode(flow) {
  return flow === "RENEWAL" ? REQUIRED_RENEWAL : REQUIRED_INITIAL;
}

async function setMotherStep(user, step, tenantId) {
  await prisma.user.update({
    where: { id: user.id },
    data: {
      orderStep: step,
      ...(tenantId ? { pendingOrderId: tenantId } : {}),
    },
  });
  user.orderStep = step;
  if (tenantId) user.pendingOrderId = tenantId;
}

async function setTenantStep(user, step) {
  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: step },
  });
  user.adminStep = step;
}

async function currentContext(user) {
  const mother = isMotherStep(user.orderStep);
  const tenant = isTenantStep(user.adminStep);
  if (!mother && !tenant) return null;
  const source = mother ? "mother" : "tenant";
  const tenantId =
    source === "tenant" ? getBotContext().tenantId : user.pendingOrderId;
  const flow = await tenantFlowKind(tenantId);
  const phase = mother
    ? user.orderStep.split(":")[2]
    : user.adminStep.split(":")[2];
  return { source, flow, phase, tenantId };
}

function uniquePacks(list) {
  const seen = new Set();
  const out = [];
  for (const pack of list || []) {
    if (!pack?.id || seen.has(pack.id)) continue;
    seen.add(pack.id);
    out.push(pack);
  }
  return out;
}

async function requiredPackage(flow) {
  const code = requiredCode(flow);
  const all = await packages.listActivePackages();
  return all.find((pack) => pack.code === code) || null;
}

async function selectedPacks(user, tenantId) {
  const picks = await packages.listPicks(user.id);
  const ids = [...new Set(picks.map((row) => row.packageId))];
  const all = await visiblePackages(tenantId);
  const byId = new Map(all.map((pack) => [pack.id, pack]));
  return uniquePacks(ids.map((id) => byId.get(id)).filter(Boolean));
}

async function addPick(userId, packageId) {
  const picks = await packages.listPicks(userId);
  const ids = [...new Set(picks.map((row) => row.packageId))];
  if (ids.includes(packageId)) return false;
  await packages.replacePicks(userId, [...ids, packageId]);
  return true;
}

async function removePick(userId, packageId) {
  const picks = await packages.listPicks(userId);
  const ids = [...new Set(picks.map((row) => row.packageId))].filter(
    (id) => id !== packageId
  );
  await packages.replacePicks(userId, ids);
}

async function ensureRequired(user, flow) {
  const required = await requiredPackage(flow);
  if (!required) return null;
  await addPick(user.id, required.id);
  return required;
}

async function sendInline(user, chatId, caption, rows) {
  const result = await bale.sendKeyboard(chatId, caption, inlineKb(rows));
  const msgId = result?.result?.message_id;
  if (msgId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastMessageId: msgId },
    });
  }
}

async function showCatalog(user, chatId, ctx) {
  if (ctx.source === "mother") await setMotherStep(user, MOTHER_LIST);
  else await setTenantStep(user, TENANT_LIST);
  const list = await visiblePackages(ctx.tenantId);
  if (!list.length) {
    await reply(
      user,
      chatId,
      "سرویس فعالی برای انتخاب نیست.",
      ctx.source === "tenant" ? tenantAdminMenu() : backMain()
    );
    return;
  }
  await reply(
    user,
    chatId,
    "💳 خرید اشتراک\nروی هر مورد بزنید تا توضیحات را ببینید. بعد از انتخاب‌ها، پیش‌فاکتور را باز کنید.",
    catalogMenu(ctx.source)
  );
  const rows = list.map((pack) => [
    {
      text: `${pack.title} | ${formatPrice(pack.priceToman)}`,
      callback_data: `sbv:${pack.id}`.slice(0, 64),
    },
  ]);
  await sendInline(user, chatId, "خدمات:", rows);
}

async function showDetail(user, chatId, packId) {
  const ctx = await currentContext(user);
  if (!ctx) return false;
  const pack = await packages.getPackage(packId);
  if (!pack || !pack.isActive || pack.isArchived) {
    await reply(user, chatId, "این مورد الان قابل انتخاب نیست.");
    return true;
  }
  if (pack.code === REQUIRED_INITIAL && (await shopHasBot(ctx.tenantId))) {
    await reply(
      user,
      chatId,
      "ربات این فروشگاه قبلاً راه‌اندازی شده و پکیج راه‌اندازی قابل انتخاب نیست."
    );
    return true;
  }
  if (ctx.source === "mother") {
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: MOTHER_VIEW, lastProductCode: pack.id },
    });
    user.orderStep = MOTHER_VIEW;
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: TENANT_VIEW, lastProductCode: pack.id },
    });
    user.adminStep = TENANT_VIEW;
  }
  user.lastProductCode = pack.id;
  const desc = (pack.description || "").trim() || "توضیحی ثبت نشده است.";
  await reply(
    user,
    chatId,
    `💼 ${pack.title}\n\n💰 ${formatPrice(pack.priceToman)}\n\n${desc}`,
    detailMenu()
  );
  return true;
}

async function showProforma(user, chatId) {
  const ctx = await currentContext(user);
  if (!ctx) return false;
  const required = await ensureRequired(user, ctx.flow);
  if (ctx.source === "mother") await setMotherStep(user, MOTHER_CART);
  else await setTenantStep(user, TENANT_CART);
  const chosen = await selectedPacks(user, ctx.tenantId);
  const requiredId = required?.id;
  const quote = invoices.buildQuote(chosen, ctx.flow);
  const lines = ["🧾 پیش فاکتور", "━━━━━━━━━━━━━━━━━━", ""];
  for (const pack of chosen) {
    const tag = pack.id === requiredId ? " (اجباری)" : "";
    lines.push(`• ${pack.title}${tag}`);
    lines.push(`  ${formatPrice(pack.priceToman)}`);
  }
  lines.push("", `جمع: ${formatPrice(quote.totalAmount)}`);
  const removable = chosen.filter((pack) => pack.id !== requiredId);
  if (removable.length) {
    lines.push("", "برای حذف یک مورد اختیاری روی آن بزنید.");
  }
  await reply(user, chatId, lines.join("\n"), proformaMenu());
  if (removable.length) {
    const rows = removable.map((pack) => [
      {
        text: `🗑 ${pack.title}`,
        callback_data: `sbx:${pack.id}`.slice(0, 64),
      },
    ]);
    await sendInline(user, chatId, "حذف از پیش‌فاکتور:", rows);
  }
  return true;
}

async function startInitial(user, chatId, tenantId) {
  await packages.replacePicks(user.id, []);
  await invoices.ensureServiceInvoices();
  await setMotherStep(user, MOTHER_LIST, tenantId);
  await showCatalog(user, chatId, {
    source: "mother",
    flow: "INITIAL",
    tenantId,
  });
}

async function startTenantSubscribe(user, chatId, tenantId) {
  await packages.replacePicks(user.id, []);
  await invoices.ensureServiceInvoices();
  const flow = await tenantFlowKind(tenantId);
  await setTenantStep(user, TENANT_LIST);
  await showCatalog(user, chatId, { source: "tenant", flow, tenantId });
}

async function selectCurrent(user, chatId) {
  const ctx = await currentContext(user);
  if (!ctx || ctx.phase !== "VIEW") return false;
  const packId = user.lastProductCode;
  const pack = await packages.getPackage(packId);
  if (!pack || !pack.isActive || pack.isArchived) {
    await reply(user, chatId, "این مورد الان قابل انتخاب نیست.", detailMenu());
    return true;
  }
  if (pack.code === REQUIRED_INITIAL && (await shopHasBot(ctx.tenantId))) {
    await reply(
      user,
      chatId,
      "ربات این فروشگاه قبلاً راه‌اندازی شده و پکیج راه‌اندازی قابل انتخاب نیست.",
      catalogMenu(ctx.source)
    );
    return true;
  }
  const added = await addPick(user.id, pack.id);
  await reply(
    user,
    chatId,
    added ? "✅ به پیش‌فاکتور اضافه شد." : "این مورد از قبل در پیش‌فاکتور هست.",
    detailMenu()
  );
  return true;
}

async function removeFromProforma(user, chatId, packageId) {
  const ctx = await currentContext(user);
  if (!ctx) return false;
  const required = await requiredPackage(ctx.flow);
  if (required && required.id === packageId) {
    await reply(user, chatId, "این مورد اجباری است و از پیش‌فاکتور حذف نمی‌شود.");
    await showProforma(user, chatId);
    return true;
  }
  await removePick(user.id, packageId);
  await showProforma(user, chatId);
  return true;
}

async function issueInvoice(user, chatId) {
  const ctx = await currentContext(user);
  if (!ctx) return false;
  if (ctx.phase !== "CART") {
    await showProforma(user, chatId);
    return true;
  }
  await ensureRequired(user, ctx.flow);
  const chosen = await selectedPacks(user, ctx.tenantId);
  const tenantId =
    ctx.tenantId ||
    (ctx.source === "tenant" ? getBotContext().tenantId : user.pendingOrderId);
  try {
    const invoice = await invoices.createInvoice({
      userId: user.id,
      tenantId,
      kind: ctx.flow,
      packs: chosen,
    });
    await packages.replacePicks(user.id, []);
    const waitNote =
      ctx.source === "mother" && ctx.flow === "INITIAL"
        ? "\n\nتا تایید پرداخت توسط ادمین پت‌لند امکان ساخت ربات نیست. بعد از تایید، از ربات مادر دکمه «ساخت ربات فروشگاهی» را بزنید."
        : "\n\nبعد از تایید پرداخت توسط ادمین پت‌لند، وضعیت این فاکتور به‌روز می‌شود.";
    await prisma.user.update({
      where: { id: user.id },
      data:
        ctx.source === "tenant"
          ? { adminStep: "TS:MENU" }
          : { orderStep: null, pendingOrderId: null },
    });
    if (ctx.source === "tenant") user.adminStep = "TS:MENU";
    else {
      user.orderStep = null;
      user.pendingOrderId = null;
    }
    await reply(
      user,
      chatId,
      `${invoices.formatInvoiceText(invoice)}\n\nقیمت این فاکتور قفل شد و با تغییر پکیج‌ها عوض نمی‌شود.${waitNote}`,
      ctx.source === "tenant" ? tenantAdminMenu() : mainMenu(user)
    );
    await notifyMotherAdmins(
      `🧾 فاکتور خدمات جدید\n🔖 ${invoice.trackingCode}\n💰 ${formatPrice(
        invoice.totalAmount
      )}\n\nاز پنل ادمین → فاکتور خدمات همکاران تایید کنید.`
    );
  } catch (err) {
    console.error("SERVICE INVOICE ISSUE:", err);
    await reply(user, chatId, "صدور فاکتور ممکن نشد. دوباره تلاش کنید.");
  }
  return true;
}

async function handleCallback(user, chatId, data) {
  if (data.startsWith("sbv:")) return showDetail(user, chatId, data.slice(4));
  if (data.startsWith("sbx:")) return removeFromProforma(user, chatId, data.slice(4));
  if (data === "sbinv") return issueInvoice(user, chatId);
  return false;
}

async function handleText(user, chatId, text) {
  const ctx = await currentContext(user);
  if (!ctx) return false;
  if (text === BTN.SVC_SELECT) return selectCurrent(user, chatId);
  if (text === BTN.SVC_PROFORMA) return showProforma(user, chatId);
  if (text === BTN.SVC_ISSUE) return issueInvoice(user, chatId);
  if (text === BTN.BACK_PRODUCT_LIST) return goBack(user, chatId);
  if (text === BTN.BACK_MAIN) return false;
  return true;
}

async function goBack(user, chatId) {
  const ctx = await currentContext(user);
  if (!ctx) return false;
  if (ctx.phase === "VIEW" || ctx.phase === "CART") {
    await showCatalog(user, chatId, ctx);
    return true;
  }
  if (ctx.source === "tenant") {
    const tenantAdmin = require("./tenantAdmin");
    await tenantAdmin.showAdminHome(user, chatId);
    return true;
  }
  return false;
}

async function showInvoiceList(user, chatId, tenantId) {
  const rows = await invoices.listInvoices(tenantId, 10);
  if (!rows.length) {
    await reply(user, chatId, "هنوز فاکتور خدماتی صادر نشده.", tenantAdminMenu());
    return;
  }
  const lines = ["🧾 فاکتورهای خدمات", ""];
  for (const inv of rows) {
    const label = inv.kind === "INITIAL" ? "راه‌اندازی" : "ماهانه";
    const status = inv.status === "APPROVED" ? "تایید شده" : "در انتظار تایید";
    lines.push(
      `🔖 ${inv.trackingCode} | ${label} | ${formatPrice(inv.totalAmount)} | ${status}`
    );
  }
  lines.push("", "مبالغ فاکتورهای قبلی با تغییر قیمت پکیج عوض نمی‌شوند.");
  await reply(user, chatId, lines.join("\n"), tenantAdminMenu());
}

module.exports = {
  startInitial,
  startTenantSubscribe,
  handleCallback,
  handleText,
  goBack,
  isMotherStep,
  isTenantStep,
  showInvoiceList,
};
