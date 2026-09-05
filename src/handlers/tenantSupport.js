const prisma = require("../database/prisma");
const { reply, notify } = require("../bot/messenger");
const { getBotContext } = require("../bot/context");
const {
  BTN,
  supportMenu,
  backMain,
  activeTicketMenu,
  tenantTicketsMenu,
  adminBackMenu,
  inlineKb,
} = require("../keyboards/menus");

const STEP_MSG = "TST:MSG";
const STEP_HUB = "TS:TICKETS";
const STEP_OPEN = "TS:TICKET_OPEN";
const STEP_ANS = "TS:TICKET_ANSWERED";
const REPLY_PREFIX = "TS:REPLY_TICKET:";

const TICKET_INCLUDE = {
  user: true,
  messages: { orderBy: { createdAt: "asc" } },
};

let ensurePromise = null;

function ticketCode(ticket) {
  return String(ticket.id).slice(-6);
}

function ticketSnippet(ticket, max = 35) {
  const raw = String(ticket.messages?.[0]?.message || ticket.title || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "بدون متن";
  return raw.length > max ? `${raw.slice(0, max)}…` : raw;
}

function statusLabel(status) {
  return status === "ANSWERED" ? "پاسخ داده شده" : "در انتظار پاسخ";
}

function isCustomerTicketStep(step) {
  return step === STEP_MSG;
}

function isOwnerTicketStep(step) {
  const value = String(step || "");
  return (
    value === STEP_HUB ||
    value === STEP_OPEN ||
    value === STEP_ANS ||
    value.startsWith(REPLY_PREFIX)
  );
}

async function ensureTicketTenantColumn() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      try {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "tenantId" TEXT`
        );
      } catch (err) {
        console.error("TICKET TENANT COL SKIP:", err.message);
      }
      try {
        await prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS "Ticket_tenantId_idx" ON "Ticket"("tenantId")`
        );
      } catch (err) {
        console.error("TICKET TENANT IDX SKIP:", err.message);
      }
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

async function loadTicket(id, tenantId) {
  if (!id || !tenantId) return null;
  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id, tenantId },
      include: TICKET_INCLUDE,
    });
    if (ticket) return ticket;
  } catch (err) {
    console.error("TICKET LOAD PRISMA SKIP:", err.message);
  }
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM "Ticket" WHERE "id" = $1 AND "tenantId" = $2 LIMIT 1`,
      id,
      tenantId
    );
    const row = rows?.[0];
    if (!row) return null;
    const user = await prisma.user.findUnique({ where: { id: row.userId } });
    const messages = await prisma.ticketMessage.findMany({
      where: { ticketId: row.id },
      orderBy: { createdAt: "asc" },
    });
    return { ...row, user, messages };
  } catch (err) {
    console.error("TICKET LOAD SQL SKIP:", err.message);
    return null;
  }
}

async function listTickets({ tenantId, userId, status, skip = 0, take = 20 }) {
  if (!tenantId) return [];
  try {
    const where = { tenantId };
    if (userId) where.userId = userId;
    if (status) where.status = status;
    return await prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        user: true,
        messages: { orderBy: { createdAt: "asc" }, take: 1 },
      },
    });
  } catch (err) {
    console.error("TICKET LIST PRISMA SKIP:", err.message);
  }
  const clauses = [`"tenantId" = $1`];
  const params = [tenantId];
  let i = 2;
  if (userId) {
    clauses.push(`"userId" = $${i++}`);
    params.push(userId);
  }
  if (status) {
    clauses.push(`"status" = $${i++}`);
    params.push(status);
  }
  params.push(take, skip);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "Ticket" WHERE ${clauses.join(" AND ")}
     ORDER BY "createdAt" DESC LIMIT $${i++} OFFSET $${i}`,
    ...params
  );
  const list = rows || [];
  const out = [];
  for (const row of list) {
    const user = await prisma.user.findUnique({ where: { id: row.userId } }).catch(() => null);
    const messages = await prisma.ticketMessage.findMany({
      where: { ticketId: row.id },
      orderBy: { createdAt: "asc" },
      take: 1,
    });
    out.push({ ...row, user, messages });
  }
  return out;
}

