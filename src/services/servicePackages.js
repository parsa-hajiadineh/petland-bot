const prisma = require("../database/prisma");

const DEFAULT_PACKAGES = [
  {
    code: "SETUP_FIRST_MONTH",
    title: "راه‌اندازی + ماه اول",
    description: "راه‌اندازی ربات فروشگاهی و هزینه ماه اول",
    priceToman: 50000000,
    sortOrder: 10,
  },
  {
    code: "DATASHEET_SETUP",
    title: "تنظیمات اولیه با Data Sheet",
    description: "وارد کردن کالاها و تنظیمات اولیه از شیت داده",
    priceToman: 3000000,
    sortOrder: 20,
  },
  {
    code: "FULL_SETUP",
    title: "تنظیمات کامل توسط تیم",
    description: "پیکربندی کامل فروشگاه توسط تیم پت‌لند",
    priceToman: 10000000,
    sortOrder: 30,
  },
  {
    code: "MONTHLY_SUB",
    title: "اشتراک ماهانه",
    description: "تمدید ماهانه اشتراک ربات فروشگاهی",
    priceToman: 10000000,
    sortOrder: 40,
  },
  {
    code: "MONTHLY_SUPPORT",
    title: "پشتیبانی ماهانه",
    description: "پشتیبانی ماهانه تیم برای فروشگاه همکار",
    priceToman: 10000000,
    sortOrder: 50,
  },
];

const PACKAGE_SELECT = {
  id: true,
  code: true,
  title: true,
  description: true,
  priceToman: true,
  isActive: true,
  isArchived: true,
  sortOrder: true,
};

function newId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function hasPackageModel() {
  return Boolean(prisma.servicePackage?.findMany);
}

function hasPickModel() {
  return Boolean(prisma.servicePick?.findMany);
}

let ensurePromise = null;

