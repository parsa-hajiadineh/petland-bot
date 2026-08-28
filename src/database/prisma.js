const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const MOTHER_DISPLAY_NAME = "پائورا";
const MOTHER_DESCRIPTION = "ربات مادر";
const MOTHER_LEGACY_NAME = "پت لند";

let motherTenantId = null;

function getMotherTenantId() {
  return motherTenantId;
}

async function findMotherTenant() {
  const byDesc = await prisma.tenant.findFirst({
    where: { description: MOTHER_DESCRIPTION },
    orderBy: { createdAt: "asc" },
  });
  if (byDesc) return byDesc;
  return prisma.tenant.findFirst({
    where: { name: MOTHER_LEGACY_NAME },
    orderBy: { createdAt: "asc" },
  });
}

async function ensureMotherCatalog() {
  try {
    let tenant = await findMotherTenant();
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          name: MOTHER_DISPLAY_NAME,
          type: "OTHER",
          status: "ACTIVE",
          description: MOTHER_DESCRIPTION,
        },
      });
    } else if (
      tenant.name !== MOTHER_DISPLAY_NAME ||
      tenant.description !== MOTHER_DESCRIPTION
    ) {
      tenant = await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          name: MOTHER_DISPLAY_NAME,
          description: MOTHER_DESCRIPTION,
        },
      });
    }
    motherTenantId = tenant.id;

    await prisma.tenantSettings.upsert({
      where: { tenantId: tenant.id },
      create: {
        tenantId: tenant.id,
        shopName: MOTHER_DISPLAY_NAME,
      },
      update: { shopName: MOTHER_DISPLAY_NAME },
    });

    const result = await prisma.product.updateMany({
      where: { tenantId: null },
      data: { tenantId: tenant.id },
    });
    console.log("MOTHER CATALOG READY:", tenant.id, "products:", result.count);
  } catch (err) {
    console.error("MOTHER CATALOG SKIP:", err.message);
  }
}

module.exports = prisma;
module.exports.ensureMotherCatalog = ensureMotherCatalog;
module.exports.getMotherTenantId = getMotherTenantId;
