const { DEFAULT_PROFIT_PERCENT } = require("../config");

function calcRetailPrice(product) {
  const profit = Math.floor(
    (product.costPrice * product.profitPercent) / 100
  );
  return product.costPrice + profit;
}

function getUnitPrice(product, isWholesale) {
  return isWholesale ? product.costPrice : calcRetailPrice(product);
}

function formatPrice(amount) {
  return `${Number(amount).toLocaleString("fa-IR")} تومان`;
}

const adminRetailView = new Set();

function setAdminRetailView(userId, enabled) {
  if (enabled) adminRetailView.add(userId);
  else adminRetailView.delete(userId);
}

function isWholesaleUser(user) {
  if (user.role === "COLLEAGUE") return true;
  if (user.role === "ADMIN") return !adminRetailView.has(user.id);
  return false;
}

function getMinOrderAmount() {
  return 0;
}

module.exports = {
  calcRetailPrice,
  getUnitPrice,
  formatPrice,
  isWholesaleUser,
  getMinOrderAmount,
  setAdminRetailView,
};
