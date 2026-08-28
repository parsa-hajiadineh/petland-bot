const { formatPrice } = require("../../utils/price");

const HOUR_MS = 60 * 60 * 1000;

function toman(amount) {
  return formatPrice(Math.max(0, Math.round(Number(amount) || 0)));
}

function hoursLabel(hoursLeft) {
  if (hoursLeft <= 1) return "کمتر از یک ساعت";
  const n = Math.round(hoursLeft);
  return `${n.toLocaleString("fa-IR")} ساعت`;
}

function daysLabel(days) {
  const n = Math.max(0, Math.round(Number(days) || 0));
  return `${n.toLocaleString("fa-IR")} روز`;
}

const RULES = [
  {
    id: "golden.end",
    kind: "GOLDEN_END",
    priority: 100,
    critical: true,
    match(facts) {
      const g = facts.golden;
      if (!g || g.hoursLeft > 0) return null;
      return { reference: g.ref };
    },
    render(facts) {
      const leftover = facts.golden.remainingToman;
      const extra =
        leftover > 0
          ? `\n${toman(leftover)} از سقف خرید ویژه استفاده نشد.`
          : "";
      return `دوره طلایی ساخت اعتبار تمام شد.${extra}\nاز این به بعد اعتبار با درصد عادی (${facts.creditRatePercent.toLocaleString("fa-IR")}٪) محاسبه می‌شود.`;
    },
  },
  {
    id: "sub.end",
    kind: "SUB_END",
    priority: 95,
    critical: true,
    match(facts) {
      if (!facts.sub || facts.sub.daysRemaining == null) return null;
      if (facts.sub.daysRemaining >= 0) return null;
      return { reference: facts.sub.ref };
    },
    render(facts) {
      return `اشتراک فروشگاه «${facts.tenantName}» به پایان رسید.\nبرای روشن ماندن ربات، از پنل فروشگاه اشتراک را تمدید کنید.`;
    },
  },
  {
    id: "golden.last2h",
    kind: "GOLDEN_2H",
    priority: 90,
    critical: true,
    match(facts) {
      const g = facts.golden;
      if (!g?.active || g.hoursLeft > 2 || g.remainingToman < 1) return null;
      return { reference: `${g.ref}:2h` };
    },
    render(facts) {
      const g = facts.golden;
      return `فقط ${hoursLabel(g.hoursLeft)} تا پایان دوره طلایی مانده.\n${toman(g.remainingToman)} دیگر تا سقف ${toman(g.limitToman)} خرید ویژه فاصله دارید.\nاگر خرید عمده دارید، همین پنجره با ${g.percent.toLocaleString("fa-IR")}٪ اعتبار ثبت می‌شود.`;
    },
  },
  {
    id: "incentive.renew",
    kind: "MOT_INCENTIVE",
    priority: 85,
    critical: false,
    match(facts) {
      if (!facts.sub || facts.sub.daysRemaining == null) return null;
      const days = facts.sub.daysRemaining;
      if (days < 0 || days > 7) return null;
      if (facts.creditGap < 100000) return null;
      if (facts.neededPurchase < 1) return null;
      return { reference: `${facts.sub.ref}:inc` };
    },
    render(facts) {
      const days = daysLabel(facts.sub.daysRemaining);
      const rate = facts.ratePercent;
      return `فقط ${toman(facts.neededPurchase)} خرید دیگر در ${days} آینده انجام دهید تا اعتبار لازم برای تمدید اشتراک ماهانه را بسازید.\n\nموجودی الان: ${toman(facts.creditBalance)}\nمانده تا مبلغ اشتراک: ${toman(facts.creditGap)}\nنرخ ساخت اعتبار فعلی: ${rate.toLocaleString("fa-IR")}٪`;
    },
  },
  {
    id: "golden.12h",
    kind: "GOLDEN_12H",
    priority: 80,
    critical: false,
    match(facts) {
      const g = facts.golden;
      if (!g?.active || g.hoursLeft > 12 || g.remainingToman < 1) return null;
      return { reference: g.ref };
    },
    render(facts) {
      const g = facts.golden;
      return `${hoursLabel(g.hoursLeft)} مانده تا پایان دوره طلایی.\nفقط ${toman(g.remainingToman)} دیگر تا تکمیل سقف ${toman(g.limitToman)} خرید دوره طلایی شما باقی مانده است.\nخرید در این پنجره با ${g.percent.toLocaleString("fa-IR")}٪ اعتبار ویژه حساب می‌شود.`;
    },
  },
  {
    id: "sub.soon",
    kind: "SUB_5D",
    priority: 70,
    critical: false,
    match(facts) {
      if (!facts.sub || facts.sub.daysRemaining == null) return null;
      const days = facts.sub.daysRemaining;
      if (days < 0 || days > 5) return null;
      return { reference: facts.sub.ref };
    },
    render(facts) {
      const days = facts.sub.daysRemaining;
      const line =
        days <= 1
          ? "کمتر از یک روز تا پایان اشتراک شما باقی مانده."
          : `${days.toLocaleString("fa-IR")} روز تا پایان اشتراک شما باقی مانده.`;
      return `${line}\nفروشگاه «${facts.tenantName}» را قبل از قطع سرویس تمدید کنید.`;
    },
  },
  {
    id: "invoice.pay2",
    kind: "INV_PAY_2",
    priority: 65,
    critical: false,
    match(facts) {
      const inv = facts.openInvoice;
      if (!inv || inv.ageHours < 72) return null;
      return { reference: inv.id };
    },
    render(facts) {
      const inv = facts.openInvoice;
      return `فاکتور خدمات هنوز پرداخت نشده است.\n\n🔖 ${inv.trackingCode}\n💰 قابل پرداخت: ${toman(inv.cashAmount)}\n\nاز فاکتور خدمات، تکمیل پرداخت را بزنید.`;
    },
  },
  {
    id: "invoice.pay1",
    kind: "INV_PAY_1",
    priority: 55,
    critical: false,
    match(facts) {
      const inv = facts.openInvoice;
      if (!inv || inv.ageHours < 20 || inv.ageHours >= 72) return null;
      return { reference: inv.id };
    },
    render(facts) {
      const inv = facts.openInvoice;
      return `فاکتور خدمات در انتظار پرداخت است.\n\n🔖 ${inv.trackingCode}\n💰 قابل پرداخت: ${toman(inv.cashAmount)}\n\nبا تکمیل پرداخت، اشتراک بدون وقفه می‌ماند.`;
    },
  },
  {
    id: "credit.covers",
    kind: "MOT_CREDIT",
    priority: 45,
    critical: false,
    match(facts) {
      if (!facts.sub || facts.sub.daysRemaining == null) return null;
      if (facts.sub.daysRemaining < 0 || facts.sub.daysRemaining > 10) return null;
      if (facts.creditBalance < 1) return null;
      if (facts.creditGap > 0) return null;
      return { reference: `${facts.sub.ref}:cred` };
    },
    render(facts) {
      return `موجودی کیف پول اعتباری شما: ${toman(facts.creditBalance)}\nاین موجودی برای تمدید اشتراک «${facts.tenantName}» کافی است.\nاز پنل فروشگاه تمدید را بزنید تا نقدی نپردازید.`;
    },
  },
  {
    id: "golden.progress",
    kind: "MOT_GOLDEN_PROGRESS",
    priority: 40,
    critical: false,
    match(facts) {
      if (facts.trigger !== "credit_granted") return null;
      const g = facts.golden;
      if (!g?.active || g.remainingToman < 1) return null;
      const orderId = facts.extra.orderId || "x";
      return { reference: `prog:${orderId}` };
    },
    render(facts) {
      const g = facts.golden;
      return `سقف طلایی هنوز جا دارد: ${toman(g.remainingToman)} از ${toman(g.limitToman)}.\n${hoursLabel(g.hoursLeft)} از پنجره ویژه باقی است — خرید بعدی با ${g.percent.toLocaleString("fa-IR")}٪ اعتبار می‌سازد.`;
    },
  },
];

function pickRule(facts) {
  let best = null;
  for (const rule of RULES) {
    const hit = rule.match(facts);
    if (!hit) continue;
    if (!best || rule.priority > best.priority) {
      best = {
        id: rule.id,
        kind: rule.kind,
        priority: rule.priority,
        critical: Boolean(rule.critical),
        reference: hit.reference,
        text: rule.render(facts),
      };
    }
  }
  return best;
}

module.exports = {
  RULES,
  pickRule,
  HOUR_MS,
};
