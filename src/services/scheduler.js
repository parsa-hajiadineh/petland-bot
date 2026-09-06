const motivation = require("./motivation");

const HOUR_MS = 60 * 60 * 1000;
const KINDS = {
  GOLDEN_12H: "GOLDEN_12H",
  GOLDEN_2H: "GOLDEN_2H",
  GOLDEN_END: "GOLDEN_END",
  SUB_5D: "SUB_5D",
  SUB_END: "SUB_END",
  INV_PAY_1: "INV_PAY_1",
  INV_PAY_2: "INV_PAY_2",
  MOT_INCENTIVE: "MOT_INCENTIVE",
  MOT_CREDIT: "MOT_CREDIT",
  MOT_GOLDEN_PROGRESS: "MOT_GOLDEN_PROGRESS",
};

let started = false;
let lastDailyKey = "";
let running = false;

function tehranDayKey(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" });
}

async function tick() {
  if (running) return;
  running = true;
  try {
    await motivation.runScheduled();
    const dayKey = tehranDayKey();
    await require("./proformaCleanup").expireApprovedProformas();
    if (dayKey !== lastDailyKey) {
      lastDailyKey = dayKey;
      await require("./receiptCleanup").purgeExpiredReceipts();
      await require("./proformaCleanup").purgeOldRejectedProformas();
    }
  } catch (err) {
    console.error("SCHEDULER TICK:", err.message);
  } finally {
    running = false;
  }
}

function start() {
  if (started) return;
  started = true;
  setTimeout(() => {
    tick().catch((err) => console.error("SCHEDULER START:", err.message));
  }, 20000);
  setInterval(() => {
    tick().catch((err) => console.error("SCHEDULER:", err.message));
  }, HOUR_MS);
  setInterval(() => {
    require("./proformaCleanup")
      .expireApprovedProformas()
      .catch((err) => console.error("PROFORMA EXPIRE:", err.message));
  }, 60 * 1000);
}

module.exports = {
  start,
  tick,
  KINDS,
};
