#!/bin/sh
set -e

echo "🔄 Running database migrations..."
# نتسامح مع فشل الهجرة عمداً: إسقاط الإقلاع = downtime كامل، بينما الإقلاع
# مع هجرة فاشلة جزئياً يبقي الخدمة ويعرض التفاصيل في /api/health?strict=1
# (يكتب migrate.mjs ملف حالة في tmpdir). الفشل يُطبع بصوت عالٍ في السجلات.
if ! node scripts/migrate.mjs; then
  echo "🚨🚨 MIGRATION FAILED — booting anyway to avoid downtime."
  echo "🚨 التفاصيل: /api/health?strict=1 (checks.migration)"
fi

echo "🚀 Starting مِراس..."
exec node server.js
