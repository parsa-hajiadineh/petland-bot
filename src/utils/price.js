const { DEFAULT_PROFIT_PERCENT, WHOLESALE_MIN_ORDER } = require("../config");

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

function isWholesaleUser(user) {
  return user.role === "COLLEAGUE" || user.role === "ADMIN";
}

function getMinOrderAmount(user) {
  if (user.role === "ADMIN") return 0;
  return isWholesaleUser(user) ? WHOLESALE_MIN_ORDER : 0;
}

module.exports = {
  calcRetailPrice,
  getUnitPrice,
  formatPrice,
  isWholesaleUser,
  getMinOrderAmount,
};
