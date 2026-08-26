const PRODUCT_SAFE_SELECT = {
  id: true,
  code: true,
  title: true,
  description: true,
  imageUrl: true,
  costPrice: true,
  profitPercent: true,
  status: true,
  brand: true,
  categoryId: true,
};

const ORDER_SAFE_SELECT = {
  id: true,
  trackingCode: true,
  status: true,
  fullName: true,
  phone: true,
  province: true,
  city: true,
  address: true,
  postalCode: true,
  description: true,
  totalAmount: true,
  isWholesale: true,
  receiptImage: true,
  shipmentInfo: true,
  rejectReason: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
};

const ORDER_WITH_ITEMS_SELECT = {
  ...ORDER_SAFE_SELECT,
  items: {
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
      productId: true,
      product: { select: PRODUCT_SAFE_SELECT },
    },
  },
};

const CART_ITEMS_SELECT = {
  id: true,
  quantity: true,
  productId: true,
  product: { select: PRODUCT_SAFE_SELECT },
};

module.exports = {
  PRODUCT_SAFE_SELECT,
  ORDER_SAFE_SELECT,
  ORDER_WITH_ITEMS_SELECT,
  CART_ITEMS_SELECT,
};
