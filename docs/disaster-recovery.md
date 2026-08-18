# Disaster Recovery Runbook — Meras CRM

> ماذا تفعل عندما يحدث الأسوأ. اقرأ هذا قبل الحادث، لا أثناءه.

---

## السيناريو 1: قاعدة البيانات تعطّلت كلياً

### الأعراض
- `https://miraas.app/api/health` يُرجع `degraded` أو 500
- كل صفحة تعرض خطأ
- Coolify logs تظهر `connection refused` أو `database does not exist`

### الإجراء (5 دقائق)
```bash
# 1. تحقّق من حالة Postgres container في Coolify
ssh root@server-ip
docker ps | grep postgres
# لو متوقف:
docker start <postgres-container-name>

# 2. تحقّق من السجلات
docker logs <postgres-container-name> --tail 100

# 3. لو DB corrupted، استعد من آخر backup
# (راجع السيناريو 3)

# 4. تأكد من /api/health
curl https://miraas.app/api/health
```

---

## السيناريو 2: Coolify كله تعطّل (الخادم سقط)

### الإجراء (30-60 دقيقة)
1. **لا تذعر** — لكن كن واقعياً: النسخ الحالية **داخلية فقط** (Coolify على نفس الخادم)، يضاف إليها لقطات leads شبه اللحظية المدفوعة إلى Google Sheet كل عميل عبر `backup-push`. لو الخادم ضاع كلياً ضاعت معه النسخ الداخلية، وتبقى بيانات leads الأساسية قابلة للاسترجاع من Sheets العملاء. النسخ الخارجي (Backblaze B2) **TODO مطلوب قبل الإنتاج الحقيقي** — راجع قسم «واقع النسخ الاحتياطي» أسفل.
2. أنشئ خادم جديد (Hetzner/DigitalOcean) — Ubuntu 22.04
3. ثبّت Coolify الجديد:
   ```bash
   curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
   ```
4. ادخل Coolify Dashboard الجديد → أنشئ project + Postgres
5. استعد من backup (راجع السيناريو 3)
6. غيّر DNS لـ miraas.app إلى IP الخادم الجديد
7. أعد deploy من GitHub

**RTO هدف**: ساعتان (Recovery Time Objective)
**RPO واقعي حالياً**: حتى 24 ساعة (نسخ Coolify اليومية الداخلية)؛ وبيانات leads شبه لحظية عبر Google Sheets العملاء. الهدف بعد إنجاز النسخ الخارجي: <12 ساعة مع نسخة محفوظة خارج الخادم.

---

## السيناريو 3: استعادة من Backup

### إذا backup في Coolify (داخلي)
```bash
# 1. ادخل Coolify → DB → Backups → اختر آخر backup ناجح
# 2. اضغط "Restore" — Coolify يُنفّذ pg_restore تلقائياً
# 3. بعد الانتهاء، أعد تشغيل التطبيق
```

### إذا backup خارجي (Backblaze B2) — ⚠️ TODO: غير مُفعَّل بعد

> **لا يوجد حالياً أي نسخة خارج الخادم.** الخطوات أدناه موثّقة مسبقاً لتصبح
> جاهزة فور إعداد B2، وهي **مطلوبة قبل الإنتاج الحقيقي** (خادم واحد = نقطة فشل واحدة).

```bash
# 1. نزّل الـ backup من Backblaze
b2 file download b2://meras-backups/2026-04-22.sql.gz ./backup.sql.gz

# 2. فكّ الضغط
gunzip backup.sql.gz

# 3. استعد إلى Postgres جديد
docker exec -i <postgres-container> psql -U USER -d DBNAME < backup.sql

# 4. تحقّق
docker exec <postgres-container> psql -U USER -d DBNAME -c "SELECT COUNT(*) FROM tenants;"
```