async function createShopTicket(userId, tenantId, text) {
  const title = String(text).slice(0, 40);
  try {
    return await prisma.ticket.create({
      data: {
        title,
        userId,
        tenantId,
        status: "OPEN",
        messages: { create: { senderType: "USER", message: text } },
      },
    });
  } catch (err) {
    console.error("TICKET CREATE PRISMA SKIP:", err.message);
  }
  const ticket = await prisma.ticket.create({
    data: {
      title,
      userId,
      status: "OPEN",
      messages: { create: { senderType: "USER", message: text } },
    },
  });
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "Ticket" SET "tenantId" = $1 WHERE "id" = $2`,
      tenantId,
      ticket.id
    );
  } catch (err) {
    console.error("TICKET TENANT SET SKIP:", err.message);
  }
  return ticket;
}

async function notifyShopOwner(tenantId, text) {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { ownerUserId: true },
    });
    if (!tenant?.ownerUserId) return;
    const owner = await prisma.user.findUnique({
      where: { id: tenant.ownerUserId },
      select: { baleId: true },
    });
    if (owner?.baleId) await notify(owner.baleId, text);
  } catch (err) {
    console.error("SHOP TICKET OWNER NOTIFY:", err.message);
  }
}

async function showCustomerMenu(user, chatId) {
  await reply(user, chatId, "🎫 پشتیبانی فروشگاه", supportMenu());
}

async function handleCustomer(user, chatId, text) {
  const tenantId = getBotContext().tenantId;
  if (!tenantId) return false;

  const ticketBtns = new Set([BTN.SUPPORT, BTN.NEW_TICKET, BTN.MY_TICKETS]);
  if (Object.values(BTN).includes(text) && !ticketBtns.has(text)) {
    if (user.orderStep === STEP_MSG) {
      await prisma.user.update({
        where: { id: user.id },
        data: { orderStep: null },
      });
      user.orderStep = null;
    }
    return false;
  }

  if (text === BTN.SUPPORT) {
    await showCustomerMenu(user, chatId);
    return true;
  }

  if (text === BTN.NEW_TICKET) {
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: STEP_MSG, activeTicketId: null },
    });
    user.orderStep = STEP_MSG;
    user.activeTicketId = null;
    await reply(user, chatId, "📝 متن تیکت را بنویسید:", backMain());
    return true;
  }

  if (text === BTN.MY_TICKETS) {
    const tickets = await listTickets({
      tenantId,
      userId: user.id,
      take: 10,
    });
    if (!tickets.length) {
      await reply(user, chatId, "تیکتی در این فروشگاه ثبت نشده است.", supportMenu());
      return true;
    }
    let msg = "📋 تیکت‌های شما در این فروشگاه\n\n";
    for (const t of tickets) {
      msg += `#${ticketCode(t)} | ${statusLabel(t.status)}\n`;
      msg += `متن: ${ticketSnippet(t, 80)}\n\n`;
    }
    await reply(user, chatId, msg, supportMenu());
    return true;
  }

  if (user.orderStep !== STEP_MSG) return false;
  if (!String(text || "").trim()) {
    await reply(user, chatId, "متن تیکت را بنویسید:", backMain());
    return true;
  }

  const active = user.activeTicketId
    ? await loadTicket(user.activeTicketId, tenantId)
    : null;

  if (!active) {
    const ticket = await createShopTicket(user.id, tenantId, text);
    await prisma.user.update({
      where: { id: user.id },
      data: { activeTicketId: ticket.id },
    });
    user.activeTicketId = ticket.id;
    await reply(
      user,
      chatId,
      `✅ تیکت ثبت شد.\nکد پیگیری: #${ticketCode(ticket)}\nپاسخ فروشگاه در همین گفتگو برایتان ارسال می‌شود.`,
      activeTicketMenu()
    );
    await notifyShopOwner(
      tenantId,
      `🎫 تیکت جدید #${ticketCode(ticket)}\n👤 ${user.fullName || user.baleId}\n\n${text}`
    );
    return true;
  }

  await prisma.ticketMessage.create({
    data: { ticketId: active.id, senderType: "USER", message: text },
  });
  await prisma.ticket.update({
    where: { id: active.id },
    data: { status: "OPEN" },
  });
  await reply(user, chatId, "✅ پیام ارسال شد.", activeTicketMenu());
  await notifyShopOwner(
    tenantId,
    `💬 پیام تیکت #${ticketCode(active)}\n👤 ${user.fullName || user.baleId}\n\n${text}`
  );
  return true;
}

