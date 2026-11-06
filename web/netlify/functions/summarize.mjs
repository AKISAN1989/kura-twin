// 4-6 タンクの要約（蔵人向け）：その日の状態を2〜3行の事実で書く
import { z } from "zod";
import { askJson, handler, MODELS, PRINCIPLES, HttpError } from "../lib/claude.mjs";

const Result = z.object({
  lines: z.array(z.string()).describe("2〜3行。数値・前日からの変化・備考の内容だけ"),
  similar: z.string().nullable().describe("似た状況の過去の判断メモが渡されたときだけ、1文で紹介する。無ければ null"),
});

const SYSTEM = `${PRINCIPLES}

# 仕事：タンクの今の状態を、経過簿の読み方が分からない人にも分かるように2〜3行で書く
- 使ってよいのは、渡された数値・前日からの変化・備考の走り書きの内容だけ。
- 1行目：「○号タンク 留添○日目。」のように、日順と品温（前日からの変化）。
- 2行目：日本酒度やボーメ、アルコール分の今の値と、ここ数日の動き（数字で）。
- 3行目（あれば）：「備考：…」
- 「発酵が遅れている」「温度を上げるべき」などの評価や助言を書かない。記録にない内容を足さない。
- 似た状況の過去の判断メモが渡されたら、similar に「似た状況の過去の判断：昨季の○号では、○日目に…している（杜氏のメモあり）」と1文で書く。`;

export default handler(async ({ tankLabel, kind, records, similar }) => {
  if (!records?.length) throw new HttpError(400, "このタンクの記録がありません");
  const rows = records.map(r =>
    `${r.date} 日順${r.moromi_day} 品温${r.temp ?? "-"} ボーメ${r.baume ?? "-"} 日本酒度${r.nihonshudo ?? "-"} アルコール${r.alcohol ?? "-"} 酸度${r.acidity ?? "-"} 状ぼう${r.joubou ?? "-"} 操作:${r.operation ?? "-"} 備考:${r.note ?? "-"}`).join("\n");
  const sim = similar
    ? `${similar.memo.season}年 ${similar.memo.tank}号 ${similar.memo.moromi_day}日目：${similar.memo.change}。杜氏のメモ：${similar.memo.answer}`
    : "なし";
  return askJson({
    model: MODELS.light,
    system: SYSTEM,
    effort: "low",
    maxTokens: 2000,
    content: `${tankLabel}（${kind ?? ""}）の直近の経過簿（古い順、最後がその日）：
${rows}

似た状況の過去の判断メモ：${sim}`,
    schema: Result,
  });
});

export const config = { path: "/api/summarize" };
