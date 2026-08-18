-- 0001z: إزالة تكرارات (tenant_id, name) في pipeline_stages — تعمل قبل 0002.
--
-- السبب: قاعدة الإنتاج تراكمت فيها مراحل مكررة بنفس الاسم للشركة الواحدة
-- (قبل وجود الفهرس الفريد)، فكان CREATE UNIQUE INDEX في 0002 يفشل بـ 23505 —
-- بصمت في المُهاجر القديم، وقتل للإقلاع في fail-fast. كشفه /api/health في
-- الإنتاج. الفشل كان يُسقط معه 0015 (ON CONFLICT يتطلب الفهرس) → 42P10.
--
-- المنطق: لكل (tenant_id, name) نُبقي نسخة واحدة "keep" — نفضّل النشطة
-- (غير المؤرشفة)، ثم الأدنى position، ثم الأقدم، ثم الأصغر id — وننقل
-- leads المراحل المكررة إليها، ثم نحذف المكررات. idempotent: لا شيء يتغير
-- عند إعادة التشغيل بعد التنظيف.
-- ملاحظة للمُشغّل: المُهاجر يقسم على الفاصلة المنقوطة — جمل بسيطة فقط، بلا $$

-- 1) نقل leads من المراحل المكررة إلى النسخة المحتفَظ بها
UPDATE leads l
SET stage_id = m.keep_id
FROM (
  SELECT d.id AS dup_id,
         (SELECT k.id
          FROM pipeline_stages k
          WHERE k.tenant_id = d.tenant_id AND k.name = d.name
          ORDER BY (k.archived_at IS NULL) DESC, k.position ASC, k.created_at ASC, k.id ASC
          LIMIT 1) AS keep_id
  FROM pipeline_stages d
) m
WHERE l.stage_id = m.dup_id
  AND m.dup_id <> m.keep_id;

-- 2) حذف النسخ المكررة (يبقى واحد فقط لكل tenant_id+name)
DELETE FROM pipeline_stages d
WHERE d.id <> (
  SELECT k.id
  FROM pipeline_stages k
  WHERE k.tenant_id = d.tenant_id AND k.name = d.name
  ORDER BY (k.archived_at IS NULL) DESC, k.position ASC, k.created_at ASC, k.id ASC
  LIMIT 1
);
