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
1. **لا تذعر** — backup خارجي (Backblaze) محفوظ
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
**RPO هدف**: 24 ساعة (آخر backup يومي)

---

## السيناريو 3: استعادة من Backup

### إذا backup في Coolify (داخلي)
```bash
# 1. ادخل Coolify → DB → Backups → اختر آخر backup ناجح
# 2. اضغط "Restore" — Coolify يُنفّذ pg_restore تلقائياً
# 3. بعد الانتهاء، أعد تشغيل التطبيق
```

### إذا backup في Backblaze (خارجي)
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
# 1. تحقّق من حالة migrations
docker exec <postgres-container> psql -U USER -d DBNAME \
  -c "SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5;"

# 2. لو آخر migration جزئية، rollback يدوي:
#    افحص drizzle/migrations/XXXX_*.sql
#    اعكس الـ ALTER/CREATE statements
#    احذف الصف من __drizzle_migrations

# 3. أعد deploy
```

**درس مستفاد**: راجع كل migration قبل تطبيقه على production.

---

## السيناريو 5: مستأجر طلب حذف بياناته (GDPR)

### الإجراء
```sql
-- 1. سجّل الطلب
INSERT INTO activity_log (tenant_id, action, details)
VALUES ('<tenant_id>', 'TENANT_DELETION_REQUEST', '{"reason": "GDPR"}');

-- 2. حذف البيانات بالترتيب (احترام FKs)
BEGIN;
DELETE FROM follow_ups WHERE tenant_id = '<tenant_id>';
DELETE FROM activity_log WHERE tenant_id = '<tenant_id>';
DELETE FROM notifications WHERE tenant_id = '<tenant_id>';
DELETE FROM leads WHERE tenant_id = '<tenant_id>';
DELETE FROM lead_sources WHERE tenant_id = '<tenant_id>';
DELETE FROM pipeline_stages WHERE tenant_id = '<tenant_id>';
DELETE FROM whatsapp_configs WHERE tenant_id = '<tenant_id>';
DELETE FROM webhook_endpoints WHERE tenant_id = '<tenant_id>';
DELETE FROM tags WHERE tenant_id = '<tenant_id>';
DELETE FROM departments WHERE tenant_id = '<tenant_id>';
DELETE FROM services WHERE tenant_id = '<tenant_id>';
DELETE FROM users WHERE tenant_id = '<tenant_id>';
DELETE FROM tenants WHERE id = '<tenant_id>';
COMMIT;

-- 3. اطلب من backups الخارجية حذف نسخ المستأجر (لو يحتفظ provider)
-- 4. أبلغ المستأجر بالاكتمال
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

## فحوصات صحية دورية

### يومياً (تلقائي)
- ✅ Backup يجري الساعة 2 صباحاً
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
| Backup frequency | يومي | يومي ✓ |
| Backup retention | 30 يوم | 30 يوم |
| RTO (وقت الاستعادة) | <2 ساعة | <1 ساعة |
| RPO (أقصى فقدان بيانات) | 24 ساعة | <12 ساعة |
| Connection pool | 20 | 20 ✓ |
| Statement timeout | 30s | 30s ✓ |

---

## جهات الاتصال للطوارئ

- **مالك التطبيق**: yahyanasser8@gmail.com
- **Coolify support**: [coollabs.io/support](https://coollabs.io)
- **Meta WhatsApp support**: business.facebook.com → Help

---

**Last updated**: 2026-04-22
