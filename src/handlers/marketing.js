const prisma = require("../database/prisma");
const { BOT_USERNAME, SHOP_NAME } = require("../config");
const { reply } = require("../bot/messenger");
const bale = require("../bot/bale");
const { backMain, inlineKb } = require("../keyboards/menus");

function buildReferralLink(baleId) {
  if (!BOT_USERNAME) return null;
  return `https://ble.ir/${BOT_USERNAME}?start=ref_${baleId}`;
}

module.exports.buildReferralLink = buildReferralLink;

module.exports.showMarketing = async function showMarketing(user, chatId) {
  const referralLink = buildReferralLink(user.baleId);

  const referralCount = await prisma.user.count({
    where: {
      referrerId: user.id,
      role: { notIn: ["COLLEAGUE", "MANELI"] },
    },
  });

  const lines = [
    `📣 بازاریابی ${SHOP_NAME}`,
    `━━━━━━━━━━━━━━━━━━`,
    ``,
    `با معرفی دوستان خود به ${SHOP_NAME} درآمد کسب کنید!`,
    ``,
    `📋 شرایط و توضیحات:`,
    `• لینک اختصاصی خود را با دوستانتان به اشتراک بگذارید`,
    `• هر شخصی که از طریق لینک شما وارد ربات شود،`,
    `  برای همیشه به عنوان معرفی‌شده شما ثبت می‌شود`,
    `• به ازای هر خرید خرد تایید‌شده معرفی‌شده‌های شما،`,
    `  ۵٪ مبلغ فاکتور به کیف پول شما واریز می‌شود`,
    `• اگر معرفی‌شده همکار شود، دیگر از او پورسانت نمی‌گیرید`,
    `• موجودی کیف پول را از بخش 💰 کیف پول مشاهده کنید`,
    ``,
    `👥 تعداد معرفی‌های شما: ${referralCount} نفر`,
  ];

  if (referralLink) {
    lines.push(
      ``,
      `🔗 لینک معرفی اختصاصی شما:`,
      ``,
      referralLink
    );
  } else {
    lines.push(``, `⚠️ لینک معرفی در حال حاضر در دسترس نیست.`);
  }

  await reply(user, chatId, lines.join("\n"), backMain());

  if (!referralLink) return;

  const result = await bale.sendKeyboard(
    chatId,
    "برای کپی کردن لینک معرفی، دکمه زیر را بزنید:",
    inlineKb([
      [{ text: "📋 کپی لینک معرفی", copy_text: { text: referralLink } }],
    ])
  );
  const msgId = result?.result?.message_id;
  if (msgId && user?.id) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastMessageId: msgId },
    });
    user.lastMessageId = msgId;
  }
};
