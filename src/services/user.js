const prisma = require("../database/prisma");
const { ADMIN_BALE_IDS } = require("../config");

async function getOrCreateUser(msg, referrerBaleId = null) {
  const baleId = String(msg.from.id);

  let user = await prisma.user.findUnique({
    where: { baleId },
  });

  if (!user) {
    let referrerId = null;

    if (referrerBaleId && referrerBaleId !== baleId) {
      const referrer = await prisma.user.findUnique({
        where: { baleId: referrerBaleId },
      });
      if (referrer) referrerId = referrer.id;
    }

    user = await prisma.user.create({
      data: {
        baleId,
        fullName: msg.from.first_name || "",
        role: ADMIN_BALE_IDS.includes(baleId) ? "ADMIN" : "CUSTOMER",
        ...(referrerId ? { referrerId } : {}),
      },
    });
  } else if (
    ADMIN_BALE_IDS.includes(baleId) &&
    user.role !== "ADMIN"
  ) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { role: "ADMIN" },
    });
  }

  return user;
}

async function reloadUser(userId) {
  return prisma.user.findUnique({ where: { id: userId } });
}

function isAdmin(user) {
  return user.role === "ADMIN";
}

module.exports = {
  getOrCreateUser,
  reloadUser,
  isAdmin,
};