### ⚠️ اختبر Restore مرة واحدة على الأقل!
- Backup غير مُختبَر = لا backup
- جرّب الاستعادة على خادم staging
- وثّق الوقت المُستغرَق

---

## السيناريو 4: Migration فشل في النصف

### الأعراض
- بعد deploy، التطبيق لا يبدأ
- Coolify logs تظهر `migration X failed`
- بعض الجداول جديدة، بعض القديمة

### الإجراء
```bash
# ⚠️ المُهاجر المخصص (scripts/migrate.mjs) لا يكتب journal —
#    لا يوجد جدول drizzle.__drizzle_migrations للاستعلام عنه.

# 1. حدّد آخر migration نجح من سجل الإقلاع في Coolify logs:
#    المُهاجر يطبع ✅/⏭️/❌ لكل عبارة مع اسم الملف، فآخر ❌ هو موضع الفشل.

# 2. قارن حالة DB يدوياً بملفات drizzle/migrations/*.sql:
docker exec <postgres-container> psql -U USER -d DBNAME -c "\dt"
docker exec <postgres-container> psql -U USER -d DBNAME -c "\d+ leads"

# 3. لو migration جزئية، rollback يدوي:
#    افحص drizzle/migrations/XXXX_*.sql واعكس الـ ALTER/CREATE statements.
#    أو أصلح السبب الجذري ثم أعد التشغيل — إعادة التطبيق آمنة لأن العبارات
#    idempotent (IF NOT EXISTS + المُهاجر يتجاهل أخطاء already exists/duplicate).

# 4. أعد deploy
```

**درس مستفاد**: راجع كل migration قبل تطبيقه على production.

---

## السيناريو 5: مستأجر طلب حذف بياناته (GDPR)

### الإجراء
```sql
-- 1. سجّل الطلب (action يجب أن تكون قيمة صالحة من activity_action enum)
INSERT INTO activity_log (tenant_id, action, entity_type, details)
VALUES ('<tenant_id>', 'SETTINGS_UPDATED', 'tenant', '{"reason": "GDPR deletion request"}');

-- 2. (قبل الحذف) نظّف verifications — جدول better-auth بلا tenant_id ولا FK،
--    مفتاحه البريد الإلكتروني، فلا يتتالى مع tenants:
DELETE FROM verifications
WHERE identifier IN (SELECT email FROM users WHERE tenant_id = '<tenant_id>');

-- 3. الحذف الرئيسي — لا حاجة لقائمة جداول يدوية:
--    كل جدول له tenant_id في schema.ts مربوط بـ FK ON DELETE CASCADE،
--    والجداول الوسيطة بلا tenant_id (sessions, accounts, tag_assignments,
--    webhook_coordinators, department_providers) تتتالى عبر آبائها.
--    سجل الطلب من الخطوة 1 يتتالى هو أيضاً مع activity_log.
--    (rate_limits لا يحوي بيانات مستأجر — مفاتيحه webhook:<id> فقط.)
BEGIN;
DELETE FROM tenants WHERE id = '<tenant_id>';
COMMIT;

-- 4. Google Sheet الخاص بالعميل ملكٌ له — أبلغه أن يحذفه بنفسه (أو احذف
--    النسخة المدفوعة إن كنت تديرها). لا توجد نسخ خارجية أخرى حالياً (B2 TODO).
-- 5. أبلغ المستأجر بالاكتمال
```

> 💡 ملاحظة: في db-per-tenant المستقبلي، هذه عملية واحدة (`DROP DATABASE tenant_x`).

---

## السيناريو 6: WhatsApp quota انتهت / API token مُلغى

### الأعراض
- التذكيرات لا تصل
- `/settings/errors` يُظهر `WHATSAPP_FAILED` كثير
- Meta dashboard يُظهر `Auth error`

