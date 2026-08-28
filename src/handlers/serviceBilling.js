const prisma = require("../database/prisma");
const { reply, notifyMother } = require("../bot/messenger");
const bale = require("../bot/bale");
const { getBotContext } = require("../bot/context");
const { ADMIN_BALE_IDS } = require("../config");
const { BTN, kb, inlineKb, backMain, mainMenu, tenantAdminMenu, paymentMenu } = require("../keyboards/menus");
const { formatPrice } = require("../utils/price");
const { buildPaymentInfo } = require("../utils/invoice");
const packages = require("../services/servicePackages");
const invoices = require("../services/serviceInvoices");
const creditLedger = require("../services/creditLedger");

const MOTHER_LIST = "SB:I:LIST";
const MOTHER_VIEW = "SB:I:VIEW";
const MOTHER_CART = "SB:I:CART";
const MOTHER_CART_CREDIT = "SB:I:CCR";
const TENANT_LIST = "TS:SUB:LIST";
const TENANT_VIEW = "TS:SUB:VIEW";
const TENANT_CART = "TS:SUB:CART";
const TENANT_CART_CREDIT = "TS:SUB:CCR";
const TENANT_PAY = "TS:SUB:PAY";
const TENANT_INV_LIST = "TS:SINV:LIST";
const TENANT_INV_VIEW = "TS:SINV:VIEW";
const MOTHER_PAY = "SB:I:PAY";
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

function proformaMenu(usingCredit, canUseCredit) {
  const rows = [
    [{ text: usingCredit ? BTN.SVC_CONFIRM_PROFORMA : BTN.SVC_ISSUE }],
  ];
  if (!usingCredit && canUseCredit) {
    rows.push([{ text: BTN.SVC_USE_CREDIT }]);
  }
  if (usingCredit) {
    rows.push([{ text: BTN.SVC_PAY_CASH }]);
  }
  rows.push([{ text: BTN.BACK_PRODUCT_LIST }]);
  return kb(rows);
}

function tenantPayMenu() {
  return kb([
    [{ text: BTN.UPLOAD_RECEIPT }],
    [{ text: BTN.BACK_PRODUCT_LIST }],
  ]);
}

function invoiceListMenu() {
  return kb([[{ text: BTN.BACK_PRODUCT_LIST }]]);
}

function isMotherStep(step) {
  return Boolean(step && String(step).startsWith("SB:I:"));
}

function isTenantStep(step) {
  return Boolean(step && String(step).startsWith("TS:SUB:"));
}

function isTenantInvoiceStep(step) {
  return Boolean(step && String(step).startsWith("TS:SINV:"));
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
  const hasApproved = await invoices.hasApprovedInitialInvoice(tenantId);
  return hasApproved ? "RENEWAL" : "INITIAL";
}

async function visiblePackages(tenantId) {
  const list = await packages.listActivePackages();
  if (!(await shopHasBot(tenantId))) return list;
  return list.filter((pack) => pack.code !== REQUIRED_INITIAL);
}

const OPEN_INVOICE_MSG = `امکان خرید اشتراک جدید نیست.

آخرین فاکتور خدمات هنوز تایید یا رد نشده است.
اگر رسید نفرستاده‌اید از «فاکتورهای خدمات» همان فاکتور را پرداخت کنید.
پس از تایید یا رد ادمین می‌توانید دوباره اشتراک بخرید.`;

async function notifyMotherAdmins(text) {
  for (const adminId of ADMIN_BALE_IDS || []) {
    try {
      await notifyMother(adminId, text);
    } catch (err) {
      console.error("SERVICE INVOICE ADMIN NOTIFY:", adminId, err.message);
    }
  }
}

