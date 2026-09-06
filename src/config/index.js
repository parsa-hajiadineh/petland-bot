require("dotenv").config();

const parseIds = (value) =>
  (value || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

function parseBroadcastGroups(value) {
  return (value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => {
      const sep = part.lastIndexOf(":");
      if (sep > 0) {
        return {
          key: String(index),
          name: part.slice(0, sep).trim() || `گروه ${index + 1}`,
          chatId: part.slice(sep + 1).trim(),
        };
      }
      return {
        key: String(index),
        name: `گروه ${index + 1}`,
        chatId: part,
      };
    })
    .filter((group) => group.chatId);
}

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  BOT_TOKEN_ENCRYPTION_KEY: process.env.BOT_TOKEN_ENCRYPTION_KEY || "",
  PORT: process.env.PORT || 3000,
  ADMIN_BALE_IDS: parseIds(process.env.ADMIN_BALE_IDS),
  WAREHOUSE_ADMIN_BALE_IDS: parseIds(process.env.WAREHOUSE_ADMIN_BALE_IDS),
  BROADCAST_GROUP_CHATS: parseBroadcastGroups(process.env.BROADCAST_GROUP_CHATS),
  COLLEAGUE_ACCESS_CODE: process.env.COLLEAGUE_ACCESS_CODE || "",
  MANELI_ACCESS_CODE: process.env.MANELI_ACCESS_CODE || "",
  MARKETING_ACCESS_CODE: process.env.MARKETING_ACCESS_CODE || "",
  DEFAULT_PROFIT_PERCENT: Number(process.env.DEFAULT_PROFIT_PERCENT || 15),
  WHOLESALE_MIN_ORDER: Number(process.env.WHOLESALE_MIN_ORDER || 0),
  SHOP_NAME: process.env.SHOP_NAME || "پائورا",
  BANK_CARD: process.env.BANK_CARD || "",
  BANK_IBAN: process.env.BANK_IBAN || "",
  BANK_HOLDER: process.env.BANK_HOLDER || "",
  BANK_NAME: process.env.BANK_NAME || "",
  BOT_USERNAME: process.env.BOT_USERNAME || "",
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""),
};
