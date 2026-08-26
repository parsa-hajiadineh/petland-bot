const { SHOP_NAME } = require("../config");
const { reply } = require("../bot/messenger");
const { mainMenu } = require("../keyboards/menus");

module.exports = async function startHandler(user, msg) {
  const wholesale =
    user.role === "COLLEAGUE" ? "\n🤝 حالت خرید همکار فعال است." : "";

  await reply(
    user,
    msg.chat.id,
    `🌿 به ${SHOP_NAME} خوش آمدید

فروشگاه تخصصی محصولات سگ و گربه 🐶🐱
${wholesale}

از منوی زیر استفاده کنید:`,
    mainMenu(user)
  );
};
