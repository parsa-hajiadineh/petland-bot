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

function sqlCompact(expr) {
  return `replace(replace(replace(replace(replace(replace(replace(replace(
    lower(coalesce(${expr}, '')),
    'ي', 'ی'), 'ى', 'ی'), 'ك', 'ک'), 'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا'), chr(8204), ''), ' ', '')`;
}

function buildAndLikes(blobSql, query) {
  const parts = primaryTokens(query);
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
  if (!h || !q) return 0;
  if (h === q) return 100;
  if (h.startsWith(q)) return 85;
  if (h.includes(q)) return 70;
  let score = 0;
  for (const part of primaryTokens(query)) {
    const c = compact(part);
    if (c && h.includes(c)) score += c.length >= 3 ? 18 : 10;
  }
  return score;
}

module.exports = {
  foldDigits,
  normalizeFa,
  compact,
  primaryTokens,
  sqlCompact,
  buildAndLikes,
  scoreText,
};
