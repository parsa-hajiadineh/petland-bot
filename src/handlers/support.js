const prisma = require("../database/prisma");
const { ADMIN_BALE_IDS } = require("../config");
const { reply, notify } = require("../bot/messenger");
const bale = require("../bot/bale");
const { BTN, supportMenu, backMain, activeTicketMenu, adminTicketsMenu, adminBackMenu, inlineKb } = require("../keyboards/menus");

module.exports.showSupportMenu = async function showSupportMenu(user, chatId) {
  await reply(user, chatId, "🎫 پشتیبانی", supportMenu());
};

module.exports.handleSupport = async function handleSupport(
  user,
  chatId,
  text
) {
  if (text === BTN.SUPPORT) {
    await module.exports.showSupportMenu(user, chatId);
    return true;
  }

  if (text === BTN.NEW_TICKET) {
    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: "TICKET_MESSAGE" },
    });

    await reply(
      user,
      chatId,
      "📝 پیام خود را بنویسید:",
      backMain()
    );
    return true;
  }

  if (text === BTN.MY_TICKETS) {
    const tickets = await prisma.ticket.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    if (!tickets.length) {
      await reply(user, chatId, "تیکتی ثبت نشده است.");
      return true;
    }

    const statusLabel = (s) =>
      s === "ANSWERED" ? "پاسخ داده شده" : "در انتظار پاسخ";

    let msg = "📋 تیکت‌های شما\n\n";
    for (const t of tickets) {
      msg += `#${t.id.slice(-6)} | ${t.title}\n`;
      msg += `وضعیت: ${statusLabel(t.status)}\n\n`;
    }

    await reply(user, chatId, msg, supportMenu());
    return true;
  }


  if (user.orderStep === "TICKET_MESSAGE") {
    if (!user.activeTicketId) {
      const autoTitle = text.slice(0, 40);
      const ticket = await prisma.ticket.create({
        data: {
          title: autoTitle,
          userId: user.id,
          status: "OPEN",
          messages: {
            create: { senderType: "USER", message: text },
          },
        },
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { activeTicketId: ticket.id },
      });

      await reply(
        user,
        chatId,
        "✅ تیکت ثبت شد.\nبرای بستن تیکت از دکمه زیر استفاده کنید:",
        activeTicketMenu()
      );

      for (const adminId of ADMIN_BALE_IDS) {
        await notify(
          adminId,
          `🎫 تیکت جدید\nکاربر: ${user.fullName || user.baleId}\n\n${text}`
        );
      }

      return true;
    }

    await prisma.ticketMessage.create({
      data: {
        ticketId: user.activeTicketId,
        senderType: "USER",
        message: text,
      },
    });

    await prisma.ticket.update({
      where: { id: user.activeTicketId },
      data: { status: "OPEN" },
    });

    await reply(user, chatId, "✅ پیام ارسال شد.", activeTicketMenu());

    for (const adminId of ADMIN_BALE_IDS) {
      await notify(adminId, `💬 پیام تیکت\nکاربر: ${user.fullName || user.baleId}\n\n${text}`);
    }

    return true;
  }

  return false;
};

module.exports.adminListTickets = async function adminListTickets(user, chatId) {
  await reply(user, chatId, "🎫 مدیریت تیکت‌ها", adminTicketsMenu());
};

module.exports.adminOpenTickets = async function adminOpenTickets(user, chatId) {
  const tickets = await prisma.ticket.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    include: { user: true },
  });

  if (!tickets.length) {
    await reply(user, chatId, "✅ تیکت بی‌پاسخی وجود ندارد.", adminTicketsMenu());
    return;
  }

  const rows = tickets.map((t) => [{
    text: `👤 ${t.user.fullName || t.user.baleId} — ${t.title.slice(0, 35)}`,
    callback_data: `tkt:view:${t.id}`,
  }]);

  await reply(
    user,
    chatId,
    `📭 تیکت‌های بی‌پاسخ (${tickets.length})`,
    adminBackMenu()
  );
  await bale.sendKeyboard(chatId, "روی تیکت کلیک کنید:", inlineKb(rows));
};

