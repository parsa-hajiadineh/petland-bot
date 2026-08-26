const crypto = require("crypto");
const { BOT_TOKEN, BOT_TOKEN_ENCRYPTION_KEY } = require("../config");

function getKey() {
  const secret = BOT_TOKEN_ENCRYPTION_KEY || BOT_TOKEN || "";
  return crypto.createHash("sha256").update(secret).digest();
}

function hashToken(plain) {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

function encryptToken(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptToken(payload) {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8"
  );
}

module.exports = {
  hashToken,
  encryptToken,
  decryptToken,
};
