const express = require("express");
const { PORT } = require("./config");
const { testBot, getUpdates, answerCallbackQuery } = require("./bot/bale");
const { getOrCreateUser } = require("./services/user");
const { ensureMotherCatalog } = require("./database/prisma");
const messageHandler = require("./handlers/router");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("PetLand Bot is Running");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "petland-bot" });
});

let offset = 0;

async function processUpdate(update) {
  if (update.callback_query) {
    const cq = update.callback_query;
    try {
      await answerCallbackQuery(cq.id);
    } catch (err) {
      console.error("ANSWER CALLBACK SKIP:", err.message);
    }
    const user = await getOrCreateUser({ from: cq.from });
    await messageHandler.handleCallbackQuery(cq, user);
    return;
  }

  if (!update.message) return;

  const msg = update.message;

  let referrerBaleId = null;
  if (msg.text && msg.text.startsWith("/start ref_")) {
    referrerBaleId = msg.text.replace("/start ref_", "").trim();
  }

  const user = await getOrCreateUser(msg, referrerBaleId);

  if (msg.photo?.length) {
    await messageHandler.handlePhoto(msg, user);
    return;
  }

  if (!msg.text) return;

  await messageHandler(msg, user);
}

async function startPolling() {
  console.log("Polling Started");

  while (true) {
    try {
      const updates = await getUpdates(offset);

      if (updates.ok && updates.result.length > 0) {
        for (const update of updates.result) {
          try {
            await processUpdate(update);
          } catch (err) {
            console.error("UPDATE HANDLER ERROR:", err);
          }
          offset = update.update_id + 1;
        }
      }
    } catch (err) {
      console.error("POLLING ERROR:", err);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await ensureMotherCatalog();
  await testBot();
  startPolling();
});
