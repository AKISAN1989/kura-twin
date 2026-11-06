#!/bin/bash
# PreToolUse(Bash) フック：git commit の前に、ステージされた変更に APIキー（sk-ant-）が含まれていないか検査する。
# 含まれていれば exit 2 でコミットを止める。
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

case "$cmd" in
  *"git commit"*|*"git -C"*commit*) ;;
  *) exit 0 ;;
esac

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
# 検査用の文字列はリテラルにしない（このファイル自体が引っかからないように）
pattern="sk-""ant-[A-Za-z0-9_-]{20,}"
hits=$(git -C "$root" diff --cached -U0 | grep '^+' | grep -nE "$pattern")
if [ -n "$hits" ]; then
  echo "コミットを止めました：ステージされた変更に APIキーらしき文字列（sk-ant-...）があります。.env に移してから再度コミットしてください。" >&2
  exit 2
fi
exit 0
