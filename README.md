# مِراس (Meras CRM)

نظام إدارة علاقات عملاء (CRM) **متعدد المستأجرين** موجّه للعيادات: إدارة العملاء المحتملين (leads)، مراحل البيع (pipeline)، الحجوزات الذكية مع منع الحجز المزدوج، رسائل WhatsApp الترحيبية والتذكيرية، واستقبال العملاء عبر webhooks (Google Sheets وغيرها). عزل بيانات كل مستأجر مفروض عبر `tenant_id` في كل استعلام (راجع `docs/architecture.md`).

## المتطلبات

- Node.js 20+
- PostgreSQL 14+ (يتطلب امتداد `btree_gist` — تُنشئه الهجرات تلقائياً)
- npm

## متغيرات البيئة

| المتغير | مطلوب؟ | الوصف |
|---------|--------|-------|
| `DATABASE_URL` | ✅ | رابط Postgres (`postgres://...`). يُقبل بدون `sslmode=` داخل شبكة docker الداخلية (تحذير فقط) |
| `BETTER_AUTH_SECRET` | ✅ | سر الجلسات (16 حرفاً على الأقل) |
| `BETTER_AUTH_URL` | ✅ | الرابط العام للتطبيق (`https://app.example.com`) |
| `NEXT_PUBLIC_APP_URL` | ✅ (build) | يُضمَّن في حزمة المتصفح وقت البناء |
| `ENCRYPTION_KEY` | ✅ | 64 حرفاً hex (مفتاح AES-256 لتشفير مفاتيح WhatsApp) |
| `CRON_SECRET` | ✅ | سر مسارات cron (32 حرفاً على الأقل) |
| `RESEND_API_KEY` | اختياري | تفعيل إرسال البريد (تأكيد البريد الإلكتروني) |
| `EMAIL_FROM` | مطلوب مع `RESEND_API_KEY` | عنوان المُرسِل — بدونه يفشل الإقلاع في production |

التحقق يتم تلقائياً عند الإقلاع في production عبر `src/instrumentation.ts` → `assertEnv()`.

## أوامر التطوير

```bash
npm run dev              # خادم التطوير
npm run build            # بناء الإنتاج
npm start                # هجرات + خادم الإنتاج
npm run lint             # ESLint
npm test                 # اختبارات Vitest
npm run db:migrate       # تطبيق الهجرات (يُستخدم أيضاً عند إقلاع الحاوية)
npm run db:audit         # فحص ما قبل الهجرة
npm run security:probe   # فحص أمني بعد النشر (BASE_URL=https://...)
```

## الهجرات (Migrations)

الهجرات ملفات SQL عادية في `drizzle/migrations/` تُطبَّق **عند إقلاع الحاوية** عبر `scripts/migrate.mjs` — **لا نستخدم `drizzle-kit migrate`**. المُهاجر:

- يأخذ advisory lock لمنع تسابق النسخ المتوازية
- يعتبر أخطاء `already exists` / `duplicate` حميدة (idempotent)
- يفشل الإقلاع على أي خطأ آخر
- يقسّم الملفات على `;` تقسيمًا بسيطًا — لذا يُمنع في ملفات الهجرة: كتل `$$`، الدوال، والمعاملات (عبارات مفردة فقط)

## النشر (Docker / Coolify)

`Dockerfile` متعدد المراحل: يبني standalone output ثم ينسخ `scripts/` و`drizzle/` و`start.sh` لصورة التشغيل. عند الإقلاع، `start.sh` يشغّل الهجرات (fail-fast) ثم `node server.js`. في Coolify: اربط المستودع، اضبط متغيرات البيئة أعلاه، ومرّر `NEXT_PUBLIC_APP_URL` كـ build argument. فحص الصحة على `/api/health`.

## بنية المشروع

- `src/app/` — App Router (صفحات + API routes + server actions)
- `src/actions/` — منطق الكتابة المحمي بالأدوار
- `src/db/` — مخطط drizzle + سياق المستأجر
- `src/lib/` — الحراسات، التشفير، التحقق من البيئة، الأدوات المشتركة
- `docs/architecture.md` — قرارات العزل متعدد المستأجرين (اقرأها قبل أي تغيير في طبقة DB)
- `docs/disaster-recovery.md` — دليل الاستعادة من الكوارث
