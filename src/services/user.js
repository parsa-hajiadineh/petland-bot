const prisma = require("../database/prisma");
const { normalizeBaleId, parseIds } = require("../config");

function adminIds() {
  return parseIds(process.env.ADMIN_BALE_IDS);
}

function warehouseAdminIds() {
  return parseIds(
    process.env.WAREHOUSE_ADMIN_BALE_IDS || process.env.WAREHOUSE_ADMIN_BALE_ID
  );
}

function baleIdOf(userOrId) {
  const raw =
    userOrId && typeof userOrId === "object"
      ? userOrId.baleId
      : userOrId;
  return normalizeBaleId(raw);
}

function idListHas(list, value) {
  const id = normalizeBaleId(value);
  if (!id) return false;
  return list.includes(id) || list.includes(String(value || "").trim());
}

function isPrimaryAdmin(user) {
  return idListHas(adminIds(), baleIdOf(user));
}

function isWarehouseAdmin(user) {
  return idListHas(warehouseAdminIds(), baleIdOf(user));
}

function isWarehouseOnly(user) {
  return isWarehouseAdmin(user) && !isPrimaryAdmin(user);
}

function isStaffBaleId(baleId) {
  return idListHas(adminIds(), baleId) || idListHas(warehouseAdminIds(), baleId);
}

function staffNotifyIds() {
  const warehouse = warehouseAdminIds();
  if (warehouse.length) return warehouse;
  return adminIds();
}

async function getOrCreateUser(msg, referrerBaleId = null) {
  const baleId = String(msg?.from?.id || msg?.chat?.id || "");
  if (!baleId) throw new Error("NO_BALE_ID");
  const staff =
    isStaffBaleId(baleId) ||
    isStaffBaleId(msg?.from?.id) ||
    isStaffBaleId(msg?.chat?.id);

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
        role: staff ? "ADMIN" : "CUSTOMER",
        ...(referrerId ? { referrerId } : {}),
      },
    });
  } else if (staff && user.role !== "ADMIN") {
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
