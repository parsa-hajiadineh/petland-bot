const express = require("express");
const { PORT } = require("./config");
const { ensureMotherCatalog } = require("./database/prisma");
const engine = require("./bot/engine");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("PetLand Bot is Running");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "petland-bot" });
});

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await ensureMotherCatalog();
  await engine.start();
});
