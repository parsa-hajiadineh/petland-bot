const prisma = require("../database/prisma");
const { normalizeBaleId, parseIds } = require("../config");

function adminIds() {
  const { ADMIN_BALE_IDS } = require("../config");
  const live = parseIds(process.env.ADMIN_BALE_IDS);
  return [...new Set([...live, ...(ADMIN_BALE_IDS || [])])];
}

function warehouseAdminIds() {
  const { WAREHOUSE_ADMIN_BALE_IDS } = require("../config");
  const live = parseIds(
    process.env.WAREHOUSE_ADMIN_BALE_IDS || process.env.WAREHOUSE_ADMIN_BALE_ID
  );
  return [...new Set([...live, ...(WAREHOUSE_ADMIN_BALE_IDS || [])])];
}

function baleIdOf(userOrId) {
  const raw =
    userOrId && typeof userOrId === "object"
      ? userOrId.baleId
      : userOrId;
  return normalizeBaleId(raw);
}

function idsCompatible(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  return min >= 8 && (a.endsWith(b) || b.endsWith(a));
}

function idListHas(list, value) {
  const raw =
    value && typeof value === "object"
      ? String(value.baleId || "")
      : String(value || "");
  const id = normalizeBaleId(raw);
  if (!id) return false;
  return list.some((item) => {
    const n = normalizeBaleId(item);
    return (
      item === id ||
      item === raw.trim() ||
      n === id ||
      idsCompatible(n, id)
    );
  });
}

function isPrimaryAdmin(user) {
  return idListHas(adminIds(), baleIdOf(user));
}

function isWarehouseAdmin(user) {
  return idListHas(warehouseAdminIds(), baleIdOf(user));
}

function isWarehouseOnly(user) {
  if (isPrimaryAdmin(user)) return false;
  return isWarehouseAdmin(user) || user?.role === "ADMIN";
}

function canSwitchModes(user) {
  return isPrimaryAdmin(user) || isWarehouseAdmin(user) || isWarehouseOnly(user);
}

function isStaffBaleId(baleId) {
  return idListHas(adminIds(), baleId) || idListHas(warehouseAdminIds(), baleId);
}

function staffNotifyIds() {
  return warehouseAdminIds();
}

async function getOrCreateUser(msg, referrerBaleId = null) {
  const rawBaleId = String(msg?.from?.id || msg?.chat?.id || "");
  const baleId = normalizeBaleId(rawBaleId) || rawBaleId;
  if (!baleId) throw new Error("NO_BALE_ID");
  const staff =
    isStaffBaleId(baleId) ||
    isStaffBaleId(rawBaleId) ||
    isStaffBaleId(msg?.from?.id) ||
    isStaffBaleId(msg?.chat?.id);

  let user = await prisma.user.findUnique({
    where: { baleId },
  });
  if (!user && rawBaleId && rawBaleId !== baleId) {
    user = await prisma.user.findUnique({
      where: { baleId: rawBaleId },
    });
  }

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
  } else if (
    (staff || isStaffBaleId(user.baleId) || canSwitchModes(user)) &&
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
  return user?.role === "ADMIN" || canSwitchModes(user);
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
  canSwitchModes,
  staffNotifyIds,
  ensureManeliRole,
};
