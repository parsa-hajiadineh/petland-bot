const prisma = require("../database/prisma");
const { reply } = require("../bot/messenger");
const { formatPrice } = require("../utils/price");
const {
  BTN,
  adminBackMenu,
  adminCreditSettingsMenu,
} = require("../keyboards/menus");
const campaign = require("../services/goldenCampaign");

const STEP_LIST = "CRSET:LIST";
const STEP_HOURS = "CRSET:HOURS";
const STEP_LIMIT = "CRSET:LIMIT";
const STEP_GOLDEN_PCT = "CRSET:GOLDEN_PCT";
const STEP_STD_PCT = "CRSET:STD_PCT";

function isCreditSettingsStep(step) {
  return Boolean(step && String(step).startsWith("CRSET:"));
}

function parsePositiveInt(text) {
  const map = {
    "۰": "0",
    "۱": "1",
    "۲": "2",
    "۳": "3",
    "۴": "4",
    "۵": "5",
    "۶": "6",
    "۷": "7",
    "۸": "8",
    "۹": "9",
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
  };
  const normalized = String(text || "")
    .replace(/[۰-۹٠-٩]/g, (d) => map[d] || d)
    .replace(/[^\d]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

async function setStep(user, step) {
  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: step },
  });
  user.adminStep = step;
}

function settingsSummary(settings) {
  return [
    "⚙️ تنظیمات اعتباردهی",
    "━━━━━━━━━━━━━━━━━━",
    `⏱ زمان گلدن تایم: ${settings.goldenHours} ساعت`,
    `💰 سقف اعتبار ویژه: ${formatPrice(settings.goldenLimitToman)}`,
    `⭐ درصد اعتبار ویژه: ${settings.goldenPercent}٪`,
    `📈 درصد اعتبار عادی: ${settings.standardPercent}٪`,
    "",
    "این مقادیر از همین لحظه برای فاکتورهای جدید همه همکاران (قدیمی و جدید) اعمال می‌شود. زمان شروع دوره طلایی هر همکار عوض نمی‌شود.",
  ].join("\n");
}

async function showHome(user, chatId) {
  await setStep(user, STEP_LIST);
  let settings;
  try {
    settings = await campaign.getSettings();
  } catch (err) {
    console.error("CREDIT SETTINGS VIEW:", err);
    await reply(user, chatId, "خواندن تنظیمات ممکن نشد.", adminBackMenu());
    return;
  }
  await reply(user, chatId, settingsSummary(settings), adminCreditSettingsMenu());
}

async function askValue(user, chatId, step, prompt) {
  await setStep(user, step);
  await reply(user, chatId, prompt, adminBackMenu());
}

async function saveAndShow(user, chatId, patch, okText) {
  await campaign.updateSettings(patch);
  await reply(user, chatId, okText);
  await showHome(user, chatId);
}

async function goBack(user, chatId) {
  const step = user.adminStep || "";
  if (!isCreditSettingsStep(step)) return false;
  if (step === STEP_LIST) return false;
  await showHome(user, chatId);
  return true;
}

async function handleText(user, chatId, text) {
  if (text === BTN.ADMIN_CREDIT_SETTINGS) {
    await showHome(user, chatId);
    return true;
  }

  if (!isCreditSettingsStep(user.adminStep)) return false;

  if (text === BTN.BACK_PRODUCT_LIST || text === BTN.BACK_MAIN) return false;

  if (text === BTN.CREDIT_SET_HOURS) {
    await askValue(
      user,
      chatId,
      STEP_HOURS,
      "مدت گلدن تایم را به ساعت بفرستید.\nمثلاً ۴۸"
    );
    return true;
  }
  if (text === BTN.CREDIT_SET_LIMIT) {
    await askValue(
      user,
      chatId,
      STEP_LIMIT,
      "سقف خرید اعتبار ویژه را به تومان بفرستید.\nمثلاً ۱۰۰۰۰۰۰۰"
    );
    return true;
  }
  if (text === BTN.CREDIT_SET_GOLDEN_PCT) {
    await askValue(
      user,
      chatId,
      STEP_GOLDEN_PCT,
      "درصد اعتبار ویژه را بفرستید.\nمثلاً ۵۰۰ یعنی پنج برابر مبلغ خرید"
    );
    return true;
  }
  if (text === BTN.CREDIT_SET_STANDARD_PCT) {
    await askValue(
      user,
      chatId,
      STEP_STD_PCT,
      "درصد اعتبار عادی را بفرستید.\nمثلاً ۱۰"
    );
    return true;
  }

  if (user.adminStep === STEP_HOURS) {
    const hours = parsePositiveInt(text);
    if (!hours) {
      await reply(user, chatId, "یک عدد ساعت معتبر بفرستید.", adminBackMenu());
      return true;
    }
    await saveAndShow(user, chatId, { goldenHours: hours }, "✅ زمان گلدن تایم ذخیره شد.");
    return true;
  }
  if (user.adminStep === STEP_LIMIT) {
    const limit = parsePositiveInt(text);
    if (!limit) {
      await reply(user, chatId, "یک مبلغ معتبر به تومان بفرستید.", adminBackMenu());
      return true;
    }
    await saveAndShow(
      user,
      chatId,
      { goldenLimitToman: limit },
      "✅ سقف اعتبار ویژه ذخیره شد."
    );
    return true;
  }
  if (user.adminStep === STEP_GOLDEN_PCT) {
    const percent = parsePositiveInt(text);
    if (!percent) {
      await reply(user, chatId, "یک درصد معتبر بفرستید.", adminBackMenu());
      return true;
    }
    await saveAndShow(
      user,
      chatId,
      { goldenPercent: percent },
      "✅ درصد اعتبار ویژه ذخیره شد."
    );
    return true;
  }
  if (user.adminStep === STEP_STD_PCT) {
    const percent = parsePositiveInt(text);
    if (!percent) {
      await reply(user, chatId, "یک درصد معتبر بفرستید.", adminBackMenu());
      return true;
    }
    await saveAndShow(
      user,
      chatId,
      { standardPercent: percent },
      "✅ درصد اعتبار عادی ذخیره شد."
    );
    return true;
  }

  return false;
}

module.exports = {
  isCreditSettingsStep,
  handleText,
  goBack,
  showHome,
};
