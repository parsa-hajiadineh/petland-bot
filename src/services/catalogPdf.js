const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const reshape = require("arabic-reshaper").convertArabic;
const bidiFactory = require("bidi-js");
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
const bidi = bidiFactory();

const BRAND_TITLES = [
  { re: /royal\s*canin|رویال\s*کنین/, title: "محصولات رویال کنین" },
  { re: /vet\s*expert|وت\s*اکسپرت/, title: "محصولات وت اکسپرت" },
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
  if (/^[\x00-\x7F]+$/.test(raw)) return raw;
  try {
    const converted = reshape(raw);
    const embedding = bidi.getEmbeddingLevels(converted, "rtl");
    return bidi.getReorderedString(converted, embedding);
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
      info: { Title: "لیست جامع محصولات پائورا" },
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
    const footerLimit = () => doc.page.height - 32;

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

    function paintHeader() {
      doc.y = 22;
      doc.fontSize(15).fillColor("#0f3d2e");
      drawText("لیست جامع محصولات پائورا", margin, 20, tableW);
      doc.fontSize(9).fillColor("#4b5563");
      drawText(
        wholesale
          ? "قیمت همکاری — فقط کالاهای موجود"
          : "قیمت خرد — فقط کالاهای موجود",
        margin,
        42,
        tableW
      );
      doc.y = 64;
    }

    function paintTableHead() {
      const y = doc.y;
      const h = 22;
      doc.save();
      doc.rect(margin, y, tableW, h).fill("#0f3d2e");
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
      doc.rect(margin, y, tableW, 24).fill("#d7efe4");
      doc.restore();
      doc.fontSize(11).fillColor("#0f3d2e");
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
          .fill(rowIndex % 2 === 0 ? "#f4fbf7" : "#ffffff");
        doc.restore();
        doc.save();
        doc.lineWidth(0.35).strokeColor("#c5ddd2");
        doc.rect(margin, yRow, tableW, h).stroke();
        doc.restore();
        doc.fontSize(9).fillColor("#1f2937");
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
