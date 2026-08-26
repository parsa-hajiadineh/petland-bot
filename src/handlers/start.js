const { reply } = require("../bot/messenger");
const { getBotContext } = require("../bot/context");
const { mainMenu } = require("../keyboards/menus");

module.exports = async function startHandler(user, msg) {
  const ctx = getBotContext();
  const wholesale =
    user.role === "COLLEAGUE" ? "\n🤝 حالت خرید همکار فعال است." : "";

  await reply(
    user,
    msg.chat.id,
    `🌿 به ${ctx.name} خوش آمدید

فروشگاه تخصصی محصولات سگ و گربه 🐶🐱
${wholesale}

از منوی زیر استفاده کنید:`,
    mainMenu(user)
  );
};
