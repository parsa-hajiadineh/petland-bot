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
  muted: "#7C3AED",
  ink: "#0F172A",
  footer: "#3730A3",
  paid: "#047857",
  white: "#FFFFFF",
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

function chromeGradient(doc, x1, y1, x2, y2) {
  const grad = doc.linearGradient(x1, y1, x2, y2);
  grad.stop(0, "#22D3EE");
  grad.stop(0.45, "#3B82F6");
  grad.stop(1, "#D946EF");
  return grad;
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
    const gap = 8;
    const tableW = doc.page.width - margin * 2;
    const halfW = (tableW - gap) / 2;
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

    function paintPageBg() {
      const bg = doc.linearGradient(0, 0, doc.page.width, doc.page.height);
      bg.stop(0, "#F8FBFF");
      bg.stop(1, "#F4F0FF");
      doc.save();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill(bg);
      doc.restore();
    }

    function paintGlassBox(x, y, w, h, opts = {}) {
      const fill = doc.linearGradient(x, y, x, y + h);
      fill.stop(0, opts.fillTop || "#FFFFFF");
      fill.stop(0.4, opts.fillMid || "#F0F9FF");
      fill.stop(1, opts.fillBottom || "#F5F3FF");
      doc.save();
      doc.roundedRect(x, y, w, h, 9).fill(fill);
      doc.restore();
      doc.save();
      doc.fillOpacity(0.42);
      doc.roundedRect(x + 2, y + 2, w - 4, Math.min(11, h * 0.32), 6).fill("#FFFFFF");
      doc.restore();
      doc.save();
      doc.lineWidth(1.4);
      doc
        .roundedRect(x, y, w, h, 9)
        .stroke(chromeGradient(doc, x, y, x + w, y + h));
      doc.restore();
    }

    function paintWatermark() {
      if (!fs.existsSync(watermarkPath())) return;
      doc.save();
      doc.opacity(0.08);
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
      const y = doc.page.height - 38;
      paintGlassBox(margin, y, tableW, 24, {
        fillTop: "#EEF2FF",
        fillMid: "#F5F3FF",
        fillBottom: "#EDE9FE",
      });
      doc.fontSize(9).fillColor(COLOR.footer);
      paintText("@Pawora_bot", margin + 10, y + 6, {
        width: tableW / 2 - 12,
        align: "left",
        lineBreak: false,
      });
      paintText("@support_pawora", margin + tableW / 2 + 2, y + 6, {
        width: tableW / 2 - 12,
        align: "right",
        lineBreak: false,
      });
      doc.page.margins.bottom = bottom;
      doc.x = prevX;
      doc.y = prevY;
    }

    function paintHeader() {
      paintPageBg();
      paintFooter();
      if (fs.existsSync(logoPath())) {
        paintImage(logoPath(), margin, 10, { width: 52, height: 52 });
      }
      const titleW = tableW - 64;
      doc.fontSize(17).fillColor(COLOR.title);
      drawText("فاکتور فروش پائورا", margin, 12, titleW);
      doc.fontSize(9).fillColor(COLOR.muted);
      drawText(
        order?.trackingCode ? `کد پیگیری ${order.trackingCode}` : "فاکتور فروش",
        margin,
        36,
        titleW
      );
      doc.save();
      doc.lineWidth(2);
      doc
        .moveTo(margin + 60, 62)
        .lineTo(margin + tableW, 62)
        .stroke(chromeGradient(doc, margin + 60, 62, margin + tableW, 62));
      doc.restore();
      doc.y = 72;
    }

    function paintSection(title) {
      ensureSpace(36, false);
      const y = doc.y + 8;
      doc.save();
      doc.roundedRect(margin, y, tableW, 26, 9).fill(
        chromeGradient(doc, margin, y, margin + tableW, y)
      );
      doc.restore();
      doc.fontSize(11).fillColor(COLOR.white);
      drawText(title, margin, y + 1, tableW);
      doc.y = y + 32;
    }

    function fieldHeight(value, width) {
      doc.fontSize(10);
      return Math.max(44, 22 + lineHeight(String(value || "—"), width - 16));
    }

    function paintField(x, y, w, h, label, value) {
      paintGlassBox(x, y, w, h);
      doc.fontSize(8).fillColor(COLOR.muted);
      drawText(label, x + 6, y + 2, w - 12);
      doc.fontSize(10).fillColor(COLOR.ink);
      drawText(value || "—", x + 6, y + 16, w - 12);
    }

    function paintPair(rightField, leftField) {
      const hasRight = Boolean(rightField && (rightField.value || rightField.value === 0));
      const hasLeft = Boolean(leftField && (leftField.value || leftField.value === 0));
      if (!hasRight && !hasLeft) return;
      if (hasRight && !hasLeft) {
        paintFull(rightField.label, rightField.value);
        return;
      }
      if (!hasRight && hasLeft) {
        paintFull(leftField.label, leftField.value);
        return;
      }
      const h = Math.max(
        fieldHeight(rightField.value, halfW),
        fieldHeight(leftField.value, halfW)
      );
      ensureSpace(h + 6, false);
      const y = doc.y;
      paintField(margin + halfW + gap, y, halfW, h, rightField.label, rightField.value);
      paintField(margin, y, halfW, h, leftField.label, leftField.value);
      doc.y = y + h + 6;
    }

    function paintFull(label, value) {
      if (!value && value !== 0) return;
      const h = fieldHeight(value, tableW);
      ensureSpace(h + 6, false);
      const y = doc.y;
      paintField(margin, y, tableW, h, label, value);
      doc.y = y + h + 6;
    }

    function paintTableHead() {
      const y = doc.y;
      const h = 24;
      doc.save();
      doc.roundedRect(margin, y, tableW, h, 0).fill(
        chromeGradient(doc, margin, y, margin + tableW, y)
      );
      doc.restore();
      doc.fontSize(9).fillColor(COLOR.white);
      drawText("نام محصول", xName, y + 1, colName);
      drawText("کد", xCode, y + 1, colCode, { align: "center" });
      drawText("تعداد", xQty, y + 1, colQty, { align: "center" });
      drawText("قیمت واحد", xUnit, y + 1, colUnit, { align: "center" });
      drawText("جمع", xTotal, y + 1, colTotal, { align: "center" });
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
    paintSection("مشخصات فاکتور");
    paintPair(
      { label: "کد پیگیری", value: order?.trackingCode },
      { label: "شماره مرجع", value: order?.adminRefNo }
    );
    paintPair(
      { label: "وضعیت سفارش", value: plainLabel(orderStatusLabel(order)) },
      { label: "نوع", value: plainLabel(orderKindLabel(order)) }
    );

    paintSection("مشخصات خریدار");
    paintPair(
      { label: "نام", value: order?.fullName },
      { label: "تلفن", value: order?.phone }
    );
    paintPair(
      { label: "استان", value: order?.province },
      { label: "شهر", value: order?.city }
    );
    paintFull("کد پستی", order?.postalCode);
    paintFull("آدرس", order?.address);
    paintFull("توضیحات", order?.description);

    ensureSpace(minRowH * 2 + 20, false);
    paintSection("اقلام سفارش");
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
        .fill(index % 2 === 0 ? "#F0F9FF" : "#FFFFFF");
      doc.restore();
      doc.save();
      doc.lineWidth(0.4).strokeColor("#C4B5FD");
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

    ensureSpace(80, false);
    doc.y += 10;
    const totalH = 30;
    doc.save();
    doc.roundedRect(margin, doc.y, tableW, totalH, 9).fill(
      chromeGradient(doc, margin, doc.y, margin + tableW, doc.y)
    );
    doc.restore();
    doc.fontSize(12).fillColor(COLOR.white);
    drawText(`جمع کل: ${formatPrice(order?.totalAmount || 0)}`, margin, doc.y + 2, tableW);
    doc.y += totalH + 8;

    const paidH = 30;
    paintGlassBox(margin, doc.y, tableW, paidH, {
      fillTop: "#ECFDF5",
      fillMid: "#D1FAE5",
      fillBottom: "#CFFAFE",
    });
    doc.fontSize(12).fillColor(COLOR.paid);
    drawText("وضعیت پرداخت: پرداخت شده", margin, doc.y + 2, tableW);
    doc.y += paidH;

    paintWatermark();
    doc.end();
  });
}

module.exports = {
  buildInvoicePdf,
};
