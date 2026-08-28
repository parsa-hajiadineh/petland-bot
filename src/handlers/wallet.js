const prisma = require("../database/prisma");
const { reply } = require("../bot/messenger");
const { walletMenu, backMain } = require("../keyboards/menus");

const MIN_WITHDRAWAL = 50000;
const MAX_WITHDRAWAL = 10000000;

async function getOrCreateWallet(userId) {
  return prisma.wallet.upsert({
    where: { userId },
    update: {},
    create: { userId, balance: 0 },
  });
}

module.exports.getOrCreateWallet = getOrCreateWallet;

module.exports.showWallet = async function showWallet(user, chatId) {
  const wallet = await getOrCreateWallet(user.id);

  await reply(
    user,
    chatId,
    `💰 کیف پول شما\n━━━━━━━━━━━━━━━━━━\n\n💵 موجودی: ${wallet.balance.toLocaleString("fa-IR")} تومان`,
    walletMenu()
  );
};

module.exports.startWithdrawal = async function startWithdrawal(user, chatId) {
  const wallet = await getOrCreateWallet(user.id);

  if (wallet.balance < MIN_WITHDRAWAL) {
    await reply(
      user,
      chatId,
      `⚠️ موجودی کافی نیست.\n\nموجودی فعلی: ${wallet.balance.toLocaleString("fa-IR")} تومان\nحداقل برداشت: ${MIN_WITHDRAWAL.toLocaleString("fa-IR")} تومان`,
      walletMenu()
    );
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { orderStep: "WITHDRAW_AMOUNT" },
  });

  await reply(
    user,
    chatId,
    `💳 درخواست برداشت\n\nلطفاً مبلغ مورد نظر را وارد کنید:\n\n⚠️ رقم را با اعداد انگلیسی، بدون استفاده از حروف و حتماً به تومان تایپ کنید\nحداقل: ${MIN_WITHDRAWAL.toLocaleString("fa-IR")} تومان\nحداکثر: ${MAX_WITHDRAWAL.toLocaleString("fa-IR")} تومان\nموجودی شما: ${wallet.balance.toLocaleString("fa-IR")} تومان`,
    backMain()
  );
};

