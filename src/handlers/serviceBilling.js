const prisma = require("../database/prisma");
const { reply } = require("../bot/messenger");
const bale = require("../bot/bale");
const { getBotContext } = require("../bot/context");
const { BTN, kb, inlineKb, backMain, tenantAdminMenu } = require("../keyboards/menus");
const { formatPrice } = require("../utils/price");
const packages = require("../services/servicePackages");
const invoices = require("../services/serviceInvoices");

const MOTHER_PKG = "SB:I:PKG";
const MOTHER_SVC = "SB:I:SVC";
const MOTHER_INV = "SB:I:INV";
const TENANT_PKG = "TS:SUB:PKG";
const TENANT_SVC = "TS:SUB:SVC";
const TENANT_INV = "TS:SUB:INV";

function wizardMenu() {
  return kb([[{ text: BTN.SVC_CONFIRM }], [{ text: BTN.BACK_PRODUCT_LIST }], [{ text: BTN.BACK_MAIN }]]);
}

function invoiceMenu() {
  return kb([
    [{ text: BTN.SVC_ISSUE }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
    [{ text: BTN.BACK_MAIN }],
  ]);
}

function isMotherStep(step) {
  return Boolean(step && String(step).startsWith("SB:I:"));
}

function isTenantStep(step) {
  return Boolean(step && String(step).startsWith("TS:SUB:"));
}

async function tenantFlowKind(tenantId) {
  const hasInitial = await invoices.hasInitialInvoice(tenantId);
  return hasInitial ? "RENEWAL" : "INITIAL";
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

function packageFilter(flow, phase) {
  if (phase === "PKG") {
    return {
      kind: "PACKAGE",
      billing: flow === "RENEWAL" ? "MONTHLY" : "ONCE",
    };
  }
  if (flow === "RENEWAL") return { kind: "SERVICE", billing: "MONTHLY" };
  return { kind: "SERVICE" };
}

async function selectedFor(user, filter) {
  const picks = await packages.listPicks(user.id);
  const ids = new Set(picks.map((row) => row.packageId));
  const list = await packages.listActivePackages(filter);
  return list.filter((pack) => ids.has(pack.id));
}

async function allSelected(user, flow) {
  const pkg = await selectedFor(user, packageFilter(flow, "PKG"));
  const svc = await selectedFor(user, packageFilter(flow, "SVC"));
  return [...pkg, ...svc];
}

async function showPicker(user, chatId, { source, flow, phase }) {
  const filter = packageFilter(flow, phase);
  const list = await packages.listActivePackages(filter);
  const picks = await packages.listPicks(user.id);
  const selected = new Set(picks.map((row) => row.packageId));
  const chosen = list.filter((pack) => selected.has(pack.id));
  const isPkg = phase === "PKG";
  const title = isPkg
    ? flow === "RENEWAL"
      ? "📦 پکیج اشتراک ماه بعد"
      : "📦 انتخاب پکیج راه‌اندازی"
    : flow === "RENEWAL"
      ? "🛠 خدمات ماه بعد"
      : "🛠 خدمات تکمیلی";
  const hint = isPkg
    ? "حداقل یک پکیج را انتخاب کنید."
    : "خدمات اختیاری‌اند؛ هر مورد را که می‌خواهید بزنید.";

  if (!list.length && isPkg) {
    await reply(
      user,
      chatId,
      "پکیج فعالی برای این مرحله نیست.",
      source === "tenant" ? tenantAdminMenu() : backMain()
    );
    if (source === "mother") {
      const colleague = require("./colleague");
      await colleague.continueAfterInvoice(user, chatId, user.pendingOrderId);
    }
    return;
  }

  if (!list.length && !isPkg) {
    await showPreview(user, chatId, { source, flow });
    return;
  }

  const lines = [title, hint, ""];
  for (const pack of list) {
    const mark = selected.has(pack.id) ? "✅" : "▫️";
    lines.push(`${mark} ${pack.title}`);
    lines.push(`   ${formatPrice(pack.priceToman)}`);
    if (pack.description) lines.push(`   ${pack.description}`);
    lines.push("");
  }
  if (chosen.length) {
    const sum = chosen.reduce((n, pack) => n + pack.priceToman, 0);
    lines.push(`جمع این مرحله: ${formatPrice(sum)}`);
  }

  const prefix = isPkg ? "sbp:" : "sbs:";
  const rows = list.map((pack) => [
    {
      text: `${selected.has(pack.id) ? "✅" : "➕"} ${pack.title}`,
      callback_data: `${prefix}${pack.id}`.slice(0, 64),
    },
  ]);
  rows.push([{ text: BTN.SVC_CONFIRM, callback_data: "sbok" }]);

  await reply(
    user,
    chatId,
    lines.join("\n"),
    source === "tenant" ? wizardMenu() : backMain()
  );
  const result = await bale.sendKeyboard(
    chatId,
    "روی مورد بزنید تا انتخاب شود:",
    inlineKb(rows)
  );
  const msgId = result?.result?.message_id;
  if (msgId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastMessageId: msgId },
    });
  }
}

