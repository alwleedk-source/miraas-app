#!/bin/sh
set -e

echo "🔄 Running database migrations..."
node migrate.mjs || echo "⚠️ Migration warning (tables may already exist)"

echo "🚀 Starting مِراس..."
exec node server.js
