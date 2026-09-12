function foldDigits(text) {
  const map = {
    "۰": "0",
    "۱": "1",
    "۲": "2",
    "۳": "3",
    "۴": "4",
    "۵": "5",
    "۶": "6",
    "۷": "7",
    "۸": "8",
    "۹": "9",
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
  };
  return String(text || "").replace(/[۰-۹٠-٩]/g, (d) => map[d] || d);
}

function normalizeFa(text) {
  return foldDigits(text)
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/[ءٔ]/g, "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[\u200c\u200d]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function compact(text) {
  return normalizeFa(text).replace(/\s+/g, "");
}

function primaryTokens(text) {
  return [...new Set(normalizeFa(text).split(/\s+/).filter(Boolean))];
}

function searchTokens(query) {
  return [
    ...new Set(
      primaryTokens(query)
        .map(compact)
        .filter((part) => part && (part.length >= 2 || /^\d+$/.test(part)))
    ),
  ];
}

function sqlCompact(expr) {
  return `replace(replace(replace(replace(replace(replace(replace(replace(
    lower(coalesce(${expr}, '')),
    'ي', 'ی'), 'ى', 'ی'), 'ك', 'ک'), 'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا'), chr(8204), ''), ' ', '')`;
}

function buildAndLikes(blobSql, query) {
  const parts = searchTokens(query);
  if (!parts.length) return null;
  const params = [];
  const clauses = [];
  for (const part of parts) {
    const packed = compact(part);
    if (!packed) continue;
    const ors = [`${blobSql} LIKE $${params.length + 1}`];
    params.push(`%${packed}%`);
    if (packed.length >= 4) {
      ors.push(`${blobSql} LIKE $${params.length + 1}`);
      params.push(`%${packed.slice(0, -1)}%`);
    }
    clauses.push(`(${ors.join(" OR ")})`);
  }
  if (!clauses.length) return null;
  return { sql: clauses.join(" AND "), params };
}

function scoreText(haystack, query) {
  const h = compact(haystack);
  const q = compact(query);
  const tokens = searchTokens(query);
  if (!h || (!q && !tokens.length)) return 0;

  if (tokens.length) {
    for (const token of tokens) {
      if (!h.includes(token)) return 0;
    }
  } else if (!h.includes(q)) {
    return 0;
  }

  if (q && h === q) return 100;
  if (q && h.startsWith(q)) return 85;
  if (q && h.includes(q)) return 70;

  let score = 50;
  for (const token of tokens) {
    score += token.length >= 3 ? 18 : 10;
  }
  return score;
}

function scoreCatalogItem(row, query) {
  const blob = `${row.title || ""} ${row.code || ""} ${row.brand || ""} ${row.description || ""} ${row.category?.title || ""}`;
  let score = scoreText(blob, query);
  const code = compact(row.code || "");
  const q = compact(query);
  if (code && q) {
    if (code === q) return 200;
    if (code.startsWith(q) || q.startsWith(code)) return Math.max(score, 140);
    if (q.length >= 2 && code.includes(q)) return Math.max(score, 110);
  }
  return score;
}

function digitKey(text) {
  return foldDigits(text).replace(/\D/g, "");
}

function phoneKeys(text) {
  const digits = digitKey(text);
  if (!digits) return [];
  const keys = new Set([digits]);
  if (digits.startsWith("98") && digits.length > 10) keys.add(digits.slice(2));
  if (digits.startsWith("0098") && digits.length > 12) keys.add(digits.slice(4));
  if (digits.startsWith("0") && digits.length > 1) keys.add(digits.slice(1));
  if (!digits.startsWith("0") && digits.length === 10) {
    keys.add(`0${digits}`);
    keys.add(`98${digits}`);
  }
  if (digits.startsWith("0") && digits.length === 11) keys.add(`98${digits.slice(1)}`);
  return [...keys];
}

function phonesOverlap(query, haystack) {
  const qKeys = phoneKeys(query);
  const hKeys = phoneKeys(haystack);
  if (!qKeys.length || !hKeys.length) return false;
  for (const q of qKeys) {
    for (const h of hKeys) {
      if (q === h) return true;
      if (q.length >= 7 && h.includes(q)) return true;
      if (h.length >= 7 && q.includes(h)) return true;
    }
  }
  return false;
}

function scorePerson(row, query, blob) {
  let score = scoreText(blob, query);
  const h = compact(blob);
  const q = compact(query);
  const qDigits = digitKey(query);
  const tokens = searchTokens(query);

  if (!score && tokens.length && h) {
    const fuzzy = tokens.every(
      (token) =>
        h.includes(token) ||
        (token.length >= 4 && h.includes(token.slice(0, -1)))
    );
    if (fuzzy) score = 40;
  }

  const bale = compact(row?.baleId || "");
  if (bale && q) {
    if (bale === q) return 200;
    if (bale.startsWith(q) || (q.length >= 3 && bale.includes(q))) {
      score = Math.max(score, 140);
    }
  }
  if (qDigits && bale && bale.includes(qDigits)) score = Math.max(score, 140);

  if (phonesOverlap(query, blob)) {
    score = Math.max(score, qDigits.length >= 7 ? 160 : 100);
  }

  const nid = compact(row?.ownedTenant?.nationalId || "");
  if (nid && q && (nid === q || nid.includes(q))) score = Math.max(score, 150);

  const codes = (row?.orders || [])
    .map((order) => compact(order.trackingCode || ""))
    .filter(Boolean);
  if (q && codes.some((code) => code === q || code.includes(q) || q.includes(code))) {
    score = Math.max(score, 170);
  }

  return score;
}

module.exports = {
  foldDigits,
  normalizeFa,
  compact,
  primaryTokens,
  searchTokens,
  sqlCompact,
  buildAndLikes,
  scoreText,
  scoreCatalogItem,
  digitKey,
  phoneKeys,
  phonesOverlap,
  scorePerson,
};
