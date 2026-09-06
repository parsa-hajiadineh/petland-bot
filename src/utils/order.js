const STATUS_LABELS = {
  WAITING_PAYMENT: "⏳ در انتظار پرداخت",
  WAITING_APPROVAL: "🔍 در انتظار تایید ادمین",
  APPROVED: "✅ تایید شده",
  PACKAGING: "📦 در حال بسته‌بندی",
  SHIPPED: "🚚 ارسال شده",
  DELIVERED: "🎉 تحویل داده شده",
  REJECTED: "❌ رد شده",
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

const PROFORMA_CARD_MARK = "@@CARD@@";
const PROFORMA_PAY_MS = 30 * 60 * 1000;
const PROFORMA_REJECT_KEEP_MS = 10 * 24 * 60 * 60 * 1000;
const MAX_OPEN_PROFORMAS = 3;

function hasProformaCard(order) {
  return String(order?.shipmentInfo || "").startsWith(PROFORMA_CARD_MARK);
}

function parseProformaCard(order) {
  const raw = String(order?.shipmentInfo || "");
  if (!raw.startsWith(PROFORMA_CARD_MARK)) return null;
  const rest = raw.slice(PROFORMA_CARD_MARK.length);
  const sep = rest.indexOf("@@");
  if (sep > 0) {
    const ts = Number(rest.slice(0, sep));
    if (Number.isFinite(ts) && ts > 1e12) {
      return { approvedAt: ts, card: rest.slice(sep + 2) };
    }
  }
  const fallback = order?.updatedAt ? new Date(order.updatedAt).getTime() : Date.now();
  return { approvedAt: fallback, card: rest };
}

function readProformaCard(order) {
  return parseProformaCard(order)?.card || "";
}

function encodeProformaCard(cardText) {
  return `${PROFORMA_CARD_MARK}${Date.now()}@@${String(cardText || "").trim()}`;
}

function isWholesaleProformaHold(order) {
  return Boolean(
    order?.isWholesale &&
      order.status === "WAITING_PAYMENT" &&
      !order.receiptImage &&
      !hasProformaCard(order)
  );
}

function isWholesaleProformaApproved(order) {
  return Boolean(
    order?.isWholesale &&
      order.status === "WAITING_PAYMENT" &&
      !order.receiptImage &&
      hasProformaCard(order) &&
      !isProformaPayExpired(order)
  );
}

function isRejectedProforma(order) {
  return Boolean(
    order?.isWholesale && order.status === "REJECTED" && !order.receiptImage
  );
}

function isProformaPayExpired(order) {
  if (!order?.isWholesale || order.status !== "WAITING_PAYMENT" || order.receiptImage) {
    return false;
  }
  const parsed = parseProformaCard(order);
  if (!parsed) return false;
  return Date.now() - parsed.approvedAt > PROFORMA_PAY_MS;
}

function orderStatusLabel(order) {
  if (isWholesaleProformaHold(order)) return "⏳ در انتظار بررسی پیش‌فاکتور";
  if (isProformaPayExpired(order)) return "⏰ اعتبار پیش‌فاکتور تمام شد";
  if (isWholesaleProformaApproved(order)) return "⏳ در انتظار پرداخت پیش‌فاکتور";
  return statusLabel(order?.status);
}

function dateStamp() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
}

function generateTrackingCode() {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `PL-${dateStamp()}-${rand}`;
}

function generateTenantTrackingCode() {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TS-${dateStamp()}-${rand}`;
}

function generateServiceInvoiceCode() {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `SI-${dateStamp()}-${rand}`;
}

function isMotherTrackingCode(code) {
  return String(code || "").trim().startsWith("PL-");
}

function isTenantTrackingCode(code) {
  return String(code || "").trim().startsWith("TS-");
}

module.exports = {
  statusLabel,
  orderStatusLabel,
  hasProformaCard,
  readProformaCard,
  encodeProformaCard,
  parseProformaCard,
  isWholesaleProformaHold,
  isWholesaleProformaApproved,
  isRejectedProforma,
  isProformaPayExpired,
  PROFORMA_PAY_MS,
  PROFORMA_REJECT_KEEP_MS,
  MAX_OPEN_PROFORMAS,
  generateTrackingCode,
  generateTenantTrackingCode,
  generateServiceInvoiceCode,
  isMotherTrackingCode,
  isTenantTrackingCode,
  STATUS_LABELS,
};
