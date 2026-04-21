/**
 * Secret hashing للـ webhook secrets — صفر dependencies (Node crypto scrypt)
 *
 * لماذا scrypt وليس bcrypt:
 *   - مدمج في Node، لا حاجة لحزمة
 *   - resistant لـ GPU brute force (memory-hard)
 *   - كافٍ تماماً للـ webhook secrets (ليست passwords قصيرة)
 *
 * الصيغة: "scrypt$N$r$p$salt(hex)$hash(hex)"
 */

import { scrypt, randomBytes, timingSafeEqual, type ScryptOptions } from "crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;

function scryptP(
  password: string,
  salt: Buffer,
  keyLen: number,
  opts: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, opts, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

export async function hashSecret(plaintext: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptP(plaintext, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifySecret(plaintext: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const N = parseInt(parts[1], 10);
    const r = parseInt(parts[2], 10);
    const p = parseInt(parts[3], 10);
    const salt = Buffer.from(parts[4], "hex");
    const expected = Buffer.from(parts[5], "hex");

    const derived = await scryptP(plaintext, salt, expected.length, { N, r, p });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** أول 12 حرفاً — للبحث السريع في DB قبل scrypt compare */
export function secretPrefix(plaintext: string): string {
  return plaintext.slice(0, 12);
}
