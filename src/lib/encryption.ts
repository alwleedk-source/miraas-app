/**
 * AES-256-GCM Encryption for sensitive data (API keys, tokens)
 * Uses a server-side secret key from environment
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_KEY required in production — refusing to operate");
    }
    console.warn("⚠️ ENCRYPTION_KEY not set — using dev fallback");
    return Buffer.from("0".repeat(64), "hex");
  }
  const buf = Buffer.from(key, "hex");
  if (buf.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  }
  return buf;
}

/**
 * تشفير نص مع ربط AAD (Associated Data) — يمنع swap attack عبر tenants
 * الناتج: iv:tag:encryptedData (hex encoded)
 * @param aad — سلسلة تحدد السياق (مثلاً `whatsapp:${tenantId}`). يجب تمرير نفس القيمة في decrypt.
 */
export function encrypt(plainText: string, aad: string): string {
  if (!aad) throw new Error("AAD required for encryption");
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));

  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

/**
 * فك تشفير نص — يجب تمرير نفس AAD المُستخدَم عند التشفير
 */
export function decrypt(encryptedText: string, aad: string): string {
  if (!aad) throw new Error("AAD required for decryption");
  const key = getEncryptionKey();
  const parts = encryptedText.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format");
  }

  const [ivHex, tagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