module.exports.adminAnsweredTickets = async function adminAnsweredTickets(user, chatId, offset = 0) {
  const take = 10;
  const tickets = await prisma.ticket.findMany({
    where: { status: "ANSWERED" },
    orderBy: { createdAt: "desc" },
    skip: offset,
    take: take + 1,
    include: { user: true },
  });

  if (!tickets.length) {
    await reply(user, chatId, "📭 تیکت پاسخ داده شده‌ای وجود ندارد.", adminTicketsMenu());
    return;
  }

  const hasMore = tickets.length > take;
  const shown = tickets.slice(0, take);

  const rows = shown.map((t) => [{
    text: `👤 ${t.user.fullName || t.user.baleId} — ${t.title.slice(0, 35)}`,
    callback_data: `tkt:view:${t.id}`,
  }]);

  if (hasMore) {
    rows.push([{ text: "⬅️ ۱۰ تیکت قدیمی‌تر", callback_data: `tkt:more:${offset + take}` }]);
  }

  await reply(
    user,
    chatId,
    `📬 تیکت‌های پاسخ داده شده — صفحه ${Math.floor(offset / take) + 1}`,
    adminBackMenu()
  );
  await bale.sendKeyboard(chatId, "روی تیکت کلیک کنید:", inlineKb(rows));
};

module.exports.adminShowTicket = async function adminShowTicket(user, chatId, ticketId) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { user: true, messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!ticket) {
    await reply(user, chatId, "تیکت پیدا نشد.");
    return;
  }

  let text = `🎫 تیکت #${ticket.id.slice(-6)}\n`;
  text += `👤 کاربر: ${ticket.user.fullName || ticket.user.baleId}\n`;
  text += `📋 عنوان: ${ticket.title}\n`;
  text += `📊 وضعیت: ${ticket.status === "OPEN" ? "⏳ بی‌پاسخ" : "✅ پاسخ داده شده"}\n`;
  text += `━━━━━━━━━━━━━━━━━━\n\n`;

  for (const msg of ticket.messages) {
    const who = msg.senderType === "USER" ? "👤 کاربر" : "🔧 پشتیبانی";
    text += `${who}:\n${msg.message}\n\n`;
  }

  if (ticket.status === "OPEN") {
    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: `REPLY_TICKET:${ticket.id}` },
    });
    text += `━━━━━━━━━━━━━━━━━━\n✏️ پاسخ خود را تایپ و ارسال کنید:`;
    await reply(user, chatId, text, adminBackMenu());
  } else {
    await reply(user, chatId, text, adminTicketsMenu());
  }
};

module.exports.adminReplyTicketDirect = async function adminReplyTicketDirect(user, chatId, ticketId, message) {
  await prisma.ticketMessage.create({
    data: { ticketId, senderType: "ADMIN", message },
  });

  const ticket = await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: "ANSWERED" },
    include: { user: true },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: null },
  });

  await notify(ticket.user.baleId, `🎫 پاسخ پشتیبانی\n\n${message}`);
  await reply(user, chatId, "✅ پاسخ ارسال شد.", adminTicketsMenu());
};

module.exports.adminReplyTicket = async function adminReplyTicket(
  user,
  chatId,
  ticketSuffix,
  message
) {
  const ticket = await prisma.ticket.findFirst({
    where: { id: { endsWith: ticketSuffix } },
    include: { user: true },
  });

  if (!ticket) {
    await reply(user, chatId, "تیکت پیدا نشد.");
    return;
  }

  await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      senderType: "ADMIN",
      message,
    },
  });

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { status: "ANSWERED" },
  });

  await notify(
    ticket.user.baleId,
    `🎫 پاسخ پشتیبانی\n\n${message}`
  );

  await reply(user, chatId, "✅ پاسخ ارسال شد.");
};
