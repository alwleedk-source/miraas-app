/**
 * AES-256-GCM Encryption for sensitive data (API keys, tokens)
 * Uses a server-side secret key from environment
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * يُنظّف قيمة env من المسافات + علامات التنصيص + الـ newlines
 * (Coolify وبعض الأدوات قد تحفظ القيم مع quotes بالخطأ)
 */
function sanitizeEnvValue(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  return raw
    .trim()
    .replace(/^["']|["']$/g, "") // strip surrounding quotes
    .replace(/\s+/g, ""); // strip any internal whitespace/newlines
}

function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  const key = sanitizeEnvValue(raw);

  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_KEY required in production — refusing to operate");
    }
    console.warn("⚠️ ENCRYPTION_KEY not set — using dev fallback");
    return Buffer.from("0".repeat(64), "hex");
  }
  // المسار المفضّل: 64 hex chars = 32 bytes مباشرة.
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return Buffer.from(key, "hex");
  }
  // أي سلسلة أخرى (مثل 32 حرف ASCII): اشتقاق حتمي عبر SHA-256 بدل الرفض —
  // رفض الصيغ غير الـ hex كان يعطّل تشفير أسرار واتساب كلياً في الإنتاج.
  // لا يكسر بيانات قديمة: ما شُفّر بمفتاح 64-hex يسلك المسار الأول دائماً.
  return createHash("sha256").update(key, "utf8").digest();
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
