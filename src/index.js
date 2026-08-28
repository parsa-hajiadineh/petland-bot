const express = require("express");
const { PORT } = require("./config");
const { ensureMotherCatalog } = require("./database/prisma");
const { ensureServicePackages } = require("./services/servicePackages");
const { ensureServiceInvoices } = require("./services/serviceInvoices");
const engine = require("./bot/engine");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("PetLand Bot is Running");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "petland-bot" });
});

app.post("/webhook/bot/:botId", (req, res) => {
  res.status(200).json({ ok: true });
  engine.handleWebhook(req.params.botId, req.body).catch((err) => {
    console.error("WEBHOOK:", err.message);
  });
});

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    await ensureMotherCatalog();
  } catch (err) {
    console.error("MOTHER CATALOG:", err);
  }
  try {
    await engine.start();
    require("./services/scheduler").start();
  } catch (err) {
    console.error("ENGINE START:", err);
  }
  try {
    await ensureServicePackages();
    await ensureServiceInvoices();
    await require("./services/tenantSubscriptions").ensureTenantSubscriptions();
    await require("./services/shopBlock").ensureBlockColumns();
    await require("./services/creditLedger").ensureCreditLedger();
    await require("./services/financialAudit").ensureFinancialAudit();
    await require("./services/goldenCampaign").ensureGoldenCampaign();
  } catch (err) {
    console.error("SERVICE PACKAGES SKIP:", err.message);
  }
});
