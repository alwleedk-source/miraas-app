import { describe, it, expect } from "vitest";
import { hashSecret, verifySecret, secretPrefix } from "@/lib/secret-hash";

describe("secret-hash", () => {
  it("hashSecret produces different hash each time (salt)", async () => {
    const h1 = await hashSecret("test-secret-12345");
    const h2 = await hashSecret("test-secret-12345");
    expect(h1).not.toBe(h2);
    expect(h1.startsWith("scrypt$")).toBe(true);
  });

  it("verifySecret accepts correct secret", async () => {
    const secret = "super-secret-webhook-key-abc123";
    const hash = await hashSecret(secret);
    expect(await verifySecret(secret, hash)).toBe(true);
  });

  it("verifySecret rejects wrong secret", async () => {
    const hash = await hashSecret("correct-secret");
    expect(await verifySecret("wrong-secret", hash)).toBe(false);
  });

  it("verifySecret is safe against malformed hash", async () => {
    expect(await verifySecret("anything", "not-a-hash")).toBe(false);
    expect(await verifySecret("anything", "")).toBe(false);
    expect(await verifySecret("anything", "scrypt$broken")).toBe(false);
  });

  it("secretPrefix takes first 12 chars", () => {
    expect(secretPrefix("abcdefghijklmnopqrstuv")).toBe("abcdefghijkl");
    expect(secretPrefix("short")).toBe("short");
  });
});
