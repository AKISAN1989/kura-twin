// 4-1 経過簿の読み取り：手書きの醪経過表の写真から、日ごとの記録を JSON で返す
import { z } from "zod";
import { askJson, handler, imageBlock, MODELS, PRINCIPLES, HttpError } from "../lib/claude.mjs";

const FIELDS = ["moromi_day", "time", "operation", "temp", "baume", "nihonshudo", "alcohol", "acidity", "joubou", "note"];
const Conf = z.enum(["high", "low"]);

const Record = z.object({
  date: z.string().nullable().describe("YYYY-MM-DD。月日欄の値に、渡された年を付ける"),
  moromi_day: z.number().int().nullable(),
  time: z.string().nullable().describe("HH:MM"),
  operation: z.string().nullable(),
  temp: z.number().nullable(),
  baume: z.number().nullable(),
  nihonshudo: z.number().nullable(),
  alcohol: z.number().nullable(),
  acidity: z.number().nullable(),
  joubou: z.string().nullable().describe("筋泡・水泡・岩泡・高泡・落泡・玉泡・地 のどれか。書かれていなければ null"),
  note: z.string().nullable(),
  confidence: z.object(Object.fromEntries(["date", ...FIELDS].map(f => [f, Conf]))),
  low_regions: z.array(z.object({
    field: z.string(),
    x: z.number().describe("画像の左端からの割合 0〜1"),
    y: z.number().describe("画像の上端からの割合 0〜1"),
    w: z.number(),
    h: z.number(),
  })).describe("confidence が low の項目の、画像の中のおおよその位置（拡大して読み直すため）"),
});

const Result = z.object({
  tank: z.string().nullable().describe("タンク番号（数字だけ。例 '3'）"),
  image_quality: z.enum(["ok", "blurry"]).describe("ぼやけ・ブレ・暗さで多くの欄が読めなければ blurry"),
  records: z.array(Record).describe("日付の列ごとに1件。何も書かれていない列は含めない"),
});

const SYSTEM = `${PRINCIPLES}

# 仕事：手書きの醪経過表（経過簿）の写真を読み取る
- 表は日付が横（列）、項目が縦（行）。蔵ごとに書式が違うので、行の見出しから項目を判断する。
- 1列＝1日分の記録として、書かれている値をそのまま読む。
- 読めない・かすれている・どちらとも取れる数値は、推測で埋めない。null にして confidence を low にする。
- 少しでも自信がない項目も confidence を low にし、low_regions にその欄の位置を入れる。
- 前後の日の流れに合わせて数値を作らない（見えたとおりに書く）。
- 日本酒度のマイナス記号（−、▲、△ など）に注意する。`;

export default handler(async ({ image, mediaType, year }) => {
  if (!image) throw new HttpError(400, "経過簿の画像がありません");
  const result = await askJson({
    model: MODELS.precise,
    system: SYSTEM,
    effort: "high",
    content: [
      imageBlock(image, mediaType),
      { type: "text", text: `この醪経過表を読み取ってください。月日には ${year ?? new Date().getFullYear()} 年を付けてください。` },
    ],
    schema: Result,
  });
  return result;
});

// 同じ利用者（IP）からは1分間に 5 回まで（Netlify の rateLimit。超えると 429）
export const config = { path: "/api/read-sheet", rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ["ip", "domain"] } };
