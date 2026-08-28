const { reply } = require("../bot/messenger");
const { mainMenu } = require("../keyboards/menus");

module.exports = async function startHandler(user, msg) {
  await reply(
    user,
    msg.chat.id,
    `Pow Ora

برای انتخاب های بهتر.
خوش آمدید.`,
    mainMenu(user)
  );
};
