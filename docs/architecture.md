# Architecture Decisions — Meras CRM

> هذا ملف **قرارات** لا توثيق ميزات. يحفظ السياق وراء الخيارات المعمارية الأساسية.
> اقرأه قبل أي تغيير في طبقة DB أو نموذج المستأجرين.

---

## ADR-001: Multi-tenancy عبر Shared DB + tenant_id (لا DB-per-tenant)

### القرار
كل المستأجرين يتشاركون نفس Postgres database و schema. كل جدول له عمود `tenant_id` يفصل البيانات.

### السياق
- المرحلة الحالية: <50 مستأجر، حجم بيانات صغير-متوسط
- لا متطلب compliance (HIPAA/GDPR strict isolation)
- مطوّر واحد، operations محدودة

### البدائل المعتبرة
1. **Database-per-tenant** — رُفض لتعقيد operations + تكلفة Postgres connections
2. **Schema-per-tenant** — رُفض لنفس السبب لكن بدرجة أقل (سيكون middle-ground مستقبلاً)
3. **Shared DB + tenant_id** ✅ — الخيار الحالي

### النتائج
- ✅ تشغيل بسيط (db واحد، migration واحد، backup واحد)
- ✅ تحليلات عابرة ممكنة (لو احتجناها)
- ⚠️ **يفرض بصرامة**: كل query يجب أن تحوي `tenant_id` filter
- ⚠️ خطر cross-tenant leak لو نسي مطوّر — مُخفّف بـ tenant-guards.ts + RBAC tests

### متى نراجع؟
- وصل لـ 50+ مستأجر دافع نشط
- عميل enterprise (>50K SAR/سنة) يطلب عزلاً مادياً
- متطلب قانوني/تنظيمي

---

## ADR-002: الأنماط الإلزامية للحفاظ على عزل المستأجر

### كل query يجب أن:

```ts
// ✅ صحيح
await db.select()
  .from(leads)
  .where(eq(leads.tenantId, tenantId));

// ❌ خطأ — leak محتمل عبر tenants
await db.select().from(leads);
```

### كل FK مُمرَّر من client يجب أن يُتحقَّق منه:

```ts
// ✅ صحيح
await assertLeadInTenant(input.leadId, tenantId);
await db.update(leads).set(...).where(eq(leads.id, input.leadId));

// ❌ خطأ — IDOR vulnerability
await db.update(leads).set(...).where(eq(leads.id, input.leadId));
```

### كل WRITE action يجب أن يحوي role check:

```ts
const { tenantId, role } = await requireTenant();
assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);  // ← إلزامي
```

### كل READ action حساس يحتاج role check:

```ts
const { tenantId, role } = await requireTenant();
assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);  // ← يمنع PROVIDER من قراءة leads مثلاً
```

### الدفاع متعدّد الطبقات:
1. **Application layer**: `requireTenant` + `assertRole` + `assert*InTenant`
2. **DB layer**: EXCLUDE constraint بـ `tenant_id WITH =` (للحجوزات)
3. **Encryption layer**: AAD يربط السر بـ `tenant_id` (لا swap attack)
4. **Test layer**: `rbac-coverage.test.ts` يفشل البناء لو action جديد بدون حماية

---

## ADR-003: الاستعداد لمسار Migration المستقبلي

### إذا قُرّر يوماً الانتقال لـ db-per-tenant:

**الخطوة 1: تحضير (جاهز لكن غير مفعّل)**
- ⚠️ `tenant-context.ts` موجود (AsyncLocalStorage layer) لكنه **غير موصول**: لا يوجد أيّ مستدعٍ لـ `withTenantContext` خارج ملفه. هو بنية مُعدّة للمستقبل فقط ولا يقدّم أيّ عزل فعلي اليوم — العزل الحالي مفروض يدوياً عبر `tenantId` filter في كل query + اختبارات RBAC.
- ✅ كل query تحوي tenantId scoping (مفروض بـ test)
- ✅ لا cross-tenant queries في الكود

