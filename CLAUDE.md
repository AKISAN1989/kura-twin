# 蔵ツイン — Claude Code への決まりごと

仕様は [SPEC.md](SPEC.md)。不明点は実装前に作者へ聞く。

## 設計の原則（作品の中のClaudeにも、開発中のClaude Codeにも適用）
1. **Claudeは醸造の判断をしない。** 数値の異常・変化の検知はプログラム（`web/config/rules.json` のルール）で行う。Claudeの役割は「記録を読む」「杜氏に聞く」「記録から答える」の3つだけ。
2. **最終判断は常に杜氏。** 出力は記録と理由の提示にとどめ、「こうすべき」という醸造上の助言をしない。
3. **蔵の入力は増やさない。** 入口は経過簿の写真かExcelのみ。
4. **根拠のない回答をしない。** 記録にないことは「記録が見つかりません」。推測で数値を埋めない。

## APIキー
- Anthropic APIキーはサーバー側（Netlify Functions）だけで使う。ブラウザのコード・リポジトリ・ログに出さない。
- キーは `web/.env`（`.gitignore` 済み）か Netlify の環境変数に置く。`sk-ant-` を含む文字列はコミットしない（フックで検査）。

## ハッカソンのルール
- **開発期間（2026/11/2）より前に作ったコード（以前の蔵ツインの試作など）は流用しない。参照・コピーもしない。すべて新しく作る。**
- リポジトリは公開。個人情報・実在の蔵のデータを入れない（デモデータはすべて架空）。
- 意味のある単位でこまめにコミットする。

## 構成
- `web/` … 右側の操作画面（Vite＋素のJS）、Netlify Functions、データ（`web/data/`）、ルール設定（`web/config/`）
- `unity/KuraTwin/` … Unity 6 の3D。WebGL で書き出し、`web/public/unity/` に置く
- 右側→3D の命令は `web/src/bridge.js` の5つだけ：`setDay / highlightTank / setCamera / selectTank / tojiSay`。Unity側の受け口は `KuraBridge` オブジェクト。

## 用語
経過簿の項目と醸造用語は `.claude/skills/kura-terms/SKILL.md`（作品内プロンプト用の写しは `web/shared/terms.md`）。日順は**留添を1日目**とする。

## モデル
- 手書きの読み取り・読み直し・回答・照合：`claude-opus-5-5`
- 杜氏への質問の作成・タンクの要約：`claude-haiku-5-5`
