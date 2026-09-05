const prisma = require("../database/prisma");
const { ADMIN_BALE_IDS } = require("../config");
const { reply, notify } = require("../bot/messenger");
const bale = require("../bot/bale");
const { BTN, supportMenu, backMain, activeTicketMenu, adminTicketsMenu, adminBackMenu, inlineKb } = require("../keyboards/menus");
const { listMotherTickets, loadMotherTicket } = require("./tenantSupport");

const TICKET_INCLUDE = {
  user: true,
  messages: { orderBy: { createdAt: "asc" } },
};

function ticketCode(ticket) {
  return String(ticket.id).slice(-6);
}

function toEnDigits(value) {
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  return String(value || "")
    .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)));
}

function parseTicketCode(raw) {
  return toEnDigits(raw).trim().replace(/^#/, "").trim();
}

function accountKind(role) {
  if (role === "COLLEAGUE") return "همکار";
  if (role === "ADMIN") return "ادمین";
  return "یوزر";
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

function ticketListButton(ticket) {
  const name = ticket.user?.fullName || ticket.user?.baleId || "نامشخص";
  const kind = accountKind(ticket.user?.role);
  return {
    text: `👤 ${name} | ${kind} | ${ticketSnippet(ticket, 24)}`,
    callback_data: `tkt:view:${ticket.id}`,
  };
}

function senderLine(user) {
  const name = user.fullName || user.baleId;
  const kind = accountKind(user.role);
  return `👤 ارسال‌کننده: ${name}\n🏷 نوع حساب: ${kind}\n🆔 آیدی بله: ${user.baleId}`;
}

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
      "📝 متن تیکت را بنویسید:",
      backMain()
    );
    return true;
  }

  if (text === BTN.MY_TICKETS) {
    const tickets = await listMotherTickets({ userId: user.id, take: 10 });

    if (!tickets.length) {
      await reply(user, chatId, "تیکتی ثبت نشده است.");
      return true;
    }

    let msg = "📋 تیکت‌های شما\n\n";
    for (const t of tickets) {
      msg += `#${ticketCode(t)} | ${statusLabel(t.status)}\n`;
      msg += `متن: ${ticketSnippet(t, 80)}\n\n`;
    }

    await reply(user, chatId, msg, supportMenu());
    return true;
  }


  if (user.orderStep === "TICKET_MESSAGE") {
    const motherActive = user.activeTicketId
      ? await loadMotherTicket(user.activeTicketId)
      : null;
    if (!motherActive) {
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
        `✅ تیکت ثبت شد.\nکد پیگیری: #${ticketCode(ticket)}\nپاسخ پشتیبانی در همین گفتگو برایتان ارسال می‌شود.`,
        activeTicketMenu()
      );

      for (const adminId of ADMIN_BALE_IDS) {
        await notify(
          adminId,
          `🎫 تیکت جدید #${ticketCode(ticket)}\n${senderLine(user)}\n\nمتن تیکت:\n${text}`
        );
      }

      return true;
    }

    await prisma.ticketMessage.create({
      data: {
        ticketId: motherActive.id,
        senderType: "USER",
        message: text,
      },
    });

    await prisma.ticket.update({
      where: { id: motherActive.id },
      data: { status: "OPEN" },
    });

    await reply(user, chatId, "✅ پیام ارسال شد.", activeTicketMenu());

    for (const adminId of ADMIN_BALE_IDS) {
      await notify(
        adminId,
        `💬 پیام تیکت #${ticketCode(motherActive)}\n${senderLine(user)}\n\n${text}`
      );
    }

    return true;
  }

  return false;
};

module.exports.adminListTickets = async function adminListTickets(user, chatId) {
  await reply(user, chatId, "🎫 مدیریت تیکت‌ها", adminTicketsMenu());
};

