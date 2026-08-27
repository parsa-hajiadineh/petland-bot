const prisma = require("../database/prisma");
const { reply } = require("../bot/messenger");
const bale = require("../bot/bale");
const {
  BTN,
  kb,
  inlineKb,
  adminBackMenu,
  adminServicesMenu,
  adminServiceDetailMenu,
} = require("../keyboards/menus");
const { formatPrice } = require("../utils/price");
const services = require("../services/servicePackages");

const STEP_PREFIX = "SVC:";

function isServiceAdminStep(step) {
  return Boolean(step && String(step).startsWith(STEP_PREFIX));
}

function parseAmount(text) {
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

async function setStep(user, step, extras = {}) {
  await prisma.user.update({
    where: { id: user.id },
    data: { adminStep: step, ...extras },
  });
  user.adminStep = step;
}

function packageSummary(pack) {
  const state = pack.isArchived
    ? "آرشیو"
    : pack.isActive
      ? "فعال"
      : "غیرفعال";
  const desc = (pack.description || "").trim() || "—";
  return [
    `💼 ${pack.title}`,
    "━━━━━━━━━━━━━━━━━━",
    `💰 قیمت: ${formatPrice(pack.priceToman)}`,
    `📊 وضعیت: ${state}`,
    `📝 ${desc}`,
  ].join("\n");
}

async function showList(user, chatId) {
  await setStep(user, "SVC:LIST", { pendingOrderId: null });
  user.pendingOrderId = null;
  let packs = [];
  try {
    packs = await services.listPackages({ includeArchived: true });
  } catch (err) {
    console.error("ADMIN SERVICES LIST:", err);
    await reply(user, chatId, "خواندن پکیج‌ها ممکن نشد.", adminBackMenu());
    return;
  }

  if (!packs.length) {
    await reply(
      user,
      chatId,
      "💼 پکیج خدمات\n\nهنوز پکیجی ثبت نشده. یکی بسازید.",
      adminServicesMenu()
    );
    return;
  }

  const rows = packs.map((pack) => {
    const mark = pack.isArchived ? "🗄 " : pack.isActive ? "" : "⏸ ";
    return [
      {
        text: `${mark}${pack.title} | ${formatPrice(pack.priceToman)}`,
        callback_data: `asvc:${pack.id}`.slice(0, 64),
      },
    ];
  });

  await reply(
    user,
    chatId,
    "💼 پکیج خدمات\nقیمت‌ها از دیتابیس خوانده می‌شوند. روی هر مورد برای ویرایش بزنید.",
    adminServicesMenu()
  );
  const result = await bale.sendKeyboard(chatId, "پکیج‌ها:", inlineKb(rows));
  const msgId = result?.result?.message_id;
  if (msgId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastMessageId: msgId },
    });
  }
}

async function showDetail(user, chatId, packId) {
  const pack = await services.getPackage(packId);
  if (!pack) {
    await reply(user, chatId, "این پکیج پیدا نشد.", adminServicesMenu());
    await showList(user, chatId);
    return;
  }
  await setStep(user, "SVC:VIEW", { pendingOrderId: pack.id });
  user.pendingOrderId = pack.id;
  await reply(
    user,
    chatId,
    packageSummary(pack),
    adminServiceDetailMenu()
  );
}

async function startCreate(user, chatId) {
  await setStep(user, "SVC:NEW_TITLE", {
    pendingOrderId: null,
    tempDescription: null,
    tempCity: null,
  });
  user.pendingOrderId = null;
  await reply(user, chatId, "نام پکیج جدید را بفرستید:", adminBackMenu());
}

async function handleCallback(user, chatId, data) {
  if (!data.startsWith("asvc:")) return false;
  const id = data.slice(5);
  await showDetail(user, chatId, id);
  return true;
}

async function goBack(user, chatId) {
  const step = user.adminStep || "";
  if (!isServiceAdminStep(step)) return false;

  if (step === "SVC:LIST") return false;

  if (step === "SVC:VIEW") {
    await showList(user, chatId);
    return true;
  }

  if (step.startsWith("SVC:NEW")) {
    await showList(user, chatId);
    return true;
  }

  if (step.startsWith("SVC:EDIT") && user.pendingOrderId) {
    await showDetail(user, chatId, user.pendingOrderId);
    return true;
  }

  await showList(user, chatId);
  return true;
}