async function blockIfOpenInvoice(user, chatId, tenantId, source) {
  const open = await invoices.getOpenInvoice(tenantId);
  if (!open) return false;
  const keyboard = source === "tenant" ? tenantAdminMenu() : mainMenu(user);
  await reply(user, chatId, OPEN_INVOICE_MSG, keyboard);
  return true;
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

function isCartPhase(phase) {
  return phase === "CART" || phase === "CCR";
}

function isUsingCredit(ctx) {
  return ctx?.phase === "CCR";
}

async function setCartStep(user, ctx, usingCredit) {
  if (ctx.source === "mother") {
    await setMotherStep(user, usingCredit ? MOTHER_CART_CREDIT : MOTHER_CART);
  } else {
    await setTenantStep(user, usingCredit ? TENANT_CART_CREDIT : TENANT_CART);
  }
}

async function loadAvailableCredit(user, tenantId) {
  try {
    const wallet = await creditLedger.getOrCreateWallet({
      tenantId,
      userId: user.id,
    });
    if (!wallet) return 0;
    return await creditLedger.getBalance(wallet.id);
  } catch (err) {
    console.error("SERVICE CREDIT BALANCE SKIP:", err.message);
    return 0;
  }
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

async function showCatalog(user, chatId, ctx, prefix = "") {
  if (ctx.source === "mother") await setMotherStep(user, MOTHER_LIST);
  else await setTenantStep(user, TENANT_LIST);
  const list = await visiblePackages(ctx.tenantId);
  if (!list.length) {
    await reply(
      user,
      chatId,
      `${prefix}سرویس فعالی برای انتخاب نیست.`,
      ctx.source === "tenant" ? tenantAdminMenu() : backMain()
    );
    return;
  }
  await reply(
    user,
    chatId,
    `${prefix}💳 خرید اشتراک\nروی هر مورد بزنید تا توضیحات را ببینید. بعد از انتخاب‌ها، پیش‌فاکتور را باز کنید.`,
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

async function showProforma(user, chatId, usingCredit = false) {
  const ctx = await currentContext(user);
  if (!ctx) return false;
  const required = await ensureRequired(user, ctx.flow);
  const wantCredit = usingCredit || isUsingCredit(ctx);
  await setCartStep(user, ctx, wantCredit);
  const chosen = await selectedPacks(user, ctx.tenantId);
  const requiredId = required?.id;
  const quote = invoices.buildQuote(chosen, ctx.flow);
  const available = await loadAvailableCredit(user, ctx.tenantId);
  const split = invoices.splitPayment(quote.totalAmount, available, wantCredit);
  const canUseCredit = available > 0 && quote.totalAmount > 0;
  const lines = ["🧾 پیش فاکتور", "━━━━━━━━━━━━━━━━━━", ""];
  for (const pack of chosen) {
    const tag = pack.id === requiredId ? " (اجباری)" : "";
    lines.push(`• ${pack.title}${tag}`);
    lines.push(`  ${formatPrice(pack.priceToman)}`);
  }
  lines.push("", `جمع فاکتور: ${formatPrice(quote.totalAmount)}`);
  lines.push(`روش پرداخت: ${invoices.paymentMethodLabel(split.paymentMethod)}`);
  if (wantCredit) {
    lines.push(`موجودی اعتبار: ${formatPrice(available)}`);
    lines.push(`پرداخت اعتباری: ${formatPrice(split.creditAmount)}`);
  }
  lines.push(`قابل پرداخت نقدی: ${formatPrice(split.cashAmount)}`);
  const removable = chosen.filter((pack) => pack.id !== requiredId);
  if (wantCredit) {
    lines.push(
      "",
      "در صورت تایید، اعتبار تا سقف فاکتور رزرو می‌شود و بعد از تایید ادمین قطعی می‌گردد."
    );
    if (split.cashAmount > 0) {
      lines.push("باقی‌مانده را کارت‌به‌کارت واریز کنید و رسید بفرستید.");
    }
    lines.push("برای تایید دکمه «تایید پیش فاکتور» را بزنید.");
  } else {
    lines.push(
      "",
      "برای حذف سرویس مد نظر روی نام آن بزنید و یا در صورت تایید پیش فاکتور دکمه «صدور فاکتور» را فشار دهید"
    );
  }
  await reply(
    user,
    chatId,
    lines.join("\n"),
    proformaMenu(wantCredit && split.creditAmount > 0, canUseCredit)
  );
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
  if (await blockIfOpenInvoice(user, chatId, tenantId, "mother")) return;
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
  if (await blockIfOpenInvoice(user, chatId, tenantId, "tenant")) return;
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
  const note = added
    ? "✅ به پیش‌فاکتور اضافه شد.\n\n"
    : "این مورد از قبل در پیش‌فاکتور هست.\n\n";
  await showCatalog(user, chatId, ctx, note);
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

async function applyProformaCredit(user, chatId) {
  const ctx = await currentContext(user);
  if (!ctx) return false;
  const available = await loadAvailableCredit(user, ctx.tenantId);
  if (available <= 0) {
    await reply(user, chatId, "موجودی اعتبار کیف پول صفر است.");
    await showProforma(user, chatId, false);
    return true;
  }
  await showProforma(user, chatId, true);
  return true;
}

async function issueInvoice(user, chatId) {
  const ctx = await currentContext(user);
  if (!ctx) return false;
  if (!isCartPhase(ctx.phase)) {
    await showProforma(user, chatId);
    return true;
  }
  await ensureRequired(user, ctx.flow);
  const chosen = await selectedPacks(user, ctx.tenantId);
  const tenantId =
    ctx.tenantId ||
    (ctx.source === "tenant" ? getBotContext().tenantId : user.pendingOrderId);
  const wantCredit = isUsingCredit(ctx);
  const available = wantCredit
    ? await loadAvailableCredit(user, tenantId)
    : 0;
  const quote = invoices.buildQuote(chosen, ctx.flow);
  const split = invoices.splitPayment(quote.totalAmount, available, wantCredit);
  try {
    const invoice = await invoices.createInvoice({
      userId: user.id,
      tenantId,
      kind: ctx.flow,
      packs: chosen,
      creditAmount: split.creditAmount,
    });
    if (split.creditAmount > 0) {
      try {
        await creditLedger.reserveForInvoice({
          userId: user.id,
          tenantId,
          invoiceId: invoice.id,
          amount: split.creditAmount,
          createdByUserId: user.id,
        });
      } catch (reserveErr) {
        await invoices.rejectInvoice(invoice.id).catch(() => {});
        throw reserveErr;
      }
    }
    await packages.replacePicks(user.id, []);
    if (split.cashAmount > 0) {
      await startPayment(user, chatId, invoice, ctx.source, tenantId);
    } else {
      await submitZeroCashInvoice(user, chatId, invoice, ctx.source);
    }
  } catch (err) {
    if (err.message === "OPEN_INVOICE") {
      await reply(
        user,
        chatId,
        OPEN_INVOICE_MSG,
        ctx.source === "tenant" ? tenantAdminMenu() : mainMenu(user)
      );
      return true;
    }
    if (err.message === "CREDIT_INSUFFICIENT") {
      await reply(
        user,
        chatId,
        "موجودی اعتبار برای این پیش‌فاکتور کافی نیست. پیش‌فاکتور نقدی را ببینید."
      );
      await showProforma(user, chatId, false);
      return true;
    }
    console.error("SERVICE INVOICE ISSUE:", err);
    await reply(user, chatId, "صدور فاکتور ممکن نشد. دوباره تلاش کنید.");
  }
  return true;
}

function payKeyboard(source) {
  return source === "tenant" ? tenantPayMenu() : paymentMenu();
}

async function submitZeroCashInvoice(user, chatId, invoice, source) {
  await invoices.markWaitingApproval(invoice.id, null);
  const shown = (await invoices.getInvoice(invoice.id)) || invoice;
  if (source === "tenant") {
    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: "TS:MENU", pendingOrderId: null },
    });
    user.adminStep = "TS:MENU";
    user.pendingOrderId = null;
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: null, pendingOrderId: null },
    });
    user.orderStep = null;
    user.pendingOrderId = null;
  }
  await reply(
    user,
    chatId,
    `✅ پیش‌فاکتور تایید شد.\n\n${invoices.formatInvoiceText(
      shown
    )}\n\nرقم نقدی صفر است. فاکتور برای بررسی ادمین ارسال شد.`,
    source === "tenant" ? tenantAdminMenu() : mainMenu(user)
  );
  await notifyMotherAdmins(
    `🧾 فاکتور خدمات اعتباری\n🔖 ${invoice.trackingCode}\n💰 جمع: ${formatPrice(
      invoice.totalAmount
    )}\n💳 اعتبار رزرو: ${formatPrice(
      invoice.creditAmount || 0
    )}\n💵 نقدی: ${formatPrice(0)}\n\nاز پنل ادمین → فاکتور خدمات همکاران بررسی کنید.`
  );
}