module.exports.adminOpenTickets = async function adminOpenTickets(user, chatId) {
  const tickets = await listMotherTickets({ status: "OPEN", take: 50 });

  if (!tickets.length) {
    await reply(user, chatId, "✅ تیکت بی‌پاسخی وجود ندارد.", adminTicketsMenu());
    return;
  }

  const rows = tickets.map((t) => [ticketListButton(t)]);

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
  const tickets = await listMotherTickets({
    status: "ANSWERED",
    skip: offset,
    take: take + 1,
  });

  if (!tickets.length) {
    await reply(user, chatId, "📭 تیکت پاسخ داده شده‌ای وجود ندارد.", adminTicketsMenu());
    return;
  }

  const hasMore = tickets.length > take;
  const shown = tickets.slice(0, take);

  const rows = shown.map((t) => [ticketListButton(t)]);

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
  const ticket = await loadMotherTicket(ticketId);

  if (!ticket) {
    await reply(user, chatId, "تیکت پیدا نشد.");
    return;
  }

  const kind = accountKind(ticket.user.role);
  let text = `🎫 تیکت #${ticketCode(ticket)}\n`;
  text += `${senderLine(ticket.user)}\n`;
  text += `📊 وضعیت: ${ticket.status === "OPEN" ? "⏳ بی‌پاسخ" : "✅ پاسخ داده شده"}\n`;
  text += `━━━━━━━━━━━━━━━━━━\n\n`;

  for (const msg of ticket.messages) {
    const who = msg.senderType === "USER" ? `👤 ${kind}` : "🔧 پشتیبانی";
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

module.exports.adminSearchTicket = async function adminSearchTicket(user, chatId, raw) {
  const code = parseTicketCode(raw);
  if (!code) {
    await reply(
      user,
      chatId,
      "کد تیکت را وارد کنید. مثال: #a1b2c3",
      adminBackMenu()
    );
    return;
  }

  let matches = [];
  if (code.length >= 20) {
    const exact = await loadMotherTicket(code);
    if (exact) matches = [exact];
  }

  if (!matches.length) {
    try {
      matches = await prisma.ticket.findMany({
        where: { id: { endsWith: code }, tenantId: null },
        include: {
          user: true,
          messages: { orderBy: { createdAt: "asc" }, take: 1 },
        },
        take: 8,
      });
    } catch (err) {
      console.error("MOTHER TICKET SEARCH SKIP:", err.message);
      const raw = await prisma.ticket.findMany({
        where: { id: { endsWith: code } },
        include: {
          user: true,
          messages: { orderBy: { createdAt: "asc" }, take: 1 },
        },
        take: 8,
      });
      matches = raw.filter((t) => !t.tenantId);
    }
  }

  if (!matches.length) {
    await reply(user, chatId, "تیکتی با این کد پیدا نشد.", adminBackMenu());
    return;
  }

  if (matches.length === 1) {
    await module.exports.adminShowTicket(user, chatId, matches[0].id);
    return;
  }

  const rows = matches.map((t) => [ticketListButton(t)]);
  await reply(
    user,
    chatId,
    `چند تیکت با این کد پیدا شد (${matches.length}). یکی را انتخاب کنید:`,
    adminBackMenu()
  );
  await bale.sendKeyboard(chatId, "روی تیکت کلیک کنید:", inlineKb(rows));
};

module.exports.adminReplyTicketDirect = async function adminReplyTicketDirect(user, chatId, ticketId, message) {
  const scoped = await loadMotherTicket(ticketId);
  if (!scoped) {
    await reply(user, chatId, "تیکت پیدا نشد.", adminTicketsMenu());
    return;
  }
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
  let ticket = null;
  try {
    ticket = await prisma.ticket.findFirst({
      where: { id: { endsWith: ticketSuffix }, tenantId: null },
      include: { user: true },
    });
  } catch (err) {
    console.error("MOTHER TICKET REPLY SKIP:", err.message);
    const found = await prisma.ticket.findFirst({
      where: { id: { endsWith: ticketSuffix } },
      include: { user: true },
    });
    ticket = found && !found.tenantId ? found : null;
  }

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
