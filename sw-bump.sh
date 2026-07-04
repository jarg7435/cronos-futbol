#!/usr/bin/env bash
# CHRONOS FÚTBOL — Bump de versión del Service Worker
# USO: bash sw-bump.sh

set -e

SW_FILE="sw.js"

if [ ! -f "$SW_FILE" ]; then
    echo "❌ No se encuentra sw.js"
    exit 1
fi

CURRENT=$(grep -oP "const VERSION = '\Kv\d+" "$SW_FILE" | head -1)
if [ -z "$CURRENT" ]; then
    echo "❌ No se pudo encontrar const VERSION en sw.js"
    exit 1
fi

NUM=$(echo "$CURRENT" | tr -d 'v')
NEW_NUM=$((NUM + 1))
NEW_VERSION="v${NEW_NUM}"

echo "▸ Bump: $CURRENT → $NEW_VERSION"

sed -i "s|const VERSION = '${CURRENT}'|const VERSION = '${NEW_VERSION}'|g" "$SW_FILE"
sed -i "s|cronos-cache-${CURRENT}|cronos-cache-${NEW_VERSION}|g" "$SW_FILE"

echo "✓ BUMP COMPLETADO: $CURRENT → $NEW_VERSION"
echo ""
echo "Próximos pasos:"
echo "  1. git add sw.js"
echo "  2. git commit -m 'SW bump: $CURRENT → $NEW_VERSION'"
echo "  3. npm run deploy:hosting"