async function startPayment(user, chatId, invoice, source, tenantId) {
  if (source === "tenant") {
    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: TENANT_PAY, pendingOrderId: invoice.id },
    });
    user.adminStep = TENANT_PAY;
    user.pendingOrderId = invoice.id;
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        orderStep: MOTHER_PAY,
        pendingOrderId: invoice.id,
        ...(tenantId ? {} : {}),
      },
    });
    user.orderStep = MOTHER_PAY;
    user.pendingOrderId = invoice.id;
  }
  const cashDue = Number(
    invoice.cashAmount != null ? invoice.cashAmount : invoice.totalAmount || 0
  );
  const extra =
    source === "mother"
      ? "\n\nتا تایید پرداخت توسط ادمین پت‌لند امکان ساخت ربات نیست."
      : "";
  const cashLine =
    cashDue !== Number(invoice.totalAmount || 0)
      ? `\n\nمبلغ کارت‌به‌کارت: ${formatPrice(cashDue)}`
      : "";
  await reply(
    user,
    chatId,
    `${invoices.formatInvoiceText(invoice)}${cashLine}\n\n${buildPaymentInfo()}${extra}\n\n📸 لطفاً اسکرین‌شات رسید پرداخت را ارسال کنید.`,
    payKeyboard(source)
  );
}

