// 4-1 経過簿の読み取り：写真（または PDF を画像にしたページ）から、表の見出しと値を「書かれたとおり」に返す。
// 蔵ごとに書式が違う（日付が横／縦、見出しの名前、項目の順番、無い項目、1枚に複数のタンク）ので、
// 見出しがどの項目にあたるかの推定と、その自信も返す。値の解釈（数値・日付）はブラウザ側で行う。
import { z } from "zod";
import { askJson, handler, imageBlock, MODELS, PRINCIPLES, HttpError } from "../lib/claude.mjs";
import { FIELD_MEANINGS, FieldKey } from "../lib/sheet-fields.mjs";

const Result = z.object({
  tank: z.string().nullable().describe("用紙全体のタンク番号（題や欄外に書かれていれば数字だけ。例 '3'）。表の中にタンクの列・行があれば null でよい"),
  layout: z.enum(["dates_across", "dates_down"]).describe("日付が横に並ぶ（見出しが縦に並ぶ）なら dates_across、日付が縦に並ぶ（見出しが横に並ぶ）なら dates_down"),
  image_quality: z.enum(["ok", "blurry"]).describe("ぼやけ・ブレ・暗さで多くの欄が読めなければ blurry"),
  labels: z.array(z.object({
    text: z.string().describe("見出しに書かれた文字そのまま（例：BMD、温度、アル分）"),
    field: FieldKey.describe("この見出しが蔵ツインのどの項目にあたるか"),
    confidence: z.enum(["high", "low"]).describe("対応に迷いがなければ high。略語・別の意味もありうる名前・値の様子と合わないときは low"),
    reason: z.string().describe("そう判断した理由（短く。値の様子も含めて）"),
  })).describe("表の見出し（項目名）。並んでいる順に、すべて"),
  entries: z.array(z.object({
    tank: z.string().nullable().describe("この1日分（1行／1列）のタンク番号。用紙全体で1つなら null"),
    values: z.array(z.string().nullable()).describe("labels と同じ順・同じ数。書かれた文字そのまま（数字は半角、マイナスは -）。空欄は null"),
    low: z.array(z.number().int()).describe("読みに自信のない欄の、labels での番号（0から）"),
  })).describe("1日分（日付が横なら1列、縦なら1行）ごとに1件。何も書かれていないものは含めない"),
  low_regions: z.array(z.object({
    entry: z.number().int().describe("entries での番号（0から）"),
    label: z.number().int().describe("labels での番号（0から）"),
    x: z.number().describe("画像の左端からの割合 0〜1"),
    y: z.number().describe("画像の上端からの割合 0〜1"),
    w: z.number(),
    h: z.number(),
  })).describe("自信のない欄の、画像の中のおおよその位置（拡大して読み直すため）"),
});

const SYSTEM = `${PRINCIPLES}

# 仕事：手書きの醪経過表（経過簿）の画像を読み取る
- 蔵ごとに書式が違う。日付が横に並ぶ表も、縦に並ぶ表もある。見出しの名前・順番も違い、無い項目もある。1枚に複数のタンクが書かれていることもある。
- まず見出し（項目名）を、書かれたとおりに並んだ順にすべて拾う。印刷された見出しも手書きの見出しも拾う。
- 見出しごとに、蔵ツインのどの項目にあたるかを選ぶ。
${FIELD_MEANINGS}
- 対応に少しでも迷うとき（略語、蔵によって意味の違う名前、値の様子が項目と合わない）は confidence を low にする。決めつけない。
- 値は、1日分ごとに見出しと同じ順で、書かれた文字そのままを入れる。単位は省いてよい。
- 読めない・かすれている・どちらとも取れる値は、推測で埋めない。null にして low に入れ、low_regions に位置を入れる。
- 少しでも自信がない欄も low に入れ、low_regions に位置を入れる。
- 前後の日の流れに合わせて数値を作らない（見えたとおりに書く）。
- 日本酒度のマイナス記号（−、▲、△ など）は - にする。`;

export default handler(async ({ image, mediaType, year, page, pages }) => {
  if (!image) throw new HttpError(400, "経過簿の画像がありません");
  const pageNote = pages > 1 ? `（PDF の ${page}／${pages} ページ目）` : "";
  const result = await askJson({
    model: MODELS.precise,
    system: SYSTEM,
    effort: "high",
    content: [
      imageBlock(image, mediaType),
      { type: "text", text: `この醪経過表${pageNote}を読み取ってください。年が書かれていなければ ${year ?? new Date().getFullYear()} 年の記録です。` },
    ],
    schema: Result,
  });
  // 値の数を見出しの数にそろえる（足りなければ空欄、多ければ切る）
  for (const e of result.entries) {
    e.values = result.labels.map((_, i) => e.values[i] ?? null);
    e.low = e.low.filter(i => i >= 0 && i < result.labels.length);
  }
  return result;
});

// 同じ利用者（IP）からは1分間に 8 回まで（PDF は1ページずつ読むため。Netlify の rateLimit。超えると 429）
export const config = { path: "/api/read-sheet", rateLimit: { windowLimit: 8, windowSize: 60, aggregateBy: ["ip", "domain"] } };
