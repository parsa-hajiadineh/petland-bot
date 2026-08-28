const prisma = require("../../database/prisma");
const partnerNotify = require("../partnerNotify");
const { collectFacts } = require("./facts");
const { pickRule, HOUR_MS } = require("./rules");
const subscriptions = require("../tenantSubscriptions");
const invoices = require("../serviceInvoices");

const COOLDOWN_SCHEDULE_MS = 12 * HOUR_MS;
const COOLDOWN_EVENT_MS = 4 * HOUR_MS;

let ensurePromise = null;

async function execSql(label, sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (err) {
    console.error(label, err.message);
  }
}

async function ensureNotices() {
  if (!ensurePromise) {
    ensurePromise = execSql(
      "COLLEAGUE NOTICE TABLE SKIP:",
      `CREATE TABLE IF NOT EXISTS "ColleagueNotice" (
        "id" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "tenantId" TEXT,
        "reference" TEXT NOT NULL,
        "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ColleagueNotice_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "ColleagueNotice_kind_user_ref_key" UNIQUE ("kind", "userId", "reference")
      )`
    ).catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

function newId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function tehranHour(now = new Date()) {
  const raw = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tehran",
    hour: "2-digit",
    hour12: false,
  }).format(now);
  return Number(raw);
}

function isQuietHours(now = new Date()) {
  const hour = tehranHour(now);
  return hour >= 23 || hour < 8;
}

async function alreadySent(kind, userId, reference) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "ColleagueNotice"
     WHERE "kind" = $1 AND "userId" = $2 AND "reference" = $3
     LIMIT 1`,
    kind,
    userId,
    reference
  );
  return Boolean(rows?.[0]);
}

async function lastSentAt(userId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "sentAt" FROM "ColleagueNotice"
     WHERE "userId" = $1
     ORDER BY "sentAt" DESC
     LIMIT 1`,
    userId
  );
  return rows?.[0]?.sentAt ? new Date(rows[0].sentAt) : null;
}

async function markSent(kind, userId, reference, tenantId) {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ColleagueNotice" ("id","kind","userId","tenantId","reference","sentAt")
       VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
       ON CONFLICT ("kind", "userId", "reference") DO NOTHING`,
      newId(),
      kind,
      userId,
      tenantId || null,
      reference
    );
  } catch (err) {
    console.error("MOTIVATION MARK SKIP:", err.message);
  }
}

async function canSend(facts, hit, trigger) {
  if (!hit?.text || !facts?.userId) return false;
  if (await alreadySent(hit.kind, facts.userId, hit.reference)) return false;
  if (isQuietHours(facts.now) && !hit.critical) return false;
  const last = await lastSentAt(facts.userId);
  if (last && !hit.critical) {
    const gap = trigger === "schedule" ? COOLDOWN_SCHEDULE_MS : COOLDOWN_EVENT_MS;
    if (facts.now.getTime() - last.getTime() < gap) return false;
  }
  return true;
}

async function sendHit(facts, hit) {
  const result = await partnerNotify.notifyColleague(facts.userId, hit.text);
  if (result?.skipped || result?.ok === false) return false;
  await markSent(hit.kind, facts.userId, hit.reference, facts.tenantId);
  return true;
}

async function nudgeColleague(input = {}) {
  try {
    await ensureNotices();
    const facts = await collectFacts(input);
    if (!facts) return null;
    const hit = pickRule(facts);
    if (!hit) return null;
    if (!(await canSend(facts, hit, input.trigger || "event"))) return null;
    const sent = await sendHit(facts, hit);
    return sent ? hit : null;
  } catch (err) {
    console.error("MOTIVATION NUDGE:", err.message);
    return null;
  }
}

async function ownerUserId(tenantId) {
  if (!tenantId) return null;
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { ownerUserId: true },
    });
    return tenant?.ownerUserId || null;
  } catch (err) {
    console.error("MOTIVATION OWNER SKIP:", err.message);
    return null;
  }
}

async function listTargetUserIds() {
  const ids = new Set();
  try {
    const gold = await prisma.$queryRawUnsafe(
      `SELECT "userId" FROM "ColleagueGoldenPeriod"`
    );
    for (const row of gold || []) if (row.userId) ids.add(row.userId);
  } catch (err) {
    console.error("MOTIVATION GOLDEN LIST SKIP:", err.message);
  }
  try {
    const shops = await subscriptions.listShopLifecycles();
    for (const shop of shops || []) {
      if (shop.tenantStatus === "SUSPENDED") continue;
      const owner = await ownerUserId(shop.tenantId);
      if (owner) ids.add(owner);
    }
  } catch (err) {
    console.error("MOTIVATION SHOP LIST SKIP:", err.message);
  }
  try {
    const rows = await invoices.listInvoicesByStatus(["WAITING_PAYMENT"], 0, 80);
    for (const inv of rows || []) if (inv.userId) ids.add(inv.userId);
  } catch (err) {
    console.error("MOTIVATION INVOICE LIST SKIP:", err.message);
  }
  return [...ids];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runScheduled(now = new Date()) {
  await ensureNotices();
  const userIds = await listTargetUserIds();
  for (const userId of userIds) {
    await nudgeColleague({ userId, trigger: "schedule", now });
    await sleep(350);
  }
}

module.exports = {
  ensureNotices,
  nudgeColleague,
  runScheduled,
};
