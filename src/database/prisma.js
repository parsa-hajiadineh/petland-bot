const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

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