module.exports.handleWithdrawalStep = async function handleWithdrawalStep(user, chatId, text) {
  if (user.orderStep === "WITHDRAW_AMOUNT") {
    const amount = parseInt(text.replace(/[^0-9]/g, ""), 10);

    if (!amount || amount < MIN_WITHDRAWAL || amount > MAX_WITHDRAWAL) {
      await reply(
        user,
        chatId,
        `❌ مبلغ نامعتبر.\nلطفاً عددی بین ${MIN_WITHDRAWAL.toLocaleString("fa-IR")} تا ${MAX_WITHDRAWAL.toLocaleString("fa-IR")} تومان وارد کنید:`,
        backMain()
      );
      return true;
    }

    const wallet = await getOrCreateWallet(user.id);

    if (amount > wallet.balance) {
      await reply(
        user,
        chatId,
        `❌ مبلغ درخواستی بیشتر از موجودی کیف پول شماست.\n\nموجودی فعلی: ${wallet.balance.toLocaleString("fa-IR")} تومان\nمبلغ وارد شده: ${amount.toLocaleString("fa-IR")} تومان\n\nلطفاً مبلغی کمتر یا مساوی موجودی وارد کنید:`,
        backMain()
      );
      return true;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: "WITHDRAW_CARD", tempDescription: String(amount) },
    });

    await reply(user, chatId, "💳 شماره کارت مقصد را وارد کنید (۱۶ رقم بدون خط تیره):", backMain());
    return true;
  }

  if (user.orderStep === "WITHDRAW_CARD") {
    const card = text.replace(/[-\s]/g, "");

    if (!/^\d{16}$/.test(card)) {
      await reply(user, chatId, "❌ شماره کارت نامعتبر است. لطفاً ۱۶ رقم وارد کنید:", backMain());
      return true;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: "WITHDRAW_HOLDER", tempProvince: card },
    });

    await reply(user, chatId, "👤 نام و نام خانوادگی صاحب کارت را وارد کنید:", backMain());
    return true;
  }

  if (user.orderStep === "WITHDRAW_HOLDER") {
    const amount = parseInt(user.tempDescription, 10);
    const card = user.tempProvince;
    const holder = text.trim();

    if (!amount || !card || !holder) {
      await prisma.user.update({
        where: { id: user.id },
        data: { orderStep: null, tempDescription: null, tempProvince: null },
      });
      await reply(user, chatId, "❌ خطا در ثبت درخواست. لطفاً دوباره تلاش کنید.", walletMenu());
      return true;
    }

    const wallet = await getOrCreateWallet(user.id);

    if (wallet.balance < amount) {
      await prisma.user.update({
        where: { id: user.id },
        data: { orderStep: null, tempDescription: null, tempProvince: null },
      });
      await reply(user, chatId, "❌ موجودی کافی نیست. عملیات لغو شد.", walletMenu());
      return true;
    }

    const before = Number(wallet.balance || 0);
    try {
      await prisma.$transaction(async (tx) => {
        const moved = await tx.wallet.updateMany({
          where: { userId: user.id, balance: { gte: amount } },
          data: { balance: { decrement: amount } },
        });
        if (moved.count !== 1) {
          throw new Error("WALLET_INSUFFICIENT");
        }
        await tx.withdrawal.create({
          data: {
            amount,
            cardNumber: card,
            cardHolder: holder,
            walletId: wallet.id,
          },
        });
      });
    } catch (err) {
      await prisma.user.update({
        where: { id: user.id },
        data: { orderStep: null, tempDescription: null, tempProvince: null },
      });
      if (err.message === "WALLET_INSUFFICIENT") {
        await reply(user, chatId, "❌ موجودی کافی نیست. عملیات لغو شد.", walletMenu());
        return true;
      }
      console.error("WALLET WITHDRAW:", err);
      await reply(user, chatId, "❌ ثبت درخواست ممکن نشد. دوباره تلاش کنید.", walletMenu());
      return true;
    }
    await require("../services/financialAudit").logFinancial({
      actorUserId: user.id,
      action: "COMMISSION_WITHDRAW_REQUEST",
      entityType: "Wallet",
      entityId: wallet.id,
      amount: -amount,
      balanceBefore: before,
      balanceAfter: before - amount,
      reason: "withdrawal_request",
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { orderStep: null, tempDescription: null, tempProvince: null },
    });

    await reply(
      user,
      chatId,
      `✅ درخواست برداشت با موفقیت ثبت شد.\n\n💰 مبلغ: ${amount.toLocaleString("fa-IR")} تومان\n💳 شماره کارت: ${card}\n👤 نام: ${holder}\n\nپس از بررسی و تایید توسط ادمین، مبلغ به کارت شما واریز خواهد شد و کد رهگیری تراکنش برایتان ارسال می‌شود.`,
      walletMenu()
    );
    return true;
  }

  return false;
};

module.exports.showWithdrawalHistory = async function showWithdrawalHistory(user, chatId) {
  const wallet = await getOrCreateWallet(user.id);

  const withdrawals = await prisma.withdrawal.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  if (!withdrawals.length) {
    await reply(user, chatId, "📋 تاریخچه برداشت\n\nهنوز درخواست برداشتی ثبت نشده است.", walletMenu());
    return;
  }

  const lines = ["📋 تاریخچه برداشت", "━━━━━━━━━━━━━━━━━━", ""];

  for (const w of withdrawals) {
    const date = new Date(w.createdAt).toLocaleDateString("fa-IR");
    const status = w.status === "PAID" ? "✅ پرداخت شده" : "⏳ در انتظار";
    lines.push(`• ${w.amount.toLocaleString("fa-IR")} تومان | ${status}`);
    lines.push(`  💳 ${w.cardNumber}`);
    lines.push(`  📅 ${date}`);
    if (w.trackingCode) lines.push(`  🔖 کد رهگیری: ${w.trackingCode}`);
    lines.push("");
  }

  await reply(user, chatId, lines.join("\n"), walletMenu());
};
