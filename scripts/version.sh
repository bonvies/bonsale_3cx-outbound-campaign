#!/bin/sh
# 升版 / 降版：同步根目錄、backend、frontend 的 package.json 和 README.md 的版號
#
#   pnpm bump                 顯示目前版號
#   pnpm bump patch           3.0.2 → 3.0.3
#   pnpm bump minor           3.0.2 → 3.1.0
#   pnpm bump major           3.0.2 → 4.0.0
#   pnpm bump 3.0.1           指定版號（降版用這個）
#   pnpm bump 4.0.0-beta.1    指定 pre-release
#
# 只改檔案，不會 commit / tag。
set -e

cd "$(dirname "$0")/.."

PACKAGE_FILES="package.json apps/backend/package.json apps/frontend/package.json"
README_FILE="README.md"

current=$(node -p "require('./package.json').version")

if [ -z "$1" ]; then
  echo "目前版號：v$current"
  exit 0
fi

# patch / minor / major 以目前版號的 X.Y.Z 計算，pre-release 後綴（-beta.1）會去掉
base=${current%%-*}
major=$(echo "$base" | cut -d. -f1)
minor=$(echo "$base" | cut -d. -f2)
patch=$(echo "$base" | cut -d. -f3)

case "$1" in
  patch) next="$major.$minor.$((patch + 1))" ;;
  minor) next="$major.$((minor + 1)).0" ;;
  major) next="$((major + 1)).0.0" ;;
  *)
    next=${1#v} # 容許 v4.0.0 的寫法
    if ! echo "$next" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$'; then
      echo "❌ 版號格式不正確：$1"
      echo "   請用 patch / minor / major，或 X.Y.Z、X.Y.Z-beta.1"
      exit 1
    fi
    ;;
esac

if [ "$next" = "$current" ]; then
  echo "版號已經是 v${current}，不用改"
  exit 0
fi

# 用 node 改 JSON，保留 key 順序與 2 格縮排；不用 sed 是因為 macOS 和 GNU 的 sed -i 參數不同
for file in $PACKAGE_FILES; do
  node -e '
    const fs = require("fs");
    const [file, version] = process.argv.slice(1);
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    pkg.version = version;
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  ' "$file" "$next"
  echo "  ✔ $file"
done

node -e '
  const fs = require("fs");
  const [file, version] = process.argv.slice(1);
  const pattern = /\*\*版本：v[^*]+\*\*/;
  const text = fs.readFileSync(file, "utf8");
  if (!pattern.test(text)) {
    console.error(`  ⚠ ${file} 找不到「**版本：vX.Y.Z**」，略過`);
    process.exit(0);
  }
  fs.writeFileSync(file, text.replace(pattern, `**版本：v${version}**`));
  console.log(`  ✔ ${file}`);
' "$README_FILE" "$next"

echo ""
echo "v$current → v$next"
echo ""
echo "確認無誤後自行執行："
echo "  git add $PACKAGE_FILES $README_FILE"
echo "  git commit -m \"chore: bump version v$next\""
echo "  git tag v$next"
