#!/usr/bin/env bash
# Verifica el artefacto de GitHub Pages: solo la interfaz compilada, sin datos, mapas, configuración de pruebas ni
# emulador, con la CSP en <meta> apuntando al origen de la API y los recursos bajo /skitrip/.
# Uso: tools/verify-pages-artifact.sh <dir> <origen_api>
set -euo pipefail
dir=$1; api=$2
cd "$dir"
unexpected=$(find . -type f ! -path './assets/*' ! -name index.html ! -name favicon.svg)
[ -z "$unexpected" ] || { echo "Archivos inesperados: $unexpected"; exit 1; }
if find . -type f \( -name '*.map' -o -name '*.csv' -o -name '*.sql' -o -name '*.sqlite*' -o -name '.env*' -o -name '_headers' \) | grep .; then echo "Archivos prohibidos"; exit 1; fi
if grep -rlE 'demo-skitrip|127\.0\.0\.1:9099|demo-api-key' .; then echo "Restos del emulador en el build"; exit 1; fi
grep -q 'http-equiv="Content-Security-Policy"' index.html || { echo "Falta la CSP"; exit 1; }
grep -q "connect-src $api " index.html || { echo "La CSP no apunta a $api"; exit 1; }
grep -q 'src="/skitrip/assets/' index.html || { echo "Los recursos no están bajo /skitrip/"; exit 1; }
echo "Artefacto de Pages correcto: $(find . -type f | wc -l) archivos"
