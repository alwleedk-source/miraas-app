import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "@/lib/encryption";

describe("encryption with AAD", () => {
  it("roundtrip works with same AAD", () => {
    const plain = "my-api-key-abc123";
    const aad = "whatsapp:tenant-xyz";
    const enc = encrypt(plain, aad);
    expect(decrypt(enc, aad)).toBe(plain);
  });

  it("decrypt fails with wrong AAD (swap attack blocked)", () => {
    const enc = encrypt("secret", "whatsapp:tenant-A");
    expect(() => decrypt(enc, "whatsapp:tenant-B")).toThrow();
  });

  it("decrypt fails with corrupted ciphertext", () => {
    const enc = encrypt("secret", "ctx");
    const [iv, tag, data] = enc.split(":");
    const corrupted = `${iv}:${tag}:${data.slice(0, -2)}ff`;
    expect(() => decrypt(corrupted, "ctx")).toThrow();
  });

  it("requires AAD", () => {
    expect(() => encrypt("x", "")).toThrow();
    expect(() => decrypt("a:b:c", "")).toThrow();
  });
});
