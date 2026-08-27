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
    await engine.start();
  } catch (err) {
    console.error("ENGINE START:", err);
  }
  await ensureMotherCatalog();
  try {
    await ensureServicePackages();
    await ensureServiceInvoices();
  } catch (err) {
    console.error("SERVICE PACKAGES SKIP:", err.message);
  }
});
