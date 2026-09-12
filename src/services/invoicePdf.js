const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { formatPrice } = require("../utils/price");
const { orderStatusLabel } = require("../utils/order");
const { orderKindLabel } = require("../utils/invoice");

const FONT_PATH = path.join(
  __dirname,
  "../../assets/fonts/Vazirmatn-Regular.ttf"
);

function logoPath() {
  const clear = path.join(__dirname, "../../assets/brand/pawora-logo-clear.png");
  const original = path.join(__dirname, "../../assets/brand/pawora-logo.png");
  return fs.existsSync(clear) ? clear : original;
}

function watermarkPath() {
  const mark = path.join(__dirname, "../../assets/brand/pawora-watermark.png");
  return fs.existsSync(mark) ? mark : logoPath();
}

const COLOR = {
  title: "#1E3A8A",
  muted: "#5B4B8A",
  head: "#2563EB",
  group: "#EDE9FE",
  groupText: "#5B21B6",
  row: "#F5F3FF",
  ink: "#1F2937",
  line: "#C4B5FD",
  footerBg: "#EEF2FF",
  footer: "#3730A3",
  paidBg: "#DCFCE7",
  paid: "#166534",
};

function hasPersian(text) {
  return /[\u0600-\u06FF]/.test(text);
}

function isNumberToken(word) {
  return /^[\d۰-۹٠-٩٫.,٬]+$/.test(word);
}

function drawToken(word) {
  if (!isNumberToken(word)) return word;
  return [...word].reverse().join("");
}

