-- =============================================
-- Migration: internal_messages.department_id — ON DELETE CASCADE → SET NULL
--
-- حذف قسم كان يمسح كل رسائله الداخلية معه (سجلّ تواصل مهم للعيادة).
-- الآن تبقى الرسائل ويُصفَّر department_id فقط.
-- الاسمان أدناه يغطيان التسمية التلقائية لـ Postgres (inline REFERENCES في 0001)
-- وتسمية drizzle-kit لو طُبّق عبرها.
-- =============================================

ALTER TABLE internal_messages
  DROP CONSTRAINT IF EXISTS internal_messages_department_id_fkey;

ALTER TABLE internal_messages
  DROP CONSTRAINT IF EXISTS internal_messages_department_id_departments_id_fk;

ALTER TABLE internal_messages
  ADD CONSTRAINT internal_messages_department_id_fkey
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