async function handleText(user, chatId, text) {
  if (text === BTN.ADMIN_SERVICES) {
    await showList(user, chatId);
    return true;
  }
  if (text === BTN.BACK_PRODUCT_LIST || text === BTN.BACK_MAIN) return false;
  if (text === BTN.SVC_NEW && isServiceAdminStep(user.adminStep)) {
    await startCreate(user, chatId);
    return true;
  }

  if (user.adminStep === "SVC:VIEW" && user.pendingOrderId) {
    const pack = await services.getPackage(user.pendingOrderId);
    if (!pack) {
      await showList(user, chatId);
      return true;
    }
    if (text === BTN.SVC_EDIT_TITLE) {
      await setStep(user, "SVC:EDIT_TITLE");
      await reply(user, chatId, "نام جدید را بفرستید:", adminBackMenu());
      return true;
    }
    if (text === BTN.SVC_EDIT_PRICE) {
      await setStep(user, "SVC:EDIT_PRICE");
      await reply(user, chatId, "قیمت جدید را به تومان بفرستید:", adminBackMenu());
      return true;
    }
    if (text === BTN.SVC_EDIT_DESC) {
      await setStep(user, "SVC:EDIT_DESC");
      await reply(
        user,
        chatId,
        "توضیحات جدید را بفرستید (یا دکمه رد کردن):",
        kb([[{ text: BTN.SKIP }], [{ text: BTN.BACK_PRODUCT_LIST }]])
      );
      return true;
    }
    if (text === BTN.SVC_TOGGLE) {
      if (pack.isArchived) {
        await reply(user, chatId, "اول پکیج را از آرشیو خارج کنید.", adminServiceDetailMenu());
        return true;
      }
      const updated = await services.updatePackage(pack.id, { isActive: !pack.isActive });
      await showDetail(user, chatId, updated.id);
      return true;
    }
    if (text === BTN.SVC_ARCHIVE) {
      if (pack.isArchived) {
        await services.restorePackage(pack.id);
      } else {
        await services.archivePackage(pack.id);
      }
      await showDetail(user, chatId, pack.id);
      return true;
    }
    if (text === BTN.SVC_DELETE) {
      const result = await services.deletePackage(pack.id);
      if (result.archived) {
        await reply(
          user,
          chatId,
          "این پکیج انتخاب همکار دارد؛ به‌جای حذف آرشیو شد.",
          adminServicesMenu()
        );
        await showDetail(user, chatId, pack.id);
      } else {
        await reply(user, chatId, "پکیج حذف شد.", adminServicesMenu());
        await showList(user, chatId);
      }
      return true;
    }
  }

  const isMenuBtn = Object.values(BTN).includes(text) && text !== BTN.SKIP;
  if (
    isMenuBtn &&
    [
      "SVC:NEW_TITLE",
      "SVC:NEW_DESC",
      "SVC:NEW_PRICE",
      "SVC:EDIT_TITLE",
      "SVC:EDIT_PRICE",
      "SVC:EDIT_DESC",
    ].includes(user.adminStep)
  ) {
    return false;
  }

  if (user.adminStep === "SVC:NEW_TITLE") {
    const title = text.trim();
    if (!title) {
      await reply(user, chatId, "نام پکیج را بفرستید.", adminBackMenu());
      return true;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: "SVC:NEW_DESC", tempDescription: title },
    });
    user.adminStep = "SVC:NEW_DESC";
    user.tempDescription = title;
    await reply(
      user,
      chatId,
      "توضیحات پکیج را بفرستید (یا رد کردن):",
      kb([[{ text: BTN.SKIP }], [{ text: BTN.BACK_PRODUCT_LIST }]])
    );
    return true;
  }

  if (user.adminStep === "SVC:NEW_DESC") {
    const description = text === BTN.SKIP ? "" : text.trim();
    await prisma.user.update({
      where: { id: user.id },
      data: { adminStep: "SVC:NEW_PRICE", tempCity: description },
    });
    user.adminStep = "SVC:NEW_PRICE";
    user.tempCity = description;
    await reply(user, chatId, "قیمت را به تومان بفرستید:", adminBackMenu());
    return true;
  }

  if (user.adminStep === "SVC:NEW_PRICE") {
    const price = parseAmount(text);
    if (!price) {
      await reply(user, chatId, "یک عدد معتبر به تومان وارد کنید.", adminBackMenu());
      return true;
    }
    const title = (user.tempDescription || "").trim();
    if (!title) {
      await startCreate(user, chatId);
      return true;
    }
    const pack = await services.createPackage({
      title,
      description: user.tempCity || "",
      priceToman: price,
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { tempDescription: null, tempCity: null },
    });
    user.tempDescription = null;
    user.tempCity = null;
    await reply(user, chatId, "✅ پکیج ساخته شد.");
    await showDetail(user, chatId, pack.id);
    return true;
  }

  if (user.adminStep === "SVC:EDIT_TITLE" && user.pendingOrderId) {
    const title = text.trim();
    if (!title) {
      await reply(user, chatId, "نام را بفرستید.", adminBackMenu());
      return true;
    }
    await services.updatePackage(user.pendingOrderId, { title });
    await showDetail(user, chatId, user.pendingOrderId);
    return true;
  }

  if (user.adminStep === "SVC:EDIT_PRICE" && user.pendingOrderId) {
    const price = parseAmount(text);
    if (!price) {
      await reply(user, chatId, "یک عدد معتبر به تومان وارد کنید.", adminBackMenu());
      return true;
    }
    await services.updatePackage(user.pendingOrderId, { priceToman: price });
    await showDetail(user, chatId, user.pendingOrderId);
    return true;
  }

  if (user.adminStep === "SVC:EDIT_DESC" && user.pendingOrderId) {
    const description = text === BTN.SKIP ? "" : text.trim();
    await services.updatePackage(user.pendingOrderId, { description });
    await showDetail(user, chatId, user.pendingOrderId);
    return true;
  }

  return false;
}

module.exports = {
  isServiceAdminStep,
  showList,
  showDetail,
  handleText,
  handleCallback,
  goBack,
};
