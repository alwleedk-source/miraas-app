/**
 * pre-migration-audit.ts
 *
 * يفحص DB قبل تطبيق migration 0002_hardening_indexes_and_constraints.sql
 * يطبع:
 *   - users بلا tenantId (قد تمنع migration مستقبلية لـ NOT NULL)
 *   - تكرارات ستمنع UNIQUE constraints
 *
 * الاستخدام:
 *   DATABASE_URL=... npx tsx scripts/pre-migration-audit.ts
 */

import postgres from "postgres";

async function audit() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ DATABASE_URL not set");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  let hasIssues = false;

  const section = (title: string) => console.log(`\n━━ ${title} ━━`);
  const ok = (msg: string) => console.log(`  ✅ ${msg}`);
  const warn = (msg: string) => {
    console.log(`  ⚠️  ${msg}`);
    hasIssues = true;
  };

  try {
    section("1. Users بلا tenantId");
    const orphans = await sql<{ id: string; email: string; role: string }[]>`
      SELECT id, email, role FROM users WHERE tenant_id IS NULL
    `;
    if (orphans.length === 0) ok("لا users أيتام");
    else {
      warn(`${orphans.length} users بلا tenantId:`);
      for (const u of orphans) console.log(`       ${u.email} (${u.role})`);
      console.log(`       → احذفهم أو ألحقهم بـ tenant قبل تطبيق NOT NULL`);
    }

    section("2. تكرارات pipeline_stages(tenant_id, name)");
    const dupStages = await sql<{ tenant_id: string; name: string; c: string }[]>`
      SELECT tenant_id, name, COUNT(*)::text as c FROM pipeline_stages
      GROUP BY tenant_id, name HAVING COUNT(*) > 1
    `;
    if (dupStages.length === 0) ok("لا تكرارات");
    else {
      warn(`${dupStages.length} تكرار:`);
      for (const d of dupStages) console.log(`       tenant=${d.tenant_id} name="${d.name}" (${d.c})`);
    }

    section("3. تكرارات departments(tenant_id, name)");
    const dupDepts = await sql<{ tenant_id: string; name: string; c: string }[]>`
      SELECT tenant_id, name, COUNT(*)::text as c FROM departments
      GROUP BY tenant_id, name HAVING COUNT(*) > 1
    `;
    if (dupDepts.length === 0) ok("لا تكرارات");
    else {
      warn(`${dupDepts.length} تكرار:`);
      for (const d of dupDepts) console.log(`       tenant=${d.tenant_id} name="${d.name}" (${d.c})`);
    }

    section("4. تكرارات tags(tenant_id, name)");
    const dupTags = await sql<{ tenant_id: string; name: string; c: string }[]>`
      SELECT tenant_id, name, COUNT(*)::text as c FROM tags
      GROUP BY tenant_id, name HAVING COUNT(*) > 1
    `;
    if (dupTags.length === 0) ok("لا تكرارات");
    else warn(`${dupTags.length} تكرار — راجع`);

    section("5. تكرارات tag_assignments(lead_id, tag_id)");
    const dupAssigns = await sql<{ lead_id: string; tag_id: string; c: string }[]>`
      SELECT lead_id, tag_id, COUNT(*)::text as c FROM tag_assignments
      GROUP BY lead_id, tag_id HAVING COUNT(*) > 1
    `;
    if (dupAssigns.length === 0) ok("لا تكرارات");
    else warn(`${dupAssigns.length} تكرار — سيفشل unique constraint`);

    section("6. تكرارات department_providers(department_id, user_id)");
    const dupDeptProvs = await sql<{ department_id: string; user_id: string; c: string }[]>`
      SELECT department_id, user_id, COUNT(*)::text as c FROM department_providers
      GROUP BY department_id, user_id HAVING COUNT(*) > 1
    `;
    if (dupDeptProvs.length === 0) ok("لا تكرارات");
    else warn(`${dupDeptProvs.length} تكرار`);

    section("7. تكرارات provider_schedules(user_id, day_of_week)");
    const dupSchedules = await sql<{ user_id: string; day_of_week: number; c: string }[]>`
      SELECT user_id, day_of_week, COUNT(*)::text as c FROM provider_schedules
      GROUP BY user_id, day_of_week HAVING COUNT(*) > 1
    `;
    if (dupSchedules.length === 0) ok("لا تكرارات");
    else warn(`${dupSchedules.length} تكرار — user له جدولين لنفس اليوم`);

    section("8. Leads بـ assignedTo يشير لـ user من tenant آخر (cross-tenant corruption)");
    const crossLeads = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text as count FROM leads l
      INNER JOIN users u ON l.assigned_to = u.id
      WHERE u.tenant_id IS DISTINCT FROM l.tenant_id AND l.assigned_to IS NOT NULL
    `;
    if (Number(crossLeads[0]?.count ?? 0) === 0) ok("لا تلوث عبر tenants");
    else warn(`${crossLeads[0].count} lead assignedTo من tenant آخر — يحتاج تنظيف يدوي`);

    section("\nالخلاصة");
    if (!hasIssues) {
      console.log("✅ كل شيء نظيف — آمن تطبيق migration");
      process.exit(0);
    } else {
      console.log("⚠️  هناك مشاكل تحتاج حل قبل migration. راجع الأعلى.");
      process.exit(1);
    }
  } catch (e) {
    console.error("❌ Audit failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

audit();
