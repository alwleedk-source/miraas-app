import { describe, it, expect } from "vitest";
import {
  createLeadSchema,
  bulkImportSchema,
  createBookingSchema,
  inviteTeamMemberSchema,
  updateMemberRoleSchema,
  webhookEntrySchema,
} from "@/lib/schemas";

// placeholder للاختبارات فقط — ليست كلمة مرور حقيقية
// (GitGuardian/أي scanner يلاحظ: هذا test fixture)
const TEST_PW_PLACEHOLDER = "a".repeat(12);

describe("createLeadSchema", () => {
  it("accepts valid input", () => {
    const r = createLeadSchema.safeParse({ name: "أحمد", priority: "HIGH" });
    expect(r.success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(createLeadSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createLeadSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects 300-char name", () => {
    expect(createLeadSchema.safeParse({ name: "a".repeat(300) }).success).toBe(false);
  });

  it("rejects invalid UUIDs", () => {
    expect(
      createLeadSchema.safeParse({ name: "X", assignedTo: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("defaults priority to MEDIUM", () => {
    const r = createLeadSchema.parse({ name: "X" });
    expect(r.priority).toBe("MEDIUM");
  });
});

describe("bulkImportSchema", () => {
  it("accepts under 5000", () => {
    const leads = Array.from({ length: 10 }, (_, i) => ({ name: `L${i}`, phone: "0500000000" }));
    expect(bulkImportSchema.safeParse({ campaignName: "X", leads }).success).toBe(true);
  });

  it("rejects over 5000", () => {
    const leads = Array.from({ length: 5001 }, () => ({ name: "X", phone: "0500" }));
    expect(bulkImportSchema.safeParse({ campaignName: "Y", leads }).success).toBe(false);
  });
});

describe("inviteTeamMemberSchema — runtime role validation", () => {
  it("accepts allowed roles", () => {
    for (const role of ["ADMIN", "COORDINATOR", "PROVIDER"]) {
      const r = inviteTeamMemberSchema.safeParse({
        name: "X",
        email: "x@y.com",
        password: TEST_PW_PLACEHOLDER,
        role,
      });
      expect(r.success).toBe(true);
    }
  });

  it("REJECTS OWNER/SUPER_ADMIN (privilege escalation attempt)", () => {
    for (const role of ["OWNER", "SUPER_ADMIN", "HACKER"]) {
      const r = inviteTeamMemberSchema.safeParse({
        name: "X",
        email: "x@y.com",
        password: TEST_PW_PLACEHOLDER,
        role,
      });
      expect(r.success).toBe(false);
    }
  });

  it("rejects short password (<10 chars)", () => {
    const r = inviteTeamMemberSchema.safeParse({
      name: "X",
      email: "x@y.com",
      password: "x",
      role: "COORDINATOR",
    });
    expect(r.success).toBe(false);
  });

  it("lowercases email", () => {
    const r = inviteTeamMemberSchema.parse({
      name: "X",
      email: "X@Y.COM",
      password: TEST_PW_PLACEHOLDER,
      role: "ADMIN",
    });
    expect(r.email).toBe("x@y.com");
  });
});

describe("updateMemberRoleSchema", () => {
  it("REJECTS promoting to OWNER", () => {
    expect(
      updateMemberRoleSchema.safeParse({
        memberId: "11111111-1111-4111-8111-111111111111",
        newRole: "OWNER",
      }).success,
    ).toBe(false);
  });
});

describe("createBookingSchema — date validation", () => {
  it("accepts reasonable future date", () => {
    const next = new Date(Date.now() + 86400000).toISOString();
    const r = createBookingSchema.safeParse({
      leadId: "11111111-1111-4111-8111-111111111111",
      bookingDate: next,
      bookingService: "consultation",
    });
    expect(r.success).toBe(true);
  });

  it("rejects unreasonable date (year 3000)", () => {
    const r = createBookingSchema.safeParse({
      leadId: "11111111-1111-4111-8111-111111111111",
      bookingDate: "3000-01-01T10:00:00Z",
      bookingService: "x",
    });
    expect(r.success).toBe(false);
  });

  it("rejects garbage date string", () => {
    const r = createBookingSchema.safeParse({
      leadId: "11111111-1111-4111-8111-111111111111",
      bookingDate: "not-a-date",
      bookingService: "x",
    });
    expect(r.success).toBe(false);
  });
});

describe("webhookEntrySchema", () => {
  it("accepts minimal entry", () => {
    expect(
      webhookEntrySchema.safeParse({ name: "أحمد", phone: "0551234567" }).success,
    ).toBe(true);
  });

  it("rejects missing phone", () => {
    expect(webhookEntrySchema.safeParse({ name: "X" }).success).toBe(false);
  });

  it("rejects short phone", () => {
    expect(webhookEntrySchema.safeParse({ name: "X", phone: "12" }).success).toBe(false);
  });

  it("ignores joinedAt (server controls createdAt)", () => {
    const r = webhookEntrySchema.parse({
      name: "X",
      phone: "0551234567",
      joinedAt: "1970-01-01",
    });
    expect("joinedAt" in r).toBe(false);
  });
});
