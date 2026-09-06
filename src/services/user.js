const prisma = require("../database/prisma");
const { ADMIN_BALE_IDS, WAREHOUSE_ADMIN_BALE_IDS } = require("../config");

function baleIdOf(userOrId) {
  if (userOrId && typeof userOrId === "object") return String(userOrId.baleId || "");
  return String(userOrId || "");
}

function isPrimaryAdmin(user) {
  return ADMIN_BALE_IDS.includes(baleIdOf(user));
}

function isWarehouseAdmin(user) {
  return WAREHOUSE_ADMIN_BALE_IDS.includes(baleIdOf(user));
}

function isWarehouseOnly(user) {
  return isWarehouseAdmin(user) && !isPrimaryAdmin(user);
}

function isStaffBaleId(baleId) {
  const id = String(baleId || "");
  return ADMIN_BALE_IDS.includes(id) || WAREHOUSE_ADMIN_BALE_IDS.includes(id);
}

function staffNotifyIds() {
  if (WAREHOUSE_ADMIN_BALE_IDS.length) return WAREHOUSE_ADMIN_BALE_IDS;
  return ADMIN_BALE_IDS;
}

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
        role: isStaffBaleId(baleId) ? "ADMIN" : "CUSTOMER",
        ...(referrerId ? { referrerId } : {}),
      },
    });
  } else if (
    isStaffBaleId(baleId) &&
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
  return user?.role === "ADMIN" || isWarehouseAdmin(user);
}

async function ensureManeliRole() {
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MANELI'`
    );
  } catch (err) {
    console.error("MANELI ROLE SKIP:", err.message);
  }
}

module.exports = {
  getOrCreateUser,
  reloadUser,
  isAdmin,
  isPrimaryAdmin,
  isWarehouseAdmin,
  isWarehouseOnly,
  staffNotifyIds,
  ensureManeliRole,
};