async function setOwnerStep(user, step) {
  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: step },
  });
  user.adminStep = step;
}

async function showOwnerHub(user, chatId) {
  await ensureTicketTenantColumn();
  await setOwnerStep(user, STEP_HUB);
  await reply(user, chatId, "🎫 مدیریت تیکت‌های فروشگاه", tenantTicketsMenu());
}

function ownerListButton(ticket) {
  const name = ticket.user?.fullName || ticket.user?.baleId || "نامشخص";
  return {
    text: `👤 ${name} | ${ticketSnippet(ticket, 24)}`.slice(0, 64),
    callback_data: `ttk:view:${ticket.id}`.slice(0, 64),
  };
}

async function showOwnerList(user, chatId, status, offset = 0) {
  const tenantId = getBotContext().tenantId;
  if (!tenantId) return;
  const take = 10;
  await setOwnerStep(user, status === "ANSWERED" ? STEP_ANS : STEP_OPEN);
  const tickets = await listTickets({
    tenantId,
    status,
    skip: offset,
    take: take + 1,
  });
  const title =
    status === "ANSWERED" ? "📬 تیکت‌های پاسخ داده شده" : "📭 تیکت‌های بی‌پاسخ";
  if (!tickets.length) {
    await reply(
      user,
      chatId,
      status === "ANSWERED"
        ? "تیکت پاسخ داده‌شده‌ای وجود ندارد."
        : "✅ تیکت بی‌پاسخی وجود ندارد.",
      tenantTicketsMenu()
    );
    return;
  }
  const hasMore = tickets.length > take;
  const shown = tickets.slice(0, take);
  const rows = shown.map((t) => [ownerListButton(t)]);
  if (hasMore) {
    rows.push([
      {
        text: "ده تیکت بعدی",
        callback_data: `ttk:more:${status === "ANSWERED" ? "a" : "o"}:${offset + take}`,
      },
    ]);
  }
  await reply(
    user,
    chatId,
    `${title}${offset ? ` — صفحه ${Math.floor(offset / take) + 1}` : ""}`,
    adminBackMenu()
  );
  const bale = require("../bot/bale");
  await bale.sendKeyboard(chatId, "روی تیکت کلیک کنید:", inlineKb(rows));
}

async function showOwnerTicket(user, chatId, ticketId) {
  const tenantId = getBotContext().tenantId;
  const ticket = await loadTicket(ticketId, tenantId);
  if (!ticket) {
    await reply(user, chatId, "تیکت پیدا نشد.", tenantTicketsMenu());
    return;
  }
  let text = `🎫 تیکت #${ticketCode(ticket)}\n`;
  text += `👤 ${ticket.user?.fullName || ticket.user?.baleId || "نامشخص"}\n`;
  text += `📊 وضعیت: ${ticket.status === "OPEN" ? "⏳ بی‌پاسخ" : "✅ پاسخ داده شده"}\n`;
  text += `━━━━━━━━━━━━━━━━━━\n\n`;
  for (const msg of ticket.messages || []) {
    const who = msg.senderType === "USER" ? "👤 مشتری" : "🏪 فروشگاه";
    text += `${who}:\n${msg.message}\n\n`;
  }
  if (ticket.status === "OPEN") {
    await setOwnerStep(user, `${REPLY_PREFIX}${ticket.id}`);
    text += `━━━━━━━━━━━━━━━━━━\n✏️ پاسخ خود را تایپ و ارسال کنید:`;
    await reply(user, chatId, text, adminBackMenu());
    return;
  }
  await setOwnerStep(user, STEP_HUB);
  await reply(user, chatId, text, tenantTicketsMenu());
}

async function ownerReply(user, chatId, ticketId, message) {
  const tenantId = getBotContext().tenantId;
  const ticket = await loadTicket(ticketId, tenantId);
  if (!ticket) {
    await reply(user, chatId, "تیکت پیدا نشد.", tenantTicketsMenu());
    return;
  }
  await prisma.ticketMessage.create({
    data: { ticketId: ticket.id, senderType: "ADMIN", message },
  });
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { status: "ANSWERED" },
  });
  await setOwnerStep(user, STEP_HUB);
  if (ticket.user?.baleId) {
    await notify(ticket.user.baleId, `🎫 پاسخ فروشگاه\n\n${message}`);
  }
  await reply(user, chatId, "✅ پاسخ ارسال شد.", tenantTicketsMenu());
}

