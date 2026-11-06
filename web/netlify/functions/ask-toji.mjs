// 4-2 杜氏への質問：プログラムが検知した変化について、判断を聞く開いた質問を1つだけ作る
import { z } from "zod";
import { askJson, handler, MODELS, PRINCIPLES, HttpError } from "../lib/claude.mjs";
import { questionProblems } from "../../shared/question-rules.mjs";

const Result = z.object({
  question: z.string().describe("杜氏への質問。事実の確認1文＋開いた問い1つ。選択肢を示さない"),
});

const SYSTEM = `${PRINCIPLES}

# 仕事：杜氏に、判断を聞く開いた質問を作る
- 形は「事実の確認1文＋問い1文」。例：「6号タンク、2月9日から日本酒度の動きが鈍くなっています。このときどう判断しましたか？」
- 事実の確認には、プログラムが検知した変化と、記録に書かれた操作だけを書く。
- 問いは開いた形にする（「このときどう判断しましたか？」「どんなところを見て決めましたか？」）。
- 選択肢を示さない（「〜ですか、それとも〜ですか」「何もしなかったのですか」はだめ）。
- 答えを想定しない。備考の内容も含め、理由・見たもの・した操作の候補を挙げない（「香りを見て決めましたか？」「様子を見ていたのですか？」はだめ）。
- 記録に操作が書かれていない日は、操作をしたともしなかったとも書かない。
- 「？」は文末の1つだけ。丁寧で短い言葉。醸造上の評価や助言をしない。
- 日付は「2月10日」、日順は「留添16日目」のように書く。`;

export default handler(async ({ event, records, kind }) => {
  if (!event?.tank) throw new HttpError(400, "検知した変化の内容がありません");
  const rows = (records ?? [])
    .map(r => `${r.date} 日順${r.moromi_day} 品温${r.temp ?? "-"} 日本酒度${r.nihonshudo ?? "-"} 操作:${r.operation ?? "-"} 備考:${r.note ?? "-"}`)
    .join("\n");
  const content = `${event.tank}号タンク（${kind ?? "種類不明"}）、${event.date}（日順${event.moromi_day}）
プログラムが検知した変化：${event.change}
前後の記録：
${rows}`;
  // 決まり（選択肢なし・答えを想定しない・問いは1つ）に合うまで、最大3回まで作り直す
  let feedback = "";
  for (let i = 0; i < 3; i++) {
    const { question } = await askJson({
      model: MODELS.light,
      system: SYSTEM,
      effort: "low",
      maxTokens: 2000,
      content: content + feedback,
      schema: Result,
    });
    const problems = questionProblems(question);
    if (!problems.length) return { question };
    feedback = `\n\n前に作った質問「${question}」は決まりに合いませんでした：${problems.join("／")}。決まりに合うように作り直してください。`;
  }
  throw new HttpError(502, "決まりに合う質問を作れませんでした。もう一度試してください");
});

export const config = { path: "/api/ask-toji" };
