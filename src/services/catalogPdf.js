const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const prisma = require("../database/prisma");
const { getMotherTenantId } = prisma;
const { getUnitPrice, formatPrice, isWholesaleUser } = require("../utils/price");

const keptPdfIds = new Map();

function isKeptCatalogPdf(userId, messageId) {
  return Boolean(userId && messageId && keptPdfIds.get(userId) === messageId);
}

function rememberCatalogPdf(userId, messageId) {
  if (userId && messageId) keptPdfIds.set(userId, messageId);
}

function takePreviousCatalogPdf(userId) {
  const prev = keptPdfIds.get(userId);
  if (prev) keptPdfIds.delete(userId);
  return prev || null;
}

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
};

const BRAND_TITLES = [
  { re: /royal\s*canin|رویال\s*کنین/, title: "محصولات رویال کنین" },
  {
    re: /vet\s*expert|وت\s*اکسپرت|vet\s*medin|وت\s*مدین|vetmedin|vet\s*skin|وت\s*اسکین|vetskin/,
    title: "محصولات وت اکسپرت",
  },
  { re: /monge|مونژه/, title: "محصولات مونژه" },
  { re: /gemon|جمون/, title: "محصولات جمون" },
  { re: /simba|سیمبا/, title: "محصولات سیمبا" },
  { re: /josera|جوسرا/, title: "محصولات جوسرا" },
  { re: /happy\s*cat|هپی\s*کت/, title: "محصولات هپی کت" },
  { re: /gim\s*cat|جیم\s*کت/, title: "محصولات جیم کت" },
  { re: /gim\s*dog|جیم\s*داگ/, title: "محصولات جیم داگ" },
  { re: /wanpy|ونپی/, title: "محصولات ونپی" },
  { re: /gourmet|گورمت/, title: "محصولات گورمت" },
  { re: /whiskas|ویسکاس/, title: "محصولات ویسکاس" },
  { re: /beaphar/, title: "محصولات بیفار" },
  { re: /bravecto/, title: "محصولات براوکتو" },
];

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

function brandKey(brand) {
  const raw = String(brand || "سایر")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const known = BRAND_TITLES.find((item) => item.re.test(raw));
  if (known) return known.title;
  return raw || "سایر";
}

function brandHeading(brand) {
  const key = brandKey(brand);
  const known = BRAND_TITLES.find((item) => item.title === key);
  if (known) return known.title;
  const fa = String(brand || "")
    .replace(/\s*\([^)]*\)\s*/g, "")
    .trim();
  if (!fa) return "سایر محصولات";
  if (fa.startsWith("محصولات ")) return fa;
  return `محصولات ${fa}`;
}

function motherCatalogWhere(extra = {}) {
  const motherId = getMotherTenantId();
  const scope = motherId
    ? { OR: [{ tenantId: null }, { tenantId: motherId }] }
    : { tenantId: null };
  return { ...extra, ...scope };
}

function groupProducts(products) {
  const groups = new Map();
  for (const product of products) {
    const key = brandKey(product.brand);
    if (!groups.has(key)) {
      groups.set(key, {
        title: brandHeading(product.brand),
        items: [],
      });
    }
    groups.get(key).items.push(product);
  }
  const list = [...groups.values()];
  list.sort((a, b) => a.title.localeCompare(b.title, "fa"));
  for (const group of list) {
    group.items.sort((a, b) =>
      String(a.title || "").localeCompare(String(b.title || ""), "fa")
    );
  }
  return list;
}

async function loadAvailableProducts() {
  return prisma.product.findMany({
    where: motherCatalogWhere({ status: "AVAILABLE" }),
    select: {
      title: true,
      code: true,
      brand: true,
      costPrice: true,
      profitPercent: true,
    },
  });
}

function buildPdf(products, user) {
  const wholesale = isWholesaleUser(user);
  const groups = groupProducts(products);

  return new Promise((resolve, reject) => {
    if (!fs.existsSync(FONT_PATH)) {
      reject(new Error("FONT_MISSING"));
      return;
    }

    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 26, bottom: 48, left: 26, right: 26 },
      info: { Title: "لیست جامع محصولات Pawora" },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("vazir", FONT_PATH);
    doc.font("vazir");

    const margin = 26;
    const tableW = doc.page.width - margin * 2;
    const colPrice = 96;
    const colCode = 72;
    const colName = tableW - colPrice - colCode;
    const minRowH = 24;
    const xName = margin + colPrice + colCode;
    const xCode = margin + colPrice;
    const xPrice = margin;
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
      doc.opacity(0.06);
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
      paintWatermark();
      paintFooter();
      if (fs.existsSync(logoPath())) {
        paintImage(logoPath(), margin, 12, { width: 48, height: 48 });
      }
      const titleW = tableW - 60;
      doc.fontSize(15).fillColor(COLOR.title);
      drawText("لیست جامع محصولات پائورا", margin, 18, titleW);
      doc.fontSize(9).fillColor(COLOR.muted);
      drawText(
        wholesale
          ? "قیمت همکاری — فقط کالاهای موجود"
          : "قیمت خرد — فقط کالاهای موجود",
        margin,
        40,
        titleW
      );
      doc.y = 66;
    }

    function paintTableHead() {
      const y = doc.y;
      const h = 22;
      doc.save();
      doc.rect(margin, y, tableW, h).fill(COLOR.head);
      doc.restore();
      doc.fontSize(10).fillColor("#ffffff");
      drawText("نام محصول", xName, y, colName);
      drawText("کد", xCode, y, colCode, { align: "center" });
      drawText("قیمت", xPrice, y, colPrice, { align: "center" });
      doc.y = y + h;
    }

    function newPage(withTableHead) {
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

    let rowIndex = 0;
    for (const group of groups) {
      ensureSpace(minRowH * 2 + 14, false);
      const y = doc.y + 10;
      doc.save();
      doc.rect(margin, y, tableW, 24).fill(COLOR.group);
      doc.restore();
      doc.fontSize(11).fillColor(COLOR.groupText);
      drawText(group.title, margin, y, tableW);
      doc.y = y + 24;
      paintTableHead();

      for (const product of group.items) {
        const title = product.title || "—";
        const code = product.code || "—";
        const price = formatPrice(getUnitPrice(product, wholesale));
        doc.fontSize(9);
        const h = lineHeight(title, colName);
        ensureSpace(h + 2, true);
        const yRow = doc.y;
        doc.save();
        doc
          .rect(margin, yRow, tableW, h)
          .fill(rowIndex % 2 === 0 ? COLOR.row : "#ffffff");
        doc.restore();
        doc.save();
        doc.lineWidth(0.35).strokeColor(COLOR.line);
        doc.rect(margin, yRow, tableW, h).stroke();
        doc.restore();
        doc.fontSize(9).fillColor(COLOR.ink);
        drawText(title, xName, yRow, colName);
        drawText(code, xCode, yRow, colCode, { align: "center" });
        drawText(price, xPrice, yRow, colPrice, { align: "center" });
        doc.y = yRow + h;
        rowIndex += 1;
      }
    }

    doc.end();
  });
}

async function buildCatalogPdf(user, products) {
  const list = Array.isArray(products)
    ? products
    : await loadAvailableProducts();
  if (!list.length) return { buffer: null, count: 0 };
  const buffer = await buildPdf(list, user);
  return { buffer, count: list.length };
}

module.exports = {
  buildCatalogPdf,
  isKeptCatalogPdf,
  rememberCatalogPdf,
  takePreviousCatalogPdf,
};
