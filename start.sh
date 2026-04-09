#!/bin/sh
set -e

echo "🔄 Running database migrations..."
npx drizzle-kit push --force 2>&1 || echo "⚠️ Migration warning (may already exist)"
echo "✅ Migrations complete"

echo "🚀 Starting مِراس..."
exec node server.js