### الإجراء
1. ادخل [Meta Business Manager](https://business.facebook.com)
2. WhatsApp → API Setup → جدّد Access Token
3. ادخل Meras → /settings/whatsapp → الصق Token الجديد → Save
4. اضغط "اختبار الإرسال" برقمك
5. التذكيرات ستعمل من الـ cron التالي

---

## السيناريو 7: webhook spam / DoS attack

### الأعراض
- /api/webhook/leads يستقبل آلاف الطلبات/دقيقة
- DB يبطّئ
- خادم محمّل

### الحماية الموجودة
- Rate limit: 60 request/دقيقة لكل webhook key
- Body size cap: 200KB
- Max entries per request: 100

### الإجراء الإضافي إذا الحماية الموجودة لم تكفِ
```bash
# 1. عطّل webhook المُستهدف فوراً
# Coolify → افتح DB shell → 
UPDATE webhook_endpoints SET is_active = false WHERE secret_prefix = 'PREFIX';

# 2. ادرس الـ logs لمعرفة المصدر
# 3. أنشئ webhook secret جديد + بلّغ المالك
# 4. لو هجوم متكرّر، أضف Cloudflare WAF
```

---

## واقع النسخ الاحتياطي (اقرأ قبل الاعتماد عليه)

**الموجود فعلاً اليوم:**
- نسخ Coolify الداخلية المجدولة (يومياً) — لكنها تُخزَّن **على نفس الخادم**، فلا تحمي من فقدان الخادم كاملاً.
- دفع تلقائي للقطات leads إلى Google Sheet الخاص بكل عميل عبر `backup-push` (fire-and-forget، شبه لحظي) — يغطي بيانات العملاء الأساسية فقط، لا الإعدادات ولا المستخدمين.

**غير موجود (TODO مطلوب قبل الإنتاج الحقيقي):**
- [ ] نسخة خارجية: `pg_dump` مجدول يُرفع إلى Backblaze B2 (أو ما يعادلها) مع retention واختبار restore دوري. حتى يُنجَز هذا، RPO الحقيقي لفقدان الخادم الكامل = «ما وصل إلى Google Sheets»، لا 24 ساعة.

---

## فحوصات صحية دورية

### يومياً (تلقائي)
- ✅ Backup داخلي في Coolify يجري الساعة 2 صباحاً (على نفس الخادم — راجع «واقع النسخ الاحتياطي»)
- ✅ Cleanup cron يحذف rate_limits المنتهية
- ✅ `/api/health` يُرجع OK

### أسبوعياً (يدوي — 5 دقائق)
- [ ] افحص Coolify Dashboard → آخر backup ناجح
- [ ] افحص /settings/errors → أيّ أخطاء جديدة؟
- [ ] افحص disk space على الخادم: `df -h`

### شهرياً (يدوي — 15 دقيقة)
- [ ] اختبر restore من backup على خادم staging
- [ ] راجع slow queries (Postgres logs)
- [ ] حدّث Coolify + Postgres لآخر patch
- [ ] دوّر CRON_SECRET (لو لم يحدث)

---

## أرقام مهمّة

| القياس | القيمة الحالية | الهدف |
|--------|----------------|-------|
| Backup frequency | يومي (Coolify، داخلي على نفس الخادم) | يومي + نسخة خارجية B2 (TODO) |
| Backup retention | 30 يوم | 30 يوم |
| RTO (وقت الاستعادة) | <2 ساعة | <1 ساعة |
| RPO (أقصى فقدان بيانات) | 24 ساعة لفقدان DB وحده؛ فقدان الخادم كاملاً = آخر لقطة Google Sheet | <12 ساعة مع نسخة خارجية |
| Connection pool | 20 | 20 ✓ |
| Statement timeout | 30s | 30s ✓ |

---

## جهات الاتصال للطوارئ

- **مالك التطبيق**: yahyanasser8@gmail.com
- **Coolify support**: [coollabs.io/support](https://coollabs.io)
- **Meta WhatsApp support**: business.facebook.com → Help

---

**Last updated**: 2026-04-22
