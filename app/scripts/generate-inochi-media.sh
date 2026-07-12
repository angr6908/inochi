#!/bin/sh
set -eu

app_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo_dir=$(CDPATH= cd -- "$app_dir/.." && pwd)
logo_svg="$app_dir/assets/inochi-logo.svg"
output_png="$repo_dir/media/inochi-logo-padded.png"
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

python3 "$app_dir/scripts/update-inochi-burn.py" "$logo_svg"
mkdir -p "$(dirname -- "$output_png")"

if command -v vips >/dev/null 2>&1; then
  vips thumbnail "$logo_svg" "$tmp_dir/logo.png" 2000
  logo_width=$(vipsheader -f width "$tmp_dir/logo.png")
  logo_height=$(vipsheader -f height "$tmp_dir/logo.png")
  left=$(( (2400 - logo_width) / 2 ))
  top=$(( (1200 - logo_height) / 2 ))
  vips embed "$tmp_dir/logo.png" "$output_png" "$left" "$top" 2400 1200 \
    --extend background --background "0,0,0,0"
elif command -v bun >/dev/null 2>&1; then
  LOGO_SOURCE="$logo_svg" LOGO_OUTPUT="$output_png" bun -e '
    const sharp = require("sharp");
    const { data, info } = await sharp(process.env.LOGO_SOURCE, { density: 288 })
      .resize({ width: 2000 })
      .png()
      .toBuffer({ resolveWithObject: true });
    await sharp({
      create: {
        width: 2400,
        height: 1200,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{
        input: data,
        left: 200,
        top: Math.floor((1200 - info.height) / 2),
      }])
      .png()
      .toFile(process.env.LOGO_OUTPUT);
  '
else
  echo "vips or Bun with Sharp is required to generate the media PNG" >&2
  exit 1
fi

