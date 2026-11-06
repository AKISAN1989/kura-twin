#!/bin/bash
# PostToolUse(Edit|Write) フック：変化検知のルール（rules.json / detect.js）を変えたら自動でテストを走らせる。
input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')

case "$file" in
  */web/public/config/rules.json|*/web/src/detect.js) ;;
  *) exit 0 ;;
esac

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が無いため、検知ルールのテストを実行できませんでした。" >&2
  exit 0
fi
out=$(cd "$root/web" && node --test tests/ 2>&1)
if [ $? -ne 0 ]; then
  echo "検知ルールのテストが失敗しました：" >&2
  echo "$out" | tail -40 >&2
  exit 2
fi
echo "検知ルールのテスト：成功"
exit 0
