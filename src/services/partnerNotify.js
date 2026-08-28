const prisma = require("../database/prisma");
const { notifyMother, notifyShop } = require("../bot/messenger");
const { findOwnedTenant } = require("./shopProvision");

function isColleagueBuyer(user) {
  return user?.role === "COLLEAGUE" || user?.role === "ADMIN";
}

async function loadUser(userId) {
  if (!userId) return null;
  try {
    return await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, baleId: true, role: true },
    });
  } catch (err) {
    console.error("PARTNER NOTIFY USER SKIP:", err.message);
    return null;
  }
}

async function notifyColleague(userId, text) {
  const user = await loadUser(userId);
  if (!user?.baleId || !text) return { ok: false };
  if (!isColleagueBuyer(user)) return { ok: false, skipped: "not_colleague" };

  const tenant = await findOwnedTenant(userId).catch(() => null);
  if (tenant?.status === "SUSPENDED") {
    return { ok: false, skipped: "blocked" };
  }
  if (tenant?.id) {
    return notifyShop(user.baleId, text, tenant.id);
  }
  return notifyMother(user.baleId, text);
}

async function notifyOrderBuyer(order, text) {
  const user = await loadUser(order?.userId);
  if (!user?.baleId || !text) return { ok: false };
  const colleague =
    isColleagueBuyer(user) || Boolean(order?.isWholesale);
  if (colleague) return notifyColleague(user.id, text);
  return notifyMother(user.baleId, text);
}

module.exports = {
  isColleagueBuyer,
  notifyColleague,
  notifyOrderBuyer,
};
