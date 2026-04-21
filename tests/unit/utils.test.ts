import { describe, it, expect } from "vitest";
import {
  validateAndNormalizePhone,
  toWhatsappUrl,
  toTelUrl,
  generateSlug,
  generateSecretKey,
} from "@/lib/utils";

describe("phone normalization", () => {
  it("normalizes Saudi 05 numbers to +966", () => {
    const r = validateAndNormalizePhone("0551234567");
    expect(r.valid).toBe(true);
    expect(r.phone).toBe("+966551234567");
    expect(r.country).toBe("SA");
  });

  it("accepts already international +971", () => {
    const r = validateAndNormalizePhone("+971501234567");
    expect(r.valid).toBe(true);
    expect(r.country).toBe("AE");
  });

  it("rejects too-short", () => {
    expect(validateAndNormalizePhone("123").valid).toBe(false);
  });

  it("rejects repeated digit pattern", () => {
    expect(validateAndNormalizePhone("1111111111").valid).toBe(false);
  });

  it("handles Arabic-Indic digits", () => {
    const r = validateAndNormalizePhone("٠٥٥١٢٣٤٥٦٧");
    expect(r.valid).toBe(true);
    expect(r.phone).toBe("+966551234567");
  });
});

describe("WhatsApp URL builder", () => {
  it("strips + and returns wa.me link", () => {
    expect(toWhatsappUrl("+966551234567")).toBe("https://wa.me/966551234567");
  });

  it("rejects query injection attempts", () => {
    // phone contains ?text=spam — helper يحذف كل غير-digit فيبقى "5551234" فقط
    expect(toWhatsappUrl("5551234?text=phishing")).toBe("https://wa.me/5551234");
  });

  it("returns null for empty/short", () => {
    expect(toWhatsappUrl(null)).toBeNull();
    expect(toWhatsappUrl("12")).toBeNull();
    expect(toWhatsappUrl("")).toBeNull();
  });
});

describe("tel URL builder", () => {
  it("preserves + for international", () => {
    expect(toTelUrl("+966551234567")).toBe("tel:+966551234567");
  });

  it("strips non-digits", () => {
    expect(toTelUrl("(055) 123-4567")).toBe("tel:0551234567");
  });

  it("rejects empty", () => {
    expect(toTelUrl(null)).toBeNull();
  });
});

describe("slug generation", () => {
  it("supports Arabic names", () => {
    const s = generateSlug("مركز نوران الطبي");
    expect(s.length).toBeGreaterThan(0);
    expect(s).toMatch(/[ء-ي]/);
  });

  it("handles empty/symbols with fallback", () => {
    const s = generateSlug("!@#$%");
    expect(s.length).toBeGreaterThan(0); // fallback UUID-like
  });

  it("replaces spaces with dashes", () => {
    expect(generateSlug("my company name")).toBe("my-company-name");
  });
});

describe("secret key generator", () => {
  it("produces cryptographically distinct values", () => {
    const keys = new Set();
    for (let i = 0; i < 100; i++) keys.add(generateSecretKey());
    expect(keys.size).toBe(100); // كلها فريدة
  });

  it("length is reasonable", () => {
    const k = generateSecretKey();
    expect(k.length).toBeGreaterThan(40);
  });
});
