// 4-3 蔵人の質問への回答 → 4-5 確認役のClaudeが一文ずつ照合し、根拠のない文を削ってから返す
import { z } from "zod";
import { askJson, handler, MODELS, PRINCIPLES, HttpError } from "../lib/claude.mjs";

const NOT_FOUND = "記録が見つかりません。";

const Answer = z.object({
  found: z.boolean().describe("渡された記録の中に、質問に答える判断メモがあれば true"),
  sentences: z.array(z.object({
    text: z.string().describe("杜氏の口調で語る1文"),
    core: z.boolean().describe("核心（当時何をしたか・なぜそうしたか）の文なら true。数値の経過・上槽時の数値・他のタンクの例は false"),
    sources: z.array(z.number().int()).describe("この文の根拠にした候補の番号（「候補1」なら 1）"),
  })),
});

const Verdicts = z.object({
  results: z.array(z.object({
    index: z.number().int(),
    supported: z.boolean().describe("この文の内容が、渡された記録か判断メモに書かれていれば true"),
    reason: z.string().describe("根拠になった記録、または根拠がない理由（一文）"),
  })),
});

const ANSWER_SYSTEM = `${PRINCIPLES}

# 仕事：杜氏を目指す蔵人の質問に、過去の記録と判断メモだけを根拠に答える
- 渡された「候補」（過去の判断メモと、その前後の経過簿、搾った時の数値）だけを使う。
- 質問に最も近い候補を1件選び、その件を中心に答える。
- 先に「核心」を3〜4文（core: true）：①当時の判断（いつ・どのタンクで・何をしたか）②杜氏が話した理由。
- そのあとに「詳しい経過」を必要なだけ（core: false、合わせて4文以内）：翌日以降の数値の動き、上槽時の数値、質問に関わる他のタンクの例。
- 文は短く、1文に1つの事実。数値は記録のとおりに書く。日付は「2月11日」、タンクは「8号」、日順は「留添12日目」のように書く。
- 口調だけを杜氏らしく（ややくだけた、落ち着いた話し言葉）。内容は記録にあることだけ。
- 相手は蔵で働く蔵人。呼びかけるときは「お前さん」とする（必要なときだけ、核心の最初の文などで一度まで）。
- 「こうすべき」という助言、一般論、記録にない推測は書かない。
- 質問に答える判断メモが候補に無ければ found を false にし、sentences は空にする。
- 質問が「どうなるか（結果の予測）」「一般にどうか（一般論・原理）」を聞いていて、判断メモに書かれた当時の判断と理由では答えられないときも found を false にする。似た話題の別の判断にすり替えて答えない。`;

const VERIFY_SYSTEM = `${PRINCIPLES}

# 仕事：回答の照合役
- 回答の一文ずつについて、渡された記録・判断メモに根拠があるかを判定する。
- 数値・日付・タンク番号・操作・理由が記録と一致していれば supported を true。
- 記録にない内容（推測、一般論、助言、記録と違う数値）が含まれていれば false。
- 回答を書き足したり直したりしない。照合だけを行う。`;

function candidatesText(candidates) {
  return candidates.map((c, i) => {
    const m = c.memo;
    const recs = (c.records ?? []).map(r =>
      `  ${r.date} 日順${r.moromi_day} 品温${r.temp ?? "-"} ボーメ${r.baume ?? "-"} 日本酒度${r.nihonshudo ?? "-"} アルコール${r.alcohol ?? "-"} 状ぼう${r.joubou ?? "-"} 操作:${r.operation ?? "-"} 備考:${r.note ?? "-"}`).join("\n");
    const p = c.pressed;
    // 蔵人が杜氏に直接聞いた問い（記録に見つからなかったもの）への答え。タンクが無いこともある
    const where = m.tank ? `${m.tank}号（${c.kind ?? ""}）${m.date} 日順${m.moromi_day ?? "-"}` : `${m.date}（タンクの指定なし）`;
    return `## 候補${i + 1}：${m.season}年 ${where}${m.from === "kurabito" ? "　※蔵人が杜氏に直接聞いた問い" : ""}
変化：${m.change}
杜氏への質問：${m.question}
杜氏の答え（判断メモ）：${m.answer}
前後の経過簿：
${recs || "  （なし）"}
上槽：${p ? `${p.date} 日順${p.moromi_day} 日本酒度${p.nihonshudo ?? "-"} アルコール${p.alcohol ?? "-"} 酸度${p.acidity ?? "-"}` : "記録なし"}`;
  }).join("\n\n");
}

export default handler(async ({ question, candidates }) => {
  if (!question?.trim()) throw new HttpError(400, "質問が空です");
  if (!candidates?.length) {
    return { found: false, answer: NOT_FOUND, sentences: [], removed: [], sources: [], draft: [] };
  }
  const evidence = candidatesText(candidates);

  const draft = await askJson({
    model: MODELS.precise,
    system: ANSWER_SYSTEM,
    effort: "medium",
    maxTokens: 8000,
    content: `# 候補\n${evidence}\n\n# 蔵人の質問\n${question}`,
    schema: Answer,
  });
  if (!draft.found || draft.sentences.length === 0) {
    return { found: false, answer: NOT_FOUND, sentences: [], removed: [], sources: [], draft: [] };
  }

  const numbered = draft.sentences.map((s, i) => `${i}: ${s.text}`).join("\n");
  const verdicts = await askJson({
    model: MODELS.precise,
    system: VERIFY_SYSTEM,
    effort: "high",
    content: `# 記録と判断メモ\n${evidence}\n\n# 照合する回答（番号: 文）\n${numbered}`,
    schema: Verdicts,
  });
  const ok = new Map(verdicts.results.map(v => [v.index, v]));
  // 照合の結果が無い文も、根拠がないものとして扱う
  const kept = draft.sentences.filter((_, i) => ok.get(i)?.supported === true);
  const removed = draft.sentences
    .map((s, i) => ({ text: s.text, reason: ok.get(i)?.reason ?? "照合の結果がありません" }))
    .filter((_, i) => ok.get(i)?.supported !== true);

  if (kept.length === 0) {
    return { found: false, answer: NOT_FOUND, sentences: [], removed, sources: [], draft: draft.sentences };
  }
  // 根拠は候補の番号で受け取り、季・タンク・日付はこちらで引く（Claude に書き写させない）
  const sources = [...new Set(kept.flatMap(s => s.sources))]
    .map(n => candidates[n - 1]?.memo)
    .filter(Boolean)
    .map(m => ({ season: m.season, tank: m.tank, date: m.date }));
  // 核心（3〜4文）と、詳しい経過に分ける。核心の印が多すぎたら先頭の4文までを核心にする
  let core = kept.filter(s => s.core);
  if (core.length === 0) core = kept.slice(0, 3);
  core = core.slice(0, 4);
  const detail = kept.filter(s => !core.includes(s));
  return {
    found: true,
    answer: core.map(s => s.text).join(""),
    detail: detail.map(s => s.text).join(""),
    sentences: kept, removed, sources, draft: draft.sentences,
  };
});

// 同じ利用者（IP）からは1分間に 8 回まで（Netlify の rateLimit。超えると 429）
export const config = { path: "/api/young-question", rateLimit: { windowLimit: 8, windowSize: 60, aggregateBy: ["ip", "domain"] } };
