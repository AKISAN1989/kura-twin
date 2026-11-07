// 4-4 読み直し：自信の低かった欄を拡大した画像で、もう一度読む
import { z } from "zod";
import { askJson, handler, imageBlock, MODELS, PRINCIPLES, HttpError } from "../lib/claude.mjs";

const Result = z.object({
  read_text: z.string().nullable().describe("拡大画像に見えた文字をそのまま（読めなければ null）"),
  value_number: z.number().nullable().describe("数値の欄なら数値。読めなければ null"),
  value_text: z.string().nullable().describe("文字の欄（操作・状ぼう・備考・時刻）なら文字。読めなければ null"),
  confident: z.boolean().describe("拡大して、はっきり読めたときだけ true"),
  reason: z.string().describe("どう読んだか、なぜ確定できないか（一文）"),
});

const SYSTEM = `${PRINCIPLES}

# 仕事：経過簿の1つの欄を、拡大画像で読み直す
- 渡されるのは、前回の読み取りで自信が低かった欄を拡大した画像。
- 前後の日の数値の流れ（日本酒度は日を追って上がる、ボーメは下がる、など）は、字の形がどちらとも取れるときの参考にしてよい。
- ただし、流れに合わせて数値を作ってはいけない。字として読めないなら confident を false にし、値は null にする。
- 文字の欄（備考・操作など）は、すべての字がはっきり読めたときだけ confident を true にする。言いそうな言葉で補わない。`;

export default handler(async ({ image, mediaType, field, fieldLabel, tank, date, firstRead, neighbors }) => {
  if (!image || !field) throw new HttpError(400, "読み直す欄の画像がありません");
  const ctx = (neighbors ?? []).map(n => `${n.date}：${n.value ?? "（空欄）"}`).join("\n");
  return askJson({
    model: MODELS.precise,
    system: SYSTEM,
    effort: "medium", // 1つの欄だけなので、時間切れ（30秒）にならないように
    content: [
      imageBlock(image, mediaType),
      {
        type: "text",
        text: `${tank ?? "?"}号タンク ${date ?? "日付不明"} の「${fieldLabel ?? field}」欄です。
前回の読み取り：${firstRead ?? "null"}
前後の日の同じ欄：
${ctx || "（なし）"}`,
      },
    ],
    schema: Result,
  });
});

export const config = { path: "/api/reread" };
