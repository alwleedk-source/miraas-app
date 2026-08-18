import { describe, it, expect } from "vitest";
import { isAllowedBackupUrl } from "@/lib/backup-push";

// يقفل حارس SSRF: الوجهة الوحيدة المسموحة هي Google Apps Script (https + مضيف Google).
describe("isAllowedBackupUrl — SSRF guard for the backup push target", () => {
  it("accepts a Google Apps Script exec URL", () => {
    expect(
      isAllowedBackupUrl("https://script.google.com/macros/s/ABC123/exec"),
    ).toBe(true);
  });

  it("accepts the googleusercontent redirect host", () => {
    expect(
      isAllowedBackupUrl("https://script.googleusercontent.com/macros/echo?x=1"),
    ).toBe(true);
  });

  it("rejects http (non-TLS)", () => {
    expect(isAllowedBackupUrl("http://script.google.com/macros/s/x/exec")).toBe(false);
  });

  it("rejects internal / metadata hosts (SSRF)", () => {
    expect(isAllowedBackupUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isAllowedBackupUrl("https://localhost/admin")).toBe(false);
    expect(isAllowedBackupUrl("https://127.0.0.1:5432/")).toBe(false);
    expect(isAllowedBackupUrl("https://10.0.0.5/internal")).toBe(false);
  });

  it("rejects look-alike / attacker-controlled hosts", () => {
    expect(isAllowedBackupUrl("https://script.google.com.evil.com/exec")).toBe(false);
    expect(isAllowedBackupUrl("https://evil.com/script.google.com")).toBe(false);
    expect(isAllowedBackupUrl("https://notscript.google.com/exec")).toBe(false);
  });

  it("rejects empty / malformed input", () => {
    expect(isAllowedBackupUrl("")).toBe(false);
    expect(isAllowedBackupUrl(null)).toBe(false);
    expect(isAllowedBackupUrl(undefined)).toBe(false);
    expect(isAllowedBackupUrl("not a url")).toBe(false);
  });
});