async function handleReceiptPhoto(user, chatId, photo) {
  const motherPay = user.orderStep === MOTHER_PAY;
  const tenantPay =
    user.adminStep === TENANT_PAY || user.adminStep === TENANT_INV_VIEW;
  if (!motherPay && !tenantPay) return false;
  const invoiceId = user.pendingOrderId;
  if (!invoiceId) return false;
  const fileId = photo[photo.length - 1]?.file_id || photo[photo.length - 1]?.fileId;
  if (!fileId) return false;
  const current = await invoices.getInvoice(invoiceId);
  if (!current || current.status === "APPROVED" || current.status === "REJECTED") {
    return false;
  }
  const invoice = await invoices.markWaitingApproval(invoiceId, fileId);
  if (tenantPay) {
    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: "TS:MENU", pendingOrderId: null },
    });
    user.adminStep = "TS:MENU";
    user.pendingOrderId = null;
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: null, pendingOrderId: null },
    });
    user.orderStep = null;
    user.pendingOrderId = null;
  }
  await reply(
    user,
    chatId,
    `✅ رسید دریافت شد.\n\n${invoices.formatInvoiceText(invoice)}\n\nپس از بررسی ادمین، نتیجه اعلام می‌شود.`,
    tenantPay ? tenantAdminMenu() : mainMenu(user)
  );
  await notifyMotherAdmins(
    `🧾 رسید فاکتور خدمات\n🔖 ${invoice.trackingCode}\n💰 جمع: ${formatPrice(
      invoice.totalAmount
    )}\n💵 نقدی: ${formatPrice(
      invoice.cashAmount != null ? invoice.cashAmount : invoice.totalAmount
    )}\n💳 اعتبار: ${formatPrice(
      invoice.creditAmount || 0
    )}\n\nاز پنل ادمین → فاکتور خدمات همکاران تایید کنید.`
  );
  return true;
}

async function handleCallback(user, chatId, data) {
  if (data.startsWith("sbv:")) return showDetail(user, chatId, data.slice(4));
  if (data.startsWith("sbx:")) return removeFromProforma(user, chatId, data.slice(4));
  if (data.startsWith("siv:")) {
    return showInvoiceDetail(user, chatId, data.slice(4));
  }
  if (data === "sbinv") return issueInvoice(user, chatId);
  return false;
}