async function handleOwnerText(user, chatId, text) {
  if (text === BTN.SHOP_TICKETS) {
    await showOwnerHub(user, chatId);
    return true;
  }
  if (!isOwnerTicketStep(user.adminStep)) return false;

  if (text === BTN.TICKET_OPEN) {
    await showOwnerList(user, chatId, "OPEN", 0);
    return true;
  }
  if (text === BTN.TICKET_ANSWERED) {
    await showOwnerList(user, chatId, "ANSWERED", 0);
    return true;
  }
  if (String(user.adminStep).startsWith(REPLY_PREFIX)) {
    const ticketId = user.adminStep.slice(REPLY_PREFIX.length);
    const message = String(text || "").trim();
    if (!message) {
      await reply(user, chatId, "پاسخ را بنویسید:", adminBackMenu());
      return true;
    }
    await ownerReply(user, chatId, ticketId, message);
    return true;
  }
  return false;
}

async function handleOwnerCallback(user, chatId, data) {
  if (data.startsWith("ttk:view:")) {
    await showOwnerTicket(user, chatId, data.slice(9));
    return true;
  }
  if (data.startsWith("ttk:more:")) {
    const parts = data.slice(9).split(":");
    const status = parts[0] === "a" ? "ANSWERED" : "OPEN";
    const offset = Number(parts[1]) || 0;
    await showOwnerList(user, chatId, status, offset);
    return true;
  }
  return false;
}

async function goOwnerBack(user, chatId) {
  if (!isOwnerTicketStep(user.adminStep)) return false;
  const step = user.adminStep;
  if (step === STEP_OPEN || step === STEP_ANS || String(step).startsWith(REPLY_PREFIX)) {
    await showOwnerHub(user, chatId);
    return true;
  }
  const tenantAdmin = require("./tenantAdmin");
  await tenantAdmin.showAdminHome(user, chatId);
  return true;
}

async function loadMotherTicket(id) {
  if (!id) return null;
  try {
    return await prisma.ticket.findFirst({
      where: { id, tenantId: null },
      include: TICKET_INCLUDE,
    });
  } catch (err) {
    console.error("MOTHER TICKET LOAD SKIP:", err.message);
  }
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: TICKET_INCLUDE,
  });
  if (ticket?.tenantId) return null;
  return ticket || null;
}

async function listMotherTickets({ userId, status, skip = 0, take = 20 } = {}) {
  await ensureTicketTenantColumn();
  try {
    const where = { tenantId: null };
    if (userId) where.userId = userId;
    if (status) where.status = status;
    return await prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        user: true,
        messages: { orderBy: { createdAt: "asc" }, take: 1 },
      },
    });
  } catch (err) {
    console.error("MOTHER TICKET LIST SKIP:", err.message);
  }
  const clauses = [`("tenantId" IS NULL)`];
  const params = [];
  let i = 1;
  if (userId) {
    clauses.push(`"userId" = $${i++}`);
    params.push(userId);
  }
  if (status) {
    clauses.push(`"status" = $${i++}`);
    params.push(status);
  }
  params.push(take, skip);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "Ticket" WHERE ${clauses.join(" AND ")}
     ORDER BY "createdAt" DESC LIMIT $${i++} OFFSET $${i}`,
    ...params
  );
  const list = rows || [];
  const out = [];
  for (const row of list) {
    const user = await prisma.user.findUnique({ where: { id: row.userId } }).catch(() => null);
    const messages = await prisma.ticketMessage.findMany({
      where: { ticketId: row.id },
      orderBy: { createdAt: "asc" },
      take: 1,
    });
    out.push({ ...row, user, messages });
  }
  return out;
}

module.exports = {
  ensureTicketTenantColumn,
  isCustomerTicketStep,
  isOwnerTicketStep,
  handleCustomer,
  handleOwnerText,
  handleOwnerCallback,
  goOwnerBack,
  showOwnerHub,
  loadTicket,
  loadMotherTicket,
  listMotherTickets,
};