async function showPreview(user, chatId, { source, flow }) {
  const chosen = await allSelected(user, flow);
  const pkg = await selectedFor(user, packageFilter(flow, "PKG"));
  if (!pkg.length) {
    await reply(user, chatId, "حداقل یک پکیج انتخاب کنید.", wizardMenu());
    await showPicker(user, chatId, { source, flow, phase: "PKG" });
    return;
  }
  if (source === "mother") await setMotherStep(user, MOTHER_INV);
  else await setTenantStep(user, TENANT_INV);
  const quote = invoices.buildQuote(chosen, flow);
  const text = `${invoices.formatQuoteText(quote, flow)}\n\nاگر مورد تأیید است صدور فاکتور را بزنید.`;
  await reply(user, chatId, text, invoiceMenu());
}

async function startInitial(user, chatId, tenantId) {
  await packages.replacePicks(user.id, []);
  await invoices.ensureServiceInvoices();
  await setMotherStep(user, MOTHER_PKG, tenantId);
  await showPicker(user, chatId, {
    source: "mother",
    flow: "INITIAL",
    phase: "PKG",
  });
}

async function startTenantSubscribe(user, chatId, tenantId) {
  await packages.replacePicks(user.id, []);
  await invoices.ensureServiceInvoices();
  const flow = await tenantFlowKind(tenantId);
  await setTenantStep(user, TENANT_PKG);
  await showPicker(user, chatId, { source: "tenant", flow, phase: "PKG" });
}

async function currentContext(user) {
  const mother = isMotherStep(user.orderStep);
  const tenant = isTenantStep(user.adminStep);
  if (!mother && !tenant) return null;
  const source = mother ? "mother" : "tenant";
  let flow = "INITIAL";
  if (source === "tenant") {
    const tenantId = getBotContext().tenantId;
    flow = await tenantFlowKind(tenantId);
  }
  const phase = mother
    ? user.orderStep.split(":")[2]
    : user.adminStep.split(":")[2];
  return { source, flow, phase };
}

async function toggle(user, chatId, packageId, expectedKind) {
  const ctx = await currentContext(user);
  if (!ctx) return false;
  const pack = await packages.getPackage(packageId);
  if (!pack || !pack.isActive || pack.isArchived) {
    await reply(user, chatId, "این مورد الان قابل انتخاب نیست.");
    return true;
  }
  if (pack.kind !== expectedKind) return true;
  const picks = await packages.listPicks(user.id);
  const ids = picks.map((row) => row.packageId);
  const next = ids.includes(packageId)
    ? ids.filter((id) => id !== packageId)
    : [...ids, packageId];
  await packages.replacePicks(user.id, next);
  await showPicker(user, chatId, ctx);
  return true;
}

