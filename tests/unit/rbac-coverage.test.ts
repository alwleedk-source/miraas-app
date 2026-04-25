/**
 * RBAC Coverage Test — يفحص أن كل server action فيها role check
 *
 * بدلاً من integration tests معقّدة بـ DB، هذا الـ test يقرأ كل ملف
 * actions ويتحقّق ستاتيكياً أن:
 *   - كل function تستدعي requireTenant أو getSession
 *   - كل WRITE function (تحوي insert/update/delete) فيها assertRole
 *     أو requireOwnerOrAdmin
 *
 * يكتشف REGRESSION عند إضافة action جديد بدون حماية.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ACTIONS_DIRS = ["src/app/actions", "src/actions"];

// Actions مستثناة بسبب طبيعتها (لا تحتاج role/tenant)
const EXEMPTIONS = new Set([
  "logClientError", // أي مستخدم authenticated يستطيع إبلاغ عن client error
  "createTenantForUser", // قبل وجود tenant — fresh signup
  "generateBackupSecret", // utility — له role check ضمن
  // notifications: per-user scope (لا role ضروري)
  "getNotifications",
  "getUnreadCount",
  "markAsRead",
  "markAllAsRead",
  // provider: يستخدم role check يدوي صريح (if role !== 'PROVIDER')
  "getProviderBookings",
  "getProviderDashboard",
  "updateProviderBookingStatus",
  "addProviderSessionNote",
  "sendQuickMessage",
  "getUnreadMessagesForCoordinator",
  "markMessagesAsRead",
  // get* functions في departments تستخدم requireTenant فقط (read-only)
  "getDepartments",
  "getDepartmentProviders",
  "getAllProviders",
  "getProviderSchedule",
  "getProviderDayOffs",
  // get* في bookings/leads/archive تستخدم if (role === "PROVIDER") return [];
  "getLeads",
  "getAgingLeads",
  "getAgingLeadsCount",
  "getArchivedLeads",
  "getArchiveStats",
  // settings.ts: يستخدم requireOwnerOrAdmin (نمط بديل)
  "getTenantSettings",
  "getWebhookKeys",
  "getWhatsappConfig",
  // per-user WhatsApp creds: المنسق يدير اعتماده الخاص (requireTenant + targetUserId logic)
  // OWNER/ADMIN يدير منسقاً آخر عبر targetUserId — التحقّق الصريح داخل الـ action
  "getMyWhatsappCredentials",
  "saveMyWhatsappCredentials",
  "saveMyWhatsappApiKey",
  "testMyWhatsappCredentialsAction",
  "deleteMyWhatsappCredentials",
]);

// regex to find exported async functions
const EXPORT_RE = /^export\s+async\s+function\s+(\w+)/gm;

function listActionFiles(): string[] {
  const files: string[] = [];
  for (const dir of ACTIONS_DIRS) {
    try {
      const entries = readdirSync(dir);
      for (const f of entries) {
        if (f.endsWith(".ts") && !f.endsWith(".d.ts")) {
          files.push(join(dir, f));
        }
      }
    } catch {
      // dir doesn't exist, skip
    }
  }
  return files;
}

function isWriteFunction(body: string): boolean {
  // function body فيها insert/update/delete = write
  return (
    /\.(insert|update|delete)\(/.test(body) ||
    /db\.transaction/.test(body)
  );
}

/**
 * يستخرج جسم function بسيطاً — يبدأ من الإعلان وينتهي عند next `^export` أو EOF
 * بدلاً من brace counting (يكسر مع destructuring في params).
 */
function getFunctionBody(content: string, fnName: string): string {
  const startRegex = new RegExp(`export\\s+async\\s+function\\s+${fnName}\\b`);
  const match = startRegex.exec(content);
  if (!match) return "";
  const start = match.index;
  // ابحث عن next "export" أو "^// ===" (separator pattern في هذا الـ codebase)
  const remaining = content.slice(start + match[0].length);
  const nextExport = remaining.search(/\nexport\s+(async\s+)?function\s+\w+/);
  if (nextExport === -1) return content.slice(start);
  return content.slice(start, start + match[0].length + nextExport);
}

describe("RBAC Coverage", () => {
  const files = listActionFiles();

  it("يجد ملفات actions", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const fnNames: string[] = [];
    let m: RegExpExecArray | null;
    EXPORT_RE.lastIndex = 0;
    while ((m = EXPORT_RE.exec(content))) {
      fnNames.push(m[1]);
    }

    for (const fnName of fnNames) {
      if (EXEMPTIONS.has(fnName)) continue;
      const body = getFunctionBody(content, fnName);

      it(`${file.split("/").pop()}::${fnName} — لها tenant scope`, () => {
        const hasTenantGuard =
          body.includes("requireTenant") ||
          body.includes("requireOwnerOrAdmin") ||
          body.includes("getTenantId") ||
          body.includes("getSession") ||
          body.includes("getContext");
        expect(hasTenantGuard, `${fnName} يفتقد tenant scoping`).toBe(true);
      });

      // فقط الـ writes تحتاج role check
      if (isWriteFunction(body)) {
        it(`${file.split("/").pop()}::${fnName} — write فيها role check`, () => {
          const hasRoleCheck =
            body.includes("assertRole") ||
            body.includes("requireOwnerOrAdmin") ||
            /role\s*===?\s*"PROVIDER"/.test(body) ||
            /role\s*!==?\s*"PROVIDER"/.test(body);
          expect(hasRoleCheck, `${fnName} يكتب لـ DB بدون role check`).toBe(true);
        });
      }
    }
  }
});
