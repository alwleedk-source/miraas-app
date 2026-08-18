-- يضيف override لأسماء قوالب الترحيب والتذكير لكل منسق.
-- لازم لمن WABA الخاص به في Meta منفصل عن WABA الشركة → كل WABA لها قوالبها.
-- null = استخدم اسم القالب من whatsapp_configs (الافتراضي على مستوى المنشأة).

ALTER TABLE user_whatsapp_credentials
  ADD COLUMN IF NOT EXISTS welcome_template_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reminder_template_name VARCHAR(255);
