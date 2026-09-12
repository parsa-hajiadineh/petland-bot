const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const reshape = require("arabic-reshaper").convertArabic;
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
const LOGO_PATH = path.join(__dirname, "../../assets/brand/pawora-logo.png");

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

function rtl(text) {
  const raw = String(text || "");
  if (!raw) return "";
  if (/^[\x00-\x7F@._\-]+$/.test(raw)) return raw;
  try {
    return reshape(raw).split("").reverse().join("");
  } catch (err) {
    return raw;
  }
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
      margin: 26,
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
    const footerLimit = () => doc.page.height - 58;

    function drawText(text, x, y, width, opts = {}) {
      doc.text(rtl(text), x + 4, y + 6, {
        width: width - 8,
        align: opts.align || "right",
        lineGap: 1,
      });
    }

    function lineHeight(text, width) {
      const h = doc.heightOfString(rtl(text), {
        width: width - 8,
        align: "right",
        lineGap: 1,
      });
      return Math.max(minRowH, Math.ceil(h) + 12);
    }

    function paintWatermark() {
      if (!fs.existsSync(LOGO_PATH)) return;
      doc.save();
      doc.opacity(0.06);
      const size = 360;
      doc.image(LOGO_PATH, (doc.page.width - size) / 2, (doc.page.height - size) / 2, {
        width: size,
      });
      doc.restore();
    }

    function paintFooter() {
      const y = doc.page.height - 50;
      doc.save();
      doc.rect(margin, y, tableW, 36).fill(COLOR.footerBg);
      doc.restore();
      doc.fontSize(8).fillColor(COLOR.footer);
      doc.text("@Pawora_bot", margin + 8, y + 8, { width: 130, align: "left" });
      drawText("ربات فروشگاهی بله", margin + 138, y + 2, tableW - 146);
      doc.fontSize(8).fillColor(COLOR.footer);
      doc.text("@support_pawora", margin + 8, y + 22, { width: 130, align: "left" });
      drawText("پشتیبانی بله و واتساپ", margin + 138, y + 16, tableW - 146);
    }

    function paintHeader() {
      paintWatermark();
      paintFooter();
      if (fs.existsSync(LOGO_PATH)) {
        doc.image(LOGO_PATH, margin, 14, { width: 44, height: 44 });
      }
      const titleW = tableW - 56;
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

async function buildCatalogPdf(user) {
  const products = await loadAvailableProducts();
  if (!products.length) return { buffer: null, count: 0 };
  const buffer = await buildPdf(products, user);
  return { buffer, count: products.length };
}

module.exports = {
  buildCatalogPdf,
  isKeptCatalogPdf,
  rememberCatalogPdf,
  takePreviousCatalogPdf,
};
