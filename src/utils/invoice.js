const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { formatPrice } = require("./price");
const { statusLabel } = require("./order");
const { SHOP_NAME, BANK_CARD, BANK_IBAN, BANK_HOLDER, BANK_NAME } = require("../config");

function buildInvoiceText(order, items, shopName = SHOP_NAME) {
  const lines = [
    `🧾 فاکتور ${shopName}`,
    `━━━━━━━━━━━━━━━━━━`,
    `🔖 کد پیگیری: ${order.trackingCode}`,
    `📊 وضعیت: ${statusLabel(order.status)}`,
    `👤 ${order.fullName}`,
    `📱 ${order.phone}`,
    `📍 ${order.province}، ${order.city}`,
    `🏠 ${order.address}`,
  ];

  if (order.postalCode) {
    lines.push(`📮 کد پستی: ${order.postalCode}`);
  }

  if (order.description) {
    lines.push(`📝 توضیحات: ${order.description}`);
  }

  lines.push("", "📦 اقلام سفارش:", "");

  for (const item of items) {
    lines.push(
      `• ${item.product.title}`,
      `  کد: ${item.product.code} | تعداد: ${item.quantity}`,
      `  قیمت واحد: ${formatPrice(item.unitPrice)}`,
      `  جمع: ${formatPrice(item.unitPrice * item.quantity)}`,
      ""
    );
  }

  lines.push(
    "━━━━━━━━━━━━━━━━━━",
    `💰 جمع کل: ${formatPrice(order.totalAmount)}`,
    order.isWholesale ? "🏷 نوع: خرید همکار" : "🏷 نوع: خرید عادی"
  );

  return lines.join("\n");
}

function buildPaymentInfo(bank) {
  const card = bank?.card ?? BANK_CARD;
  const iban = bank?.iban ?? BANK_IBAN;
  const holder = bank?.holder ?? BANK_HOLDER;
  const name = bank?.name ?? BANK_NAME;
  const lines = [
    "💳 اطلاعات پرداخت",
    "━━━━━━━━━━━━━━━━━━",
  ];

  if (card) lines.push(`💳 شماره کارت: ${card}`);
  if (iban) lines.push(`🔢 شماره شبا: ${iban}`);
  if (holder) lines.push(`👤 به نام: ${holder}`);
  if (name) lines.push(`🏦 بانک: ${name}`);

  lines.push(
    "",
    "پس از واریز، از دکمه «📸 ارسال رسید پرداخت» استفاده کنید",
    "و اسکرین‌شات رسید را ارسال نمایید."
  );

  return lines.join("\n");
}

function buildShippingInfo() {
  return [
    "🚚 اطلاعات ارسال",
    "━━━━━━━━━━━━━━━━━━",
    "📍 تهران و کرج:",
    "تحویل یک‌روزه در روزهای کاری",
    "برای سفارش‌های ثبت‌شده قبل از ساعت ۱۶",
    "قابلیت ارسال با اسنپ",
    "",
    "📍 شهرستان:",
    "ارسال با پست پیشتاز",
    "",
    "💰 هزینه ارسال به عهده مشتری است.",
  ].join("\n");
}

function buildTenantShippingInfo(shop) {
  const lines = ["🚚 ارسال سفارش", "━━━━━━━━━━━━━━━━━━"];
  if (shop?.address) lines.push(`📍 ${shop.address}`);
  if (shop?.phone) lines.push(`📞 هماهنگی: ${shop.phone}`);
  lines.push("", "هزینه و نحوه ارسال با همین فروشگاه هماهنگ می‌شود.");
  return lines.join("\n");
}

async function generateInvoicePdf(order, items) {
  const dir = path.join(process.cwd(), "tmp");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${order.trackingCode}.pdf`);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);
    doc.fontSize(18).text(`${SHOP_NAME} - Invoice`, { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(`Tracking: ${order.trackingCode}`);
    doc.text(`Customer: ${order.fullName}`);
    doc.text(`Phone: ${order.phone}`);
    doc.text(`Address: ${order.province}, ${order.city}, ${order.address}`);
    doc.moveDown();

    for (const item of items) {
      doc.text(
        `${item.product.title} x${item.quantity} = ${formatPrice(
          item.unitPrice * item.quantity
        )}`
      );
    }

    doc.moveDown();
    doc.fontSize(14).text(`Total: ${formatPrice(order.totalAmount)}`);
    doc.end();

    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return filePath;
}

module.exports = {
  buildInvoiceText,
  buildPaymentInfo,
  buildShippingInfo,
  buildTenantShippingInfo,
  generateInvoicePdf,
};
