const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

let motherTenantId = null;

function getMotherTenantId() {
  return motherTenantId;
}

async function ensureMotherCatalog() {
  try {
    let tenant = await prisma.tenant.findFirst({
      where: { name: "پت لند" },
    });
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          name: "پت لند",
          type: "OTHER",
          status: "ACTIVE",
          description: "ربات مادر",
        },
      });
    }
    motherTenantId = tenant.id;

    await prisma.tenantSettings.upsert({
      where: { tenantId: tenant.id },
      create: {
        tenantId: tenant.id,
        shopName: "پت لند",
      },
      update: {},
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