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

function isMotherTrackingCode(code) {
  return String(code || "").trim().startsWith("PL-");
}

function isTenantTrackingCode(code) {
  return String(code || "").trim().startsWith("TS-");
}

module.exports = {
  statusLabel,
  generateTrackingCode,
  generateTenantTrackingCode,
  isMotherTrackingCode,
  isTenantTrackingCode,
  STATUS_LABELS,
};