async function ensureServicePackages() {
  if (!ensurePromise) {
    ensurePromise = ensureInner().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

async function execSql(label, sql, ...params) {
  try {
    if (params.length) {
      await prisma.$executeRawUnsafe(sql, ...params);
    } else {
      await prisma.$executeRawUnsafe(sql);
    }
  } catch (err) {
    console.error(label, err.message);
  }
}

async function ensureInner() {
  await execSql(
    "SERVICE PACKAGE TABLE SKIP:",
    `CREATE TABLE IF NOT EXISTS "ServicePackage" (
      "id" TEXT NOT NULL,
      "code" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "description" TEXT,
      "priceToman" INTEGER NOT NULL,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "isArchived" BOOLEAN NOT NULL DEFAULT false,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ServicePackage_pkey" PRIMARY KEY ("id")
    )`
  );
  await execSql(
    "SERVICE PACKAGE CODE INDEX SKIP:",
    `CREATE UNIQUE INDEX IF NOT EXISTS "ServicePackage_code_key" ON "ServicePackage"("code")`
  );
  await execSql(
    "SERVICE PICK TABLE SKIP:",
    `CREATE TABLE IF NOT EXISTS "ServicePick" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "packageId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ServicePick_pkey" PRIMARY KEY ("id")
    )`
  );
  await execSql(
    "SERVICE PICK UNIQUE SKIP:",
    `CREATE UNIQUE INDEX IF NOT EXISTS "ServicePick_userId_packageId_key" ON "ServicePick"("userId", "packageId")`
  );

  for (const pack of DEFAULT_PACKAGES) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ServicePackage"
          ("id","code","title","description","priceToman","isActive","isArchived","sortOrder","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,true,false,$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
         ON CONFLICT ("code") DO NOTHING`,
        newId(),
        pack.code,
        pack.title,
        pack.description,
        pack.priceToman,
        pack.sortOrder
      );
    } catch (err) {
      console.error("SERVICE SEED SKIP:", pack.code, err.message);
    }
  }
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    priceToman: Number(row.priceToman),
    isActive: Boolean(row.isActive),
    isArchived: Boolean(row.isArchived),
    sortOrder: Number(row.sortOrder),
  };
}

async function listPackages({ includeArchived = false } = {}) {
  await ensureServicePackages();
  if (hasPackageModel()) {
    try {
      return await prisma.servicePackage.findMany({
        where: includeArchived ? {} : { isArchived: false },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: PACKAGE_SELECT,
      });
    } catch (err) {
      console.error("SERVICE LIST PRISMA SKIP:", err.message);
    }
  }
  const rows = includeArchived
    ? await prisma.$queryRawUnsafe(
        `SELECT "id","code","title","description","priceToman","isActive","isArchived","sortOrder"
         FROM "ServicePackage" ORDER BY "sortOrder" ASC, "createdAt" ASC`
      )
    : await prisma.$queryRawUnsafe(
        `SELECT "id","code","title","description","priceToman","isActive","isArchived","sortOrder"
         FROM "ServicePackage" WHERE "isArchived" = false
         ORDER BY "sortOrder" ASC, "createdAt" ASC`
      );
  return (rows || []).map(mapRow);
}

async function listActivePackages() {
  const all = await listPackages({ includeArchived: false });
  return all.filter((pack) => pack.isActive && !pack.isArchived);
}

async function getPackage(id) {
  await ensureServicePackages();
  if (!id) return null;
  if (hasPackageModel()) {
    try {
      return await prisma.servicePackage.findUnique({
        where: { id },
        select: PACKAGE_SELECT,
      });
    } catch (err) {
      console.error("SERVICE GET PRISMA SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id","code","title","description","priceToman","isActive","isArchived","sortOrder"
     FROM "ServicePackage" WHERE "id" = $1 LIMIT 1`,
    id
  );
  return mapRow(rows?.[0]);
}

async function createPackage({ title, description, priceToman }) {
  await ensureServicePackages();
  const id = newId();
  const code = `CUSTOM_${Date.now().toString(36)}`;
  const packs = await listPackages({ includeArchived: true });
  const sortOrder =
    packs.reduce((max, pack) => Math.max(max, pack.sortOrder || 0), 0) + 10;
  const data = {
    id,
    code,
    title,
    description: description || null,
    priceToman,
    isActive: true,
    isArchived: false,
    sortOrder,
  };
  if (hasPackageModel()) {
    try {
      return await prisma.servicePackage.create({
        data: {
          code: data.code,
          title: data.title,
          description: data.description,
          priceToman: data.priceToman,
          sortOrder: data.sortOrder,
        },
        select: PACKAGE_SELECT,
      });
    } catch (err) {
      console.error("SERVICE CREATE PRISMA SKIP:", err.message);
    }
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ServicePackage"
      ("id","code","title","description","priceToman","isActive","isArchived","sortOrder","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,true,false,$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    data.id,
    data.code,
    data.title,
    data.description,
    data.priceToman,
    data.sortOrder
  );
  return getPackage(id);
}

async function updatePackage(id, patch) {
  await ensureServicePackages();
  const data = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.priceToman !== undefined) data.priceToman = patch.priceToman;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;
  if (patch.isArchived !== undefined) data.isArchived = patch.isArchived;
  if (hasPackageModel()) {
    try {
      return await prisma.servicePackage.update({
        where: { id },
        data,
        select: PACKAGE_SELECT,
      });
    } catch (err) {
      console.error("SERVICE UPDATE PRISMA SKIP:", err.message);
    }
  }
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [key, value] of Object.entries(data)) {
    sets.push(`"${key}" = $${i}`);
    vals.push(value);
    i += 1;
  }
  sets.push(`"updatedAt" = CURRENT_TIMESTAMP`);
  vals.push(id);
  await prisma.$executeRawUnsafe(
    `UPDATE "ServicePackage" SET ${sets.join(", ")} WHERE "id" = $${i}`,
    ...vals
  );
  return getPackage(id);
}

async function archivePackage(id) {
  return updatePackage(id, { isArchived: true, isActive: false });
}

async function restorePackage(id) {
  return updatePackage(id, { isArchived: false, isActive: true });
}

async function countPicks(packageId) {
  await ensureServicePackages();
  if (hasPickModel()) {
    try {
      return await prisma.servicePick.count({ where: { packageId } });
    } catch (err) {
      console.error("SERVICE PICK COUNT SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "ServicePick" WHERE "packageId" = $1`,
    packageId
  );
  return Number(rows?.[0]?.n || 0);
}

async function deletePackage(id) {
  const picked = await countPicks(id);
  if (picked > 0) {
    const archived = await archivePackage(id);
    return { ok: true, archived: true, pack: archived };
  }
  await ensureServicePackages();
  if (hasPackageModel()) {
    try {
      await prisma.servicePackage.delete({ where: { id } });
      return { ok: true, archived: false };
    } catch (err) {
      console.error("SERVICE DELETE PRISMA SKIP:", err.message);
    }
  }
  await prisma.$executeRawUnsafe(
    `DELETE FROM "ServicePackage" WHERE "id" = $1`,
    id
  );
  return { ok: true, archived: false };
}

async function listPicks(userId) {
  await ensureServicePackages();
  if (hasPickModel()) {
    try {
      return await prisma.servicePick.findMany({
        where: { userId },
        select: { packageId: true },
      });
    } catch (err) {
      console.error("SERVICE PICK LIST SKIP:", err.message);
    }
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "packageId" FROM "ServicePick" WHERE "userId" = $1`,
    userId
  );
  return rows || [];
}

async function replacePicks(userId, packageIds) {
  await ensureServicePackages();
  const ids = [...new Set((packageIds || []).filter(Boolean))];
  if (hasPickModel()) {
    try {
      await prisma.servicePick.deleteMany({ where: { userId } });
      if (ids.length) {
        await prisma.servicePick.createMany({
          data: ids.map((packageId) => ({ userId, packageId })),
        });
      }
      return;
    } catch (err) {
      console.error("SERVICE PICK SAVE PRISMA SKIP:", err.message);
    }
  }
  await prisma.$executeRawUnsafe(
    `DELETE FROM "ServicePick" WHERE "userId" = $1`,
    userId
  );
  for (const packageId of ids) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ServicePick" ("id","userId","packageId","createdAt")
         VALUES ($1,$2,$3,CURRENT_TIMESTAMP)
         ON CONFLICT ("userId","packageId") DO NOTHING`,
        newId(),
        userId,
        packageId
      );
    } catch (err) {
      console.error("SERVICE PICK INSERT SKIP:", err.message);
    }
  }
}

module.exports = {
  ensureServicePackages,
  listPackages,
  listActivePackages,
  getPackage,
  createPackage,
  updatePackage,
  archivePackage,
  restorePackage,
  deletePackage,
  listPicks,
  replacePicks,
};
