/**
 * AES-256-GCM Encryption for sensitive data (API keys, tokens)
 * Uses a server-side secret key from environment
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    // في بيئة التطوير — استخدم مفتاح ثابت (لا تفعل هذا في الإنتاج!)
    console.warn("⚠️ ENCRYPTION_KEY not set — using fallback (dev only)");
    return Buffer.from("0".repeat(64), "hex"); // 32 bytes
  }
  return Buffer.from(key, "hex");
}

/**
 * تشفير نص
 * الناتج: iv:tag:encryptedData (hex encoded)
 */
export function encrypt(plainText: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag();

  // iv:tag:encrypted
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

/**
 * فك تشفير نص
 * المدخل: iv:tag:encryptedData (hex encoded)
 */
export function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();
  const parts = encryptedText.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format");
  }

  const [ivHex, tagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
