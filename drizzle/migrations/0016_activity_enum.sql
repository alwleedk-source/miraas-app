-- قيم activity_action جديدة لأحداث المتابعات — FOLLOW_UP_CREATED كانت القيمة
-- الوحيدة المتعلقة بالمتابعات، فبدت الإكمالات/الإلغاءات في سجل النشاط كإنشاء.
-- ADD VALUE IF NOT EXISTS: إعادة التشغيل آمنة (notice فقط، بلا خطأ).
-- ملاحظة: حدّث activityActionEnum في src/db/schema.ts بنفس القيمتين
-- (الملف مملوك لـ workstream آخر — التحديث منسّق خارج هذا الملف).

ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'FOLLOW_UP_COMPLETED';
ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'FOLLOW_UP_CANCELLED';