async function handleText(user, chatId, text) {
  if (isTenantInvoiceStep(user.adminStep)) {
    if (text === BTN.UPLOAD_RECEIPT && user.pendingOrderId) {
      const inv = await invoices.getInvoice(user.pendingOrderId);
      if (inv && inv.status === "WAITING_PAYMENT") {
        await startPayment(
          user,
          chatId,
          inv,
          "tenant",
          getBotContext().tenantId
        );
        return true;
      }
    }
    if (text === BTN.BACK_PRODUCT_LIST) {
      if (user.adminStep === TENANT_INV_VIEW) {
        await showInvoiceList(user, chatId, getBotContext().tenantId);
        return true;
      }
      return false;
    }
    if (text === BTN.BACK_MAIN) return false;
    return true;
  }

  const ctx = await currentContext(user);
  if (!ctx) return false;
  if (ctx.phase === "PAY") {
    if (text === BTN.UPLOAD_RECEIPT) {
      await reply(
        user,
        chatId,
        "📸 لطفاً اسکرین‌شات رسید پرداخت را ارسال کنید.",
        payKeyboard(ctx.source)
      );
      return true;
    }
    if (text === BTN.BACK_PRODUCT_LIST) return goBack(user, chatId);
    if (text === BTN.BACK_MAIN) {
      if (ctx.source === "mother") {
        await prisma.user.update({
          where: { id: user.id },
          data: { orderStep: null, pendingOrderId: null },
        });
        user.orderStep = null;
        user.pendingOrderId = null;
      }
      return false;
    }
    return true;
  }
  if (text === BTN.SVC_SELECT) return selectCurrent(user, chatId);
  if (text === BTN.SVC_PROFORMA) return showProforma(user, chatId, false);
  if (text === BTN.SVC_USE_CREDIT) return applyProformaCredit(user, chatId);
  if (text === BTN.SVC_PAY_CASH) return showProforma(user, chatId, false);
  if (text === BTN.SVC_ISSUE || text === BTN.SVC_CONFIRM_PROFORMA) {
    return issueInvoice(user, chatId);
  }
  if (text === BTN.BACK_PRODUCT_LIST) return goBack(user, chatId);
  if (text === BTN.BACK_MAIN) return false;
  return true;
}

async function goBack(user, chatId) {
  const ctx = await currentContext(user);
  if (!ctx) return false;
  if (ctx.phase === "PAY") {
    if (ctx.source === "tenant") {
      await prisma.user.update({
        where: { id: user.id },
        data: { adminStep: "TS:MENU", pendingOrderId: null },
      });
      user.adminStep = "TS:MENU";
      user.pendingOrderId = null;
      const tenantAdmin = require("./tenantAdmin");
      await tenantAdmin.showAdminHome(user, chatId);
      return true;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: null, pendingOrderId: null },
    });
    user.orderStep = null;
    user.pendingOrderId = null;
    await reply(user, chatId, "از منوی زیر استفاده کنید.", mainMenu(user));
    return true;
  }
  if (ctx.phase === "VIEW" || isCartPhase(ctx.phase)) {
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
  await setTenantStep(user, TENANT_INV_LIST);
  await prisma.user.update({
    where: { id: user.id },
    data: { pendingOrderId: null },
  });
  user.pendingOrderId = null;
  const rows = await invoices.listInvoices(tenantId, 10);
  if (!rows.length) {
    await reply(user, chatId, "هنوز فاکتور خدماتی صادر نشده.", tenantAdminMenu());
    return;
  }
  await reply(
    user,
    chatId,
    "🧾 فاکتورهای خدمات\nروی هر مورد بزنید تا جزئیات را ببینید.\n\nفقط ده فاکتور آخر شما قابل مشاهده می‌باشد.",
    invoiceListMenu()
  );
  const buttons = rows.map((inv) => [
    {
      text: invoices.formatPeriodButton(inv).slice(0, 64),
      callback_data: `siv:${inv.id}`.slice(0, 64),
    },
  ]);
  await sendInline(user, chatId, "فاکتورها:", buttons);
}

async function showInvoiceDetail(user, chatId, invoiceId) {
  const invoice = await invoices.getInvoice(invoiceId);
  if (!invoice) {
    await reply(user, chatId, "این فاکتور پیدا نشد.", invoiceListMenu());
    await showInvoiceList(user, chatId, getBotContext().tenantId);
    return true;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: TENANT_INV_VIEW, pendingOrderId: invoice.id },
  });
  user.adminStep = TENANT_INV_VIEW;
  user.pendingOrderId = invoice.id;
  const keyboard =
    invoice.status === "WAITING_PAYMENT"
      ? tenantPayMenu()
      : invoiceListMenu();
  await reply(user, chatId, invoices.formatInvoiceText(invoice), keyboard);
  return true;
}

module.exports = {
  startInitial,
  startTenantSubscribe,
  handleCallback,
  handleText,
  handleReceiptPhoto,
  goBack,
  isMotherStep,
  isTenantStep,
  isTenantInvoiceStep,
  showInvoiceList,
  showInvoiceDetail,
};
