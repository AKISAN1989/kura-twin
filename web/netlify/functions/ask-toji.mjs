// 4-2 杜氏への質問：プログラムが検知した変化について、判断の理由を聞く質問を1文だけ作る
import { z } from "zod";
import { askJson, handler, MODELS, PRINCIPLES, HttpError } from "../lib/claude.mjs";

const Result = z.object({
  question: z.string().describe("杜氏への質問。1文だけ。疑問は1つだけ"),
});

const SYSTEM = `${PRINCIPLES}

# 仕事：杜氏に、判断の理由を聞く質問を1文だけ作る
- 現場の先輩に聞くような、丁寧で短い言葉にする。専門用語は蔵で使う言葉のまま使う。
- 形は「○号タンク、（いつ）（何を）していますね。どんな様子を見て決めましたか？」のように、事実の確認＋理由を聞く。
- 答えを誘導しない（「温度が高すぎたからですか？」のように理由の候補を挙げない）。
- 1回に複数のことを聞かない。醸造上の評価や助言をしない。
- 何もしなかった（停滞しても手を入れていない）場合は、どう見ていたかを聞く。`;

export default handler(async ({ event, records, kind }) => {
  if (!event?.tank) throw new HttpError(400, "検知した変化の内容がありません");
  const rows = (records ?? [])
    .map(r => `${r.date} 日順${r.moromi_day} 品温${r.temp ?? "-"} 日本酒度${r.nihonshudo ?? "-"} 操作:${r.operation ?? "-"} 備考:${r.note ?? "-"}`)
    .join("\n");
  return askJson({
    model: MODELS.light,
    system: SYSTEM,
    effort: "low",
    maxTokens: 2000,
    content: `${event.tank}号タンク（${kind ?? "種類不明"}）、${event.date}（日順${event.moromi_day}）
プログラムが検知した変化：${event.change}
前後の記録：
${rows}`,
    schema: Result,
  });
});

export const config = { path: "/api/ask-toji" };