async function confirmPhase(user, chatId) {
  const ctx = await currentContext(user);
  if (!ctx) return false;
  if (ctx.phase === "PKG") {
    const pkg = await selectedFor(user, packageFilter(ctx.flow, "PKG"));
    if (!pkg.length) {
      await reply(user, chatId, "حداقل یک پکیج را انتخاب کنید.");
      await showPicker(user, chatId, ctx);
      return true;
    }
    if (ctx.source === "mother") await setMotherStep(user, MOTHER_SVC);
    else await setTenantStep(user, TENANT_SVC);
    await showPicker(user, chatId, { ...ctx, phase: "SVC" });
    return true;
  }
  if (ctx.phase === "SVC" || ctx.phase === "INV") {
    await showPreview(user, chatId, ctx);
    return true;
  }
  return true;
}

async function issueInvoice(user, chatId) {
  const ctx = await currentContext(user);
  if (!ctx) return false;
  const chosen = await allSelected(user, ctx.flow);
  const pkg = await selectedFor(user, packageFilter(ctx.flow, "PKG"));
  if (!pkg.length) {
    await reply(user, chatId, "حداقل یک پکیج انتخاب کنید.");
    return true;
  }
  const tenantId =
    ctx.source === "tenant" ? getBotContext().tenantId : user.pendingOrderId;
  try {
    const invoice = await invoices.createInvoice({
      userId: user.id,
      tenantId,
      kind: ctx.flow,
      packs: chosen,
    });
    await packages.replacePicks(user.id, []);
    await reply(
      user,
      chatId,
      `${invoices.formatInvoiceText(invoice)}\n\nقیمت این فاکتور قفل شد و با تغییر پکیج‌ها عوض نمی‌شود.`,
      ctx.source === "tenant" ? tenantAdminMenu() : backMain()
    );
    if (ctx.source === "mother") {
      const colleague = require("./colleague");
      await colleague.continueAfterInvoice(user, chatId, tenantId);
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: { adminStep: "TS:MENU" },
      });
      user.adminStep = "TS:MENU";
    }
  } catch (err) {
    console.error("SERVICE INVOICE ISSUE:", err);
    await reply(user, chatId, "صدور فاکتور ممکن نشد. دوباره تلاش کنید.");
  }
  return true;
}

async function handleCallback(user, chatId, data) {
  if (data === "sbok") return confirmPhase(user, chatId);
  if (data === "sbinv") return issueInvoice(user, chatId);
  if (data.startsWith("sbp:")) return toggle(user, chatId, data.slice(4), "PACKAGE");
  if (data.startsWith("sbs:")) return toggle(user, chatId, data.slice(4), "SERVICE");
  return false;
}

async function handleText(user, chatId, text) {
  const ctx = await currentContext(user);
  if (!ctx) return false;
  if (text === BTN.SVC_CONFIRM) return confirmPhase(user, chatId);
  if (text === BTN.SVC_ISSUE) return issueInvoice(user, chatId);
  if (text === BTN.BACK_PRODUCT_LIST) return goBack(user, chatId);
  if (text === BTN.BACK_MAIN) return false;
  return true;
}

async function goBack(user, chatId) {
  const ctx = await currentContext(user);
  if (!ctx) return false;
  if (ctx.phase === "INV") {
    if (ctx.source === "mother") await setMotherStep(user, MOTHER_SVC);
    else await setTenantStep(user, TENANT_SVC);
    await showPicker(user, chatId, { ...ctx, phase: "SVC" });
    return true;
  }
  if (ctx.phase === "SVC") {
    if (ctx.source === "mother") await setMotherStep(user, MOTHER_PKG);
    else await setTenantStep(user, TENANT_PKG);
    await showPicker(user, chatId, { ...ctx, phase: "PKG" });
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
    lines.push(`🔖 ${inv.trackingCode} | ${label} | ${formatPrice(inv.totalAmount)}`);
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
