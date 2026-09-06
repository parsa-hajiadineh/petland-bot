function toEnDigits(value) {
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  return String(value || "")
    .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)));
}

function isDigitsOnly(text) {
  return /^\d+$/.test(toEnDigits(text).trim());
}

function parseQty(text, options = {}) {
  const allowZero = Boolean(options.allowZero);
  const max = Number.isFinite(options.max) ? options.max : 999;
  const normalized = toEnDigits(text).replace(/[^\d]/g, "");
  if (!normalized) return null;
  const qty = Math.floor(Number(normalized));
  if (!Number.isFinite(qty)) return null;
  if (qty < 0 || qty > max) return null;
  if (!allowZero && qty < 1) return null;
  return qty;
}

module.exports = {
  toEnDigits,
  isDigitsOnly,
  parseQty,
};
