const prisma = require("../database/prisma");
const packages = require("./servicePackages");

const SPECIAL_TEXT_CODE = "SPECIAL_SERVICES_TEXT";
const DEFAULT_TEXT = "متن خدمات ویژه هنوز تنظیم نشده است.";

async function getRecord() {
  await packages.ensureServicePackages();
  if (prisma.servicePackage?.findUnique) {
    try {
      return await prisma.servicePackage.findUnique({
        where: { code: SPECIAL_TEXT_CODE },
      });
    } catch (err) {
      console.error("SPECIAL TEXT GET SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "ServicePackage" WHERE "code" = $1 LIMIT 1`,
    SPECIAL_TEXT_CODE
  );
  return rows?.[0] || null;
}

async function getText() {
  const row = await getRecord();
  return String(row?.description || "").trim() || DEFAULT_TEXT;
}

async function setText(text) {
  const body = String(text || "").trim();
  if (!body) return getText();
  const existing = await getRecord();
  if (existing?.id) {
    await packages.updatePackage(existing.id, {
      description: body,
      isActive: false,
      isArchived: true,
    });
    return getText();
  }
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  try {
    if (prisma.servicePackage?.create) {
      await prisma.servicePackage.create({
        data: {
          id,
          code: SPECIAL_TEXT_CODE,
          title: "متن خدمات ویژه",
          description: body,
          priceToman: 0,
          kind: "SERVICE",
          billing: "ONCE",
          isActive: false,
          isArchived: true,
          sortOrder: 9999,
        },
      });
      return getText();
    }
  } catch (err) {
    console.error("SPECIAL TEXT CREATE SKIP:", err.message);
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ServicePackage"
      ("id","code","title","description","priceToman","kind","billing","isActive","isArchived","sortOrder","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,0,'SERVICE','ONCE',false,true,9999,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    id,
    SPECIAL_TEXT_CODE,
    "متن خدمات ویژه",
    body
  );
  return getText();
}

function isSpecialTextPackage(pack) {
  return pack?.code === SPECIAL_TEXT_CODE;
}

module.exports = {
  SPECIAL_TEXT_CODE,
  getText,
  setText,
  isSpecialTextPackage,
};
