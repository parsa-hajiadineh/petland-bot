const prisma = require("../../database/prisma");
const campaign = require("../goldenCampaign");
const creditLedger = require("../creditLedger");
const subscriptions = require("../tenantSubscriptions");
const invoices = require("../serviceInvoices");
const { findOwnedTenant } = require("../shopProvision");

const HOUR_MS = 60 * 60 * 1000;

async function monthlySubPrice() {
  try {
    const packs = await require("../servicePackages").listActivePackages({
      billing: "MONTHLY",
      kind: "PACKAGE",
    });
    const sub = packs.find((p) => p.code === "MONTHLY_SUB") || packs[0];
    const price = Number(sub?.priceToman || 0);
    if (price > 0) return price;
  } catch (err) {
    console.error("MOTIVATION SUB PRICE SKIP:", err.message);
  }
  return 10_000_000;
}

async function shopLabel(tenant) {
  if (!tenant?.id) return "فروشگاه";
  try {
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: tenant.id },
      select: { shopName: true },
    });
    if (settings?.shopName) return settings.shopName;
  } catch (err) {
    console.error("MOTIVATION SHOP NAME SKIP:", err.message);
  }
  return tenant.name || "فروشگاه";
}

function rateFor(facts) {
  if (facts.golden?.active) {
    return Math.max(1, Number(facts.golden.percent || 10));
  }
  return Math.max(1, Number(facts.creditRatePercent || 10));
}

function neededPurchaseToman(gap, percent) {
  if (gap <= 0) return 0;
  const rate = Math.max(1, Number(percent || 10));
  return Math.ceil((gap * 100) / rate);
}

async function collectFacts({ userId, tenantId, trigger, extra, now = new Date() }) {
  if (!userId) return null;
  const tenant =
    (tenantId
      ? await prisma.tenant.findUnique({ where: { id: tenantId } }).catch(() => null)
      : null) || (await findOwnedTenant(userId).catch(() => null));
  if (tenant?.status === "SUSPENDED") return null;

  const settings = await campaign.getSettings().catch(() => campaign.DEFAULTS);
  const shopName = await shopLabel(tenant);
  const tid = tenant?.id || tenantId || null;

  let creditBalance = 0;
  try {
    const wallet = await creditLedger.getOrCreateWallet({
      tenantId: tid,
      userId,
    });
    if (wallet?.id) creditBalance = await creditLedger.getBalance(wallet.id);
  } catch (err) {
    console.error("MOTIVATION CREDIT SKIP:", err.message);
  }

  let golden = null;
  try {
    const period = await campaign.getGoldenPeriod(userId);
    if (period) {
      const hours = Number(settings.goldenHours || 48);
      const endsAt = new Date(
        new Date(period.startedAt).getTime() + hours * HOUR_MS
      );
      const hoursLeft = (endsAt.getTime() - now.getTime()) / HOUR_MS;
      const limitToman = Number(
        settings.goldenLimitToman || campaign.DEFAULTS.goldenLimitToman
      );
      let usedToman = 0;
      try {
        const wallet = await creditLedger.getOrCreateWallet({
          tenantId: tid,
          userId,
        });
        if (wallet?.id) {
          usedToman = await creditLedger.usedGoldenBase(wallet.id);
        }
      } catch (err) {
        console.error("MOTIVATION GOLDEN USED SKIP:", err.message);
      }
      const remainingToman = Math.max(0, limitToman - usedToman);
      golden = {
        startedAt: new Date(period.startedAt),
        endsAt,
        hoursLeft,
        active: hoursLeft > 0,
        limitToman,
        usedToman,
        remainingToman,
        percent: Number(period.goldenPercent || settings.goldenPercent || 500),
        ref: `${userId}:${new Date(period.startedAt).toISOString()}`,
      };
    }
  } catch (err) {
    console.error("MOTIVATION GOLDEN SKIP:", err.message);
  }

  let sub = null;
  if (tid) {
    try {
      const row = await subscriptions.getForTenant(tid, tenant?.status);
      if (row?.periodEnd) {
        const monthlyFee =
          Number(row.monthlyFee || row.price || 0) || (await monthlySubPrice());
        sub = {
          daysRemaining: row.daysRemaining,
          periodEnd: new Date(row.periodEnd),
          monthlyFee,
          lifecycle: row.lifecycle,
          ref: `${tid}:${new Date(row.periodEnd).toISOString()}`,
        };
      }
    } catch (err) {
      console.error("MOTIVATION SUB SKIP:", err.message);
    }
  }

  const creditRatePercent = Number(settings.standardPercent || 10);
  const monthlyFee = sub?.monthlyFee || (await monthlySubPrice());
  const creditGap = Math.max(0, monthlyFee - creditBalance);
  const creditPercent = golden?.active ? golden.percent : creditRatePercent;

  let openInvoice = null;
  if (tid) {
    try {
      const inv = await invoices.getOpenInvoice(tid);
      if (inv && inv.status === "WAITING_PAYMENT") {
        openInvoice = {
          id: inv.id,
          trackingCode: inv.trackingCode,
          cashAmount: Number(
            inv.cashAmount != null ? inv.cashAmount : inv.totalAmount || 0
          ),
          ageHours:
            (now.getTime() - new Date(inv.createdAt).getTime()) / HOUR_MS,
          status: inv.status,
        };
      }
    } catch (err) {
      console.error("MOTIVATION INVOICE SKIP:", err.message);
    }
  }

  const facts = {
    now,
    trigger: trigger || "schedule",
    extra: extra || {},
    userId,
    tenantId: tid,
    tenantName: shopName,
    creditBalance,
    creditRatePercent,
    creditGap,
    neededPurchase: neededPurchaseToman(creditGap, creditPercent),
    golden,
    sub,
    monthlyFee,
    openInvoice,
  };
  facts.ratePercent = rateFor(facts);
  return facts;
}

module.exports = {
  collectFacts,
  neededPurchaseToman,
};