function plainLabel(text) {
  return String(text || "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildInvoicePdf(order, items) {
  const rows = Array.isArray(items) ? items : [];

  return new Promise((resolve, reject) => {
    if (!fs.existsSync(FONT_PATH)) {
      reject(new Error("FONT_MISSING"));
      return;
    }

    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 26, bottom: 48, left: 26, right: 26 },
      info: { Title: `فاکتور فروش پائورا ${order?.trackingCode || ""}`.trim() },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("vazir", FONT_PATH);
    doc.font("vazir");

    const margin = 26;
    const tableW = doc.page.width - margin * 2;
    const colTotal = 88;
    const colUnit = 88;
    const colQty = 44;
    const colCode = 68;
    const colName = tableW - colTotal - colUnit - colQty - colCode;
    const minRowH = 24;
    const xName = margin + colTotal + colUnit + colQty + colCode;
    const xCode = margin + colTotal + colUnit + colQty;
    const xQty = margin + colTotal + colUnit;
    const xUnit = margin + colTotal;
    const xTotal = margin;
    const footerLimit = () => doc.page.maxY();

    function wrapLogical(text, width) {
      const words = String(text || "")
        .split(/\s+/)
        .filter(Boolean);
      if (!words.length) return [""];
      const lines = [];
      let current = words[0];
      for (let i = 1; i < words.length; i += 1) {
        const trial = `${current} ${words[i]}`;
        if (doc.widthOfString(trial) > width) {
          lines.push(current);
          current = words[i];
        } else {
          current = trial;
        }
      }
      lines.push(current);
      return lines;
    }

    function paintText(text, x, y, opts) {
      const prevX = doc.x;
      const prevY = doc.y;
      doc.text(text, x, y, opts);
      doc.x = prevX;
      doc.y = prevY;
    }

    function drawLine(text, x, y, width, align) {
      const raw = String(text || "");
      if (!hasPersian(raw)) {
        paintText(raw, x, y, { width, align, lineBreak: false });
        return;
      }
      const words = raw.split(/\s+/).filter(Boolean);
      const space = doc.widthOfString(" ");
      const tokens = words.map((word) => drawToken(word));
      const total =
        tokens.reduce((sum, token) => sum + doc.widthOfString(token), 0) +
        space * Math.max(0, tokens.length - 1);
      let cursor =
        align === "center" ? x + (width + total) / 2 : x + width;
      for (const token of tokens) {
        cursor -= doc.widthOfString(token);
        paintText(token, cursor, y, { lineBreak: false });
        cursor -= space;
      }
    }

    function drawText(text, x, y, width, opts = {}) {
      const lines = wrapLogical(text, width - 8);
      let yy = y + 6;
      for (const line of lines) {
        drawLine(line, x + 4, yy, width - 8, opts.align || "right");
        yy += Math.max(12, Math.ceil(doc.heightOfString(line)) + 1);
      }
    }

    function lineHeight(text, width) {
      const lines = wrapLogical(text, width - 8);
      let total = 12;
      for (const line of lines) {
        total += Math.max(12, Math.ceil(doc.heightOfString(line)) + 1);
      }
      return Math.max(minRowH, total);
    }

    function paintImage(src, x, y, opts) {
      const prevX = doc.x;
      const prevY = doc.y;
      doc.image(src, x, y, opts);
      doc.x = prevX;
      doc.y = prevY;
    }

    function paintWatermark() {
      if (!fs.existsSync(watermarkPath())) return;
      doc.save();
      doc.opacity(0.1);
      const size = 280;
      paintImage(
        watermarkPath(),
        (doc.page.width - size) / 2,
        (doc.page.height - size) / 2,
        { width: size }
      );
      doc.restore();
    }

    function paintFooter() {
      const prevX = doc.x;
      const prevY = doc.y;
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const y = doc.page.height - 36;
      doc.save();
      doc.rect(margin, y, tableW, 22).fill(COLOR.footerBg);
      doc.restore();
      doc.fontSize(9).fillColor(COLOR.footer);
      paintText("@Pawora_bot", margin + 8, y + 5, {
        width: tableW / 2 - 10,
        align: "left",
        lineBreak: false,
      });
      paintText("@support_pawora", margin + tableW / 2 + 2, y + 5, {
        width: tableW / 2 - 10,
        align: "right",
        lineBreak: false,
      });
      doc.page.margins.bottom = bottom;
      doc.x = prevX;
      doc.y = prevY;
    }

    function paintHeader() {
      paintFooter();
      if (fs.existsSync(logoPath())) {
        paintImage(logoPath(), margin, 12, { width: 48, height: 48 });
      }
      const titleW = tableW - 60;
      doc.fontSize(16).fillColor(COLOR.title);
      drawText("فاکتور فروش پائورا", margin, 16, titleW);
      doc.fontSize(9).fillColor(COLOR.muted);
      drawText(
        order?.trackingCode ? `کد پیگیری ${order.trackingCode}` : "فاکتور فروش",
        margin,
        40,
        titleW
      );
      doc.y = 70;
    }

    function paintBand(text, fill, color, h = 24) {
      const y = doc.y;
      doc.save();
      doc.rect(margin, y, tableW, h).fill(fill);
      doc.restore();
      doc.fontSize(11).fillColor(color);
      drawText(text, margin, y, tableW);
      doc.y = y + h;
    }

    function paintInfoRow(label, value) {
      if (!value && value !== 0) return;
      const text = `${label}: ${value}`;
      doc.fontSize(10);
      const h = lineHeight(text, tableW);
      const y = doc.y;
      doc.save();
      doc.rect(margin, y, tableW, h).fill("#ffffff");
      doc.restore();
      doc.save();
      doc.lineWidth(0.3).strokeColor(COLOR.line);
      doc.rect(margin, y, tableW, h).stroke();
      doc.restore();
      doc.fillColor(COLOR.ink);
      drawText(text, margin, y, tableW);
      doc.y = y + h;
    }

    function paintTableHead() {
      const y = doc.y;
      const h = 22;
      doc.save();
      doc.rect(margin, y, tableW, h).fill(COLOR.head);
      doc.restore();
      doc.fontSize(9).fillColor("#ffffff");
      drawText("نام محصول", xName, y, colName);
      drawText("کد", xCode, y, colCode, { align: "center" });
      drawText("تعداد", xQty, y, colQty, { align: "center" });
      drawText("قیمت واحد", xUnit, y, colUnit, { align: "center" });
      drawText("جمع", xTotal, y, colTotal, { align: "center" });
      doc.y = y + h;
    }

    function newPage(withTableHead) {
      paintWatermark();
      doc.addPage();
      doc.font("vazir");
      paintHeader();
      if (withTableHead) paintTableHead();
    }

    function ensureSpace(needed, withTableHead) {
      if (doc.y + needed < footerLimit()) return;
      newPage(withTableHead);
    }

    paintHeader();
    paintBand("مشخصات فاکتور", COLOR.group, COLOR.groupText);
    paintInfoRow("کد پیگیری", order?.trackingCode);
    paintInfoRow("شماره مرجع", order?.adminRefNo);
    paintInfoRow("وضعیت سفارش", plainLabel(orderStatusLabel(order)));
    paintInfoRow("نوع", plainLabel(orderKindLabel(order)));
    paintInfoRow("نام", order?.fullName);
    paintInfoRow("تلفن", order?.phone);
    paintInfoRow(
      "شهر",
      [order?.province, order?.city].filter(Boolean).join("، ")
    );
    paintInfoRow("آدرس", order?.address);
    paintInfoRow("کد پستی", order?.postalCode);
    paintInfoRow("توضیحات", order?.description);

    ensureSpace(minRowH * 2 + 16, false);
    doc.y += 10;
    paintBand("اقلام سفارش", COLOR.group, COLOR.groupText);
    paintTableHead();

    rows.forEach((item, index) => {
      const title = item?.product?.title || "—";
      const code = item?.product?.code || "—";
      const qty = String(item?.quantity ?? "—");
      const unit = formatPrice(item?.unitPrice || 0);
      const sum = formatPrice((item?.unitPrice || 0) * (item?.quantity || 0));
      doc.fontSize(9);
      const h = lineHeight(title, colName);
      ensureSpace(h + 2, true);
      const yRow = doc.y;
      doc.save();
      doc
        .rect(margin, yRow, tableW, h)
        .fill(index % 2 === 0 ? COLOR.row : "#ffffff");
      doc.restore();
      doc.save();
      doc.lineWidth(0.35).strokeColor(COLOR.line);
      doc.rect(margin, yRow, tableW, h).stroke();
      doc.restore();
      doc.fontSize(9).fillColor(COLOR.ink);
      drawText(title, xName, yRow, colName);
      drawText(code, xCode, yRow, colCode, { align: "center" });
      drawText(qty, xQty, yRow, colQty, { align: "center" });
      drawText(unit, xUnit, yRow, colUnit, { align: "center" });
      drawText(sum, xTotal, yRow, colTotal, { align: "center" });
      doc.y = yRow + h;
    });

    ensureSpace(70, false);
    doc.y += 8;
    const totalH = 28;
    doc.save();
    doc.rect(margin, doc.y, tableW, totalH).fill(COLOR.head);
    doc.restore();
    doc.fontSize(12).fillColor("#ffffff");
    drawText(`جمع کل: ${formatPrice(order?.totalAmount || 0)}`, margin, doc.y, tableW);
    doc.y += totalH + 8;

    const paidH = 28;
    doc.save();
    doc.rect(margin, doc.y, tableW, paidH).fill(COLOR.paidBg);
    doc.restore();
    doc.fontSize(12).fillColor(COLOR.paid);
    drawText("وضعیت پرداخت: پرداخت شده", margin, doc.y, tableW);
    doc.y += paidH;

    paintWatermark();
    doc.end();
  });
}

module.exports = {
  buildInvoicePdf,
};
