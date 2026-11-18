#!/usr/bin/env bash
set -euo pipefail

SRC_ICON="${1:-assets/app-icon.png}"
RES_DIR="${2:-android/app/src/main/res}"

if [ ! -f "$SRC_ICON" ]; then
  echo "Source icon not found: $SRC_ICON" >&2
  exit 1
fi

BG_HEX="#$(convert "$SRC_ICON" -format "%[hex:u.p{2,2}]" info: | cut -c1-6)"
echo "Detected background color from corner: $BG_HEX"

# Pre-downscale master once to 1024x1024 so generating all densities runs in <1s
WORK_ICON="$(mktemp /tmp/app_icon_master_XXXXXX.png)"
trap 'rm -f "$WORK_ICON"' EXIT
convert "$SRC_ICON" -resize 1024x1024 -background "$BG_HEX" -gravity center -extent 1024x1024 -alpha remove -alpha off "$WORK_ICON"

# Delete old launcher icons in mipmap-* and stale vector launcher drawables to prevent duplicate resource conflicts
find "$RES_DIR" -path "*/mipmap-*/*" \( -name "ic_launcher*.png" -o -name "ic_launcher*.webp" \) -delete
rm -f "$RES_DIR/drawable/ic_launcher_background.xml" "$RES_DIR/drawable/ic_launcher_foreground.xml"

# Ensure values/colors.xml defines ic_launcher_background
mkdir -p "$RES_DIR/values"
cat << EOF > "$RES_DIR/values/colors.xml"
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">$BG_HEX</color>
</resources>
EOF

# Format: density:legacy_px:foreground_px
DENSITIES=("mdpi:48:108" "hdpi:72:162" "xhdpi:96:216" "xxhdpi:144:324" "xxxhdpi:192:432")

for ENTRY in "${DENSITIES[@]}"; do
  IFS=":" read -r DENSITY LEGACY_SIZE FG_SIZE <<< "$ENTRY"
  OUT_DIR="$RES_DIR/mipmap-$DENSITY"
  mkdir -p "$OUT_DIR"

  # Standard square icon
  convert "$WORK_ICON" -resize "${LEGACY_SIZE}x${LEGACY_SIZE}" \
    -background "$BG_HEX" -gravity center -extent "${LEGACY_SIZE}x${LEGACY_SIZE}" \
    -alpha remove -alpha off -strip "$OUT_DIR/ic_launcher.png"

  # Circular icon with safe padding so top waves are never clipped
  ROUND_ART=$((LEGACY_SIZE * 84 / 100))
  HALF_SIZE=$(awk "BEGIN { printf \"%.4f\", ($LEGACY_SIZE - 1) / 2.0 }")
  convert "$WORK_ICON" -resize "${ROUND_ART}x${ROUND_ART}" \
    -background "$BG_HEX" -gravity center -extent "${LEGACY_SIZE}x${LEGACY_SIZE}" \
    \( -size "${LEGACY_SIZE}x${LEGACY_SIZE}" xc:none -fill white -draw "circle $HALF_SIZE,$HALF_SIZE $HALF_SIZE,0" \) \
    -alpha set -compose DstIn -composite -strip "$OUT_DIR/ic_launcher_round.png"

  # Adaptive foreground scaled to ~70% inside 108dp safe zone on matching background color
  FG_ART=$((FG_SIZE * 70 / 100))
  convert "$WORK_ICON" -resize "${FG_ART}x${FG_ART}" \
    -background "$BG_HEX" -gravity center -extent "${FG_SIZE}x${FG_SIZE}" \
    -alpha remove -alpha off -strip "$OUT_DIR/ic_launcher_foreground.png"
done

mkdir -p "$RES_DIR/mipmap-anydpi-v26"
cat << 'EOF' > "$RES_DIR/mipmap-anydpi-v26/ic_launcher.xml"
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
EOF

cat << 'EOF' > "$RES_DIR/mipmap-anydpi-v26/ic_launcher_round.xml"
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
EOF

echo "Android launcher icons generated successfully in $RES_DIR."
