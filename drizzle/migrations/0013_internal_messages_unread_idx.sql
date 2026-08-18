-- فهرس جزئي للرسائل الداخلية غير المقروءة.
-- استعلامات getProviderDashboard + getUnreadMessagesForCoordinator تُصفّي بـ
-- tenant_id + sender_role + is_read=false وتُرتّب بـ created_at DESC؛ بدون فهرس
-- كانت seq-scan + sort على كامل الجدول الذي ينمو مع كل رسالة حالة سريعة.

CREATE INDEX IF NOT EXISTS "internal_messages_tenant_unread_idx"
  ON internal_messages (tenant_id, sender_role, created_at)
  WHERE is_read = false;
