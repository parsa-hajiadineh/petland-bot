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

function hasProformaCard(order) {
  return String(order?.shipmentInfo || "").startsWith(PROFORMA_CARD_MARK);
}

function readProformaCard(order) {
  if (!hasProformaCard(order)) return "";
  return String(order.shipmentInfo).slice(PROFORMA_CARD_MARK.length);
}

function encodeProformaCard(cardText) {
  return `${PROFORMA_CARD_MARK}${String(cardText || "").trim()}`;
}

function isWholesaleProformaHold(order) {
  return Boolean(
    order?.isWholesale &&
      order.status === "WAITING_PAYMENT" &&
      !order.receiptImage &&
      !hasProformaCard(order)
  );
}

function orderStatusLabel(order) {
  if (isWholesaleProformaHold(order)) return "⏳ در انتظار بررسی پیش‌فاکتور";
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
  isWholesaleProformaHold,
  generateTrackingCode,
  generateTenantTrackingCode,
  generateServiceInvoiceCode,
  isMotherTrackingCode,
  isTenantTrackingCode,
  STATUS_LABELS,
};
