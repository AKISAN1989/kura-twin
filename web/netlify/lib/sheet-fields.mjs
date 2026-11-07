// 経過簿の見出し → 蔵ツインの項目（読み取り・Excel の見出しの対応で共通）
import { z } from "zod";
import { FIELD_KEYS } from "../../shared/sheet-map.mjs";

export const FieldKey = z.enum(FIELD_KEYS);

export const FIELD_MEANINGS = `- 項目の選び方（field）：
  - date：月日・日付
  - moromi_day：日順・醪日数・留後日数（留添を1日目とする日数。初添〜仲添は0以下）
  - time：測った時刻
  - operation：操作（追水・暖気・櫂入れ・上槽など、その日にしたこと）
  - temp：品温（醪の温度）。「温度」だけの見出しは、室温や水温のこともあるので、値の様子を見て迷えば low
  - baume：ボーメ（Bé、ボ）。「BMD」は多くの蔵で「ボーメ×醪日数」の別の値なので、ボーメと決めつけず、値の様子を見て迷えば low
  - nihonshudo：日本酒度（SMV、酒度、日本酒）
  - alcohol：アルコール分（アル分、アル、Alc）
  - acidity：酸度（酸）
  - joubou：状ぼう・泡・泡の状態（筋泡・水泡・岩泡・高泡・落泡・玉泡・地）
  - note：備考・メモ・所見
  - tank：タンク番号（1枚に複数のタンクを書く表の、タンクの列・行）
  - ignore：上のどれにもあたらない（室温・担当者の印など）`;