**الخطوة 2: Schema-per-tenant (intermediate)**
- أنشئ schema لكل tenant: `tenant_<id>.leads`, `tenant_<id>.users`...
- Postgres واحد، db واحد، schemas منفصلة
- Connection يُحدّد search_path لكل request
- **أسهل بكثير من db-per-tenant** ولكن يمنح عزلاً قوياً
- نُحدّث `getDb()` ليُغيّر search_path بدل الـ connection

**الخطوة 3: Database-per-tenant (لو ضروري)**
- bucket مستأجرين على Postgres instances منفصلة
- "Control DB" يحفظ tenant_id → connection_string mapping
- `getDb()` يقرأ من control DB ويُرجع pool مناسب
- يتطلب orchestration tool (Coolify يحتاج إعداد custom)

### الخطوة المستقبلية الأهم:
**لا تكتب أيّ query عابرة للمستأجرين أبداً.** هذه الـ regression الوحيدة التي تجعل الـ migration مستحيلاً.

---

## ADR-004: Encryption Strategy

### القرار
- API keys (WhatsApp, إلخ): AES-256-GCM مع AAD
- AAD = `whatsapp:${tenantId}` — يربط السر بـ tenant
- Backup secret: plaintext في tenants.settings (المخاطرة محدودة لأنه shared secret لـ Apps Script)
- Webhook secrets: bcrypt hash (لا يمكن استرجاعها بعد الإنشاء)

### السبب
AAD يمنع swap attack: لو attacker سرق encrypted blob من tenant A وحاول لصقه في tenant B، فك التشفير يفشل لأن AAD مختلف.

---

## ADR-005: Reminders + Cron Strategy

### القرار
- WhatsApp reminders تُرسَل عبر cron-job.org → `/api/cron/booking-reminders`
- مرتين يومياً: 8 مساءً (للغد) + 8 صباحاً (لليوم)
- Idempotency عبر activityLog dedup check
- Time zone: الرياض (UTC+3) صراحةً في كل حساب

### البدائل المرفوضة
- Web Push notifications: عميل واحد، complexity كبيرة
- Background jobs (BullMQ/queues): overkill لـ <1000 رسالة يومياً

---

## علامات تحذير 🚨

إذا رأيت أي من هذه في PR، توقّف وفكّر:

1. `db.select().from(leads)` بدون `.where()` → خطر cross-tenant leak
2. `eq(leads.id, leadId)` بدون `assertLeadInTenant` قبلها → IDOR
3. action جديد بدون `assertRole` أو `requireOwnerOrAdmin` → فجوة RBAC
4. `getCurrentTenantId()` يُستدعى من webhook public route → إشارة سيئة
5. أي JOIN بين `tenants` table مباشرة → cross-tenant query
6. `process.env.DATABASE_URL` يُقرأ في أكثر من مكان → centralize في `db/index.ts`
7. الافتراض أن `tenants.status = 'SUSPENDED'` يوقف وصول المستأجر → **مُنفَّذ** في `requireTenant` (يوجّه لـ `/suspended`؛ استقبال webhook يستمر عمداً حتى لا تضيع leads أثناء الإيقاف). لا توجد واجهة إيقاف — التغيير يدوي عبر DB فقط

---

## مرجع سريع للأنماط

| الحالة | استخدم |
|--------|--------|
| read tenant-scoped | `requireTenant()` + tenant filter في query |
| write tenant-scoped | `requireTenant()` + `assertRole()` + tenant filter |
| validate FK من client | `assert*InTenant(id, tenantId)` |
| OWNER/ADMIN فقط | `assertRole(role, ROLE.OWNER_ADMIN)` |
| public route (webhook) | `tenantId` يُستنتج من webhook secret، لا session |

---

**Last review**: 2026-04-22 (ULTRATHINK audit completed — 35 bugs/improvements)
