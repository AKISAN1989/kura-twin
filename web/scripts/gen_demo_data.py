"""蔵ツインのデモ用ダミーデータを作る（すべて架空）。

    python3 -I web/scripts/gen_demo_data.py

出力：web/public/data/kura.json, season-current.json, season-past.json, memos-past.json
数値の推移はこの台本で決め、検知ルールに引っかかる変化は EVENTS で意図して入れる。
作者（元蔵人）が数値と判断メモを確認・修正する前提の下書き。
"""
import json
import math
import random
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "data"

KURA = {
    "name": "（仮）蔵ツイン酒造",
    "note": "架空の酒蔵。名前は作者が決めたらここだけ変える",
    "tank_capacity_l": 3000,
    "tanks": [
        # 2列×5本。x,z は蔵の中の位置（メートル）
        {"id": str(i + 1), "label": f"{i + 1}号", "row": i // 5, "col": i % 5,
         "x": (i % 5) * 3.0 - 6.0, "z": (i // 5) * 4.0 - 2.0}
        for i in range(10)
    ],
}

# タンクごとの酒の種類：(種類, 醪日数, 最高品温, 上槽時の日本酒度)
TYPES = {
    "1": ("大吟醸", 29, 10.5, 3.0), "2": ("大吟醸", 30, 10.0, 4.0),
    "3": ("純米吟醸", 27, 11.5, 2.0), "4": ("純米吟醸", 26, 11.5, 3.0),
    "5": ("純米吟醸", 27, 12.0, 1.0), "6": ("純米", 24, 13.0, 2.0),
    "7": ("純米", 24, 13.0, 3.0), "8": ("純米", 23, 13.5, 4.0),
    "9": ("本醸造", 22, 14.0, 5.0), "10": ("本醸造", 22, 14.0, 4.0),
}
RECIPE = {"soe_l": 400, "naka_l": 800, "tome_l": 1200}  # 初添・仲添・留添で加える量（L）

JOUBOU = [(2, "筋泡"), (4, "水泡"), (6, "岩泡"), (9, "高泡"), (11, "落泡"), (15, "玉泡")]


def joubou_for(day):
    for last, name in JOUBOU:
        if day <= last:
            return name
    return "地"


def r1(x):
    return round(x + 1e-9, 1)


def build_tank(tank_id, soe_date, events, rng, until=None):
    kind, length, tmax, nd_end = TYPES[tank_id]
    recs = []
    # 留添より前（初添・踊り・仲添）
    pre = [(-2, "初添", 12.0), (-1, "踊り", 13.0), (0, "仲添", 9.5)]
    for i, (d, op, t) in enumerate(pre):
        recs.append({"date": soe_date + timedelta(days=i), "moromi_day": d, "time": "08:00",
                     "operation": op, "temp": t, "baume": None, "nihonshudo": None,
                     "alcohol": None, "acidity": None, "joubou": None, "note": None})
    tome_date = soe_date + timedelta(days=3)

    temp = 7.5
    temp_offset = 0.0
    nd_shift = 0.0
    prev_nd = None
    for d in range(1, length + 1):
        ev = events.get(d, {})
        # 品温：最高品温まで1日0.3〜0.7℃ずつ上げ、終盤は少し下げる
        if d == 1:
            temp = 7.5
        elif d <= 10:
            temp = min(tmax, temp + rng.choice([0.4, 0.5, 0.6, 0.7]))
        elif d >= length - 4:
            temp = max(tmax - 2.0, temp - rng.choice([0.3, 0.4, 0.5]))
        temp_offset += ev.get("temp_delta", 0.0)
        t = r1(temp + temp_offset)

        # ボーメ：前半だけ測る（3〜4日目に最大、その後下がる）
        baume = None
        if d <= 9:
            baume = r1(max(2.5, 8.2 - 0.12 * (d - 3) ** 2 if d > 3 else 7.4 + 0.3 * d))
        # 日本酒度：8日目から測る。−30前後から上槽時の値へ、1日0.7以上は動く
        nd = None
        if d >= 8:
            frac = (d - 8) / max(1, length - 8)
            base = -30 + (nd_end + 30) * (1 - (1 - frac) ** 1.6)
            if "nd_hold_step" not in ev:
                nd_shift *= 0.75  # 停滞のあとは、少しずつ本来の切れに戻る
            nd = base + nd_shift
            if "nd_hold_step" in ev and prev_nd is not None:
                # 停滞：前日の値からほとんど動かさない
                target = prev_nd + ev["nd_hold_step"]
                nd_shift += target - nd
                nd = target
            nd = r1(nd)
            prev_nd = nd
        alcohol = r1(17.8 * (1 / (1 + math.exp(-(d - length * 0.45) / (length * 0.15))))) if d >= 3 else None
        if alcohol is not None and d == length:
            alcohol = r1(alcohol + 0.3)
        acidity = r1(1.0 + 0.6 * min(1, d / length) + (0.1 if kind in ("純米",) else 0)) if d >= 5 else None

        op = ev.get("operation")
        if d == 1:
            op = "留添"
        if d == length:
            op = "上槽"
        recs.append({"date": tome_date + timedelta(days=d - 1), "moromi_day": d, "time": "08:00",
                     "operation": op, "temp": t, "baume": baume, "nihonshudo": nd,
                     "alcohol": alcohol, "acidity": acidity, "joubou": joubou_for(d),
                     "note": ev.get("note")})

    if until:
        recs = [r for r in recs if r["date"] <= until]
    for r in recs:
        r["date"] = r["date"].isoformat()
    return {"tank": tank_id, "kind": kind, "recipe": RECIPE, "planned_days": length,
            "soe_date": soe_date.isoformat(), "records": recs}


def stall(days, step=0.3):
    """日本酒度の停滞：days の各日、前日からほとんど動かさない"""
    return {d: {"nd_hold_step": step} for d in days}


def merge(*dicts):
    out = {}
    for dct in dicts:
        for k, v in dct.items():
            out.setdefault(k, {}).update(v)
    return out


# ---- 今季（2026年1月〜2月）。今日＝2026-02-10 で記録が途切れる ----
CURRENT_START = date(2026, 1, 8)
CURRENT_TODAY = date(2026, 2, 10)
CURRENT_EVENTS = {
    # 3号：18日目に追水（過去の判断と似た状況）
    "3": merge(stall([15, 16, 17]), {18: {"operation": "追水 30L", "note": "切れ鈍い"}}),
    # 5号：今日（19日目）追水
    "5": {19: {"operation": "追水 40L", "note": "泡重い"}},
    # 6号：今日（16日目）まで日本酒度が3日間ほぼ動いていない
    "6": merge(stall([13, 14, 15, 16]), {15: {"note": "日本酒度 動き鈍い"}}),
    # 7号：今日（13日目）品温を1.5℃下げた
    "7": {13: {"temp_delta": -1.5, "note": "香り立ち早い"}},
    # 9号：5日目に暖気で品温を上げた
    "9": {5: {"temp_delta": 1.2, "operation": "暖気入れ", "note": "湧き付き遅い"}},
}

# ---- 前季（2025年1月〜2月）。全タンク上槽まで ----
PAST_START = date(2025, 1, 7)
PAST_EVENTS = {
    "1": {8: {"temp_delta": -1.0, "note": "高泡早い"}},
    "2": {20: {"operation": "追水 20L"}},
    "3": merge(stall([15, 16, 17]), {17: {"note": "日本酒度 動き鈍い"}},
               {18: {"operation": "追水 30L"}}),
    "4": {14: {"temp_delta": -1.0}},
    "5": merge(stall([10, 11, 12]), {12: {"temp_delta": 1.0, "operation": "暖気入れ"}}),
    "6": {12: {"temp_delta": -1.5, "note": "泡の盛り上がり早い"}},
    "7": {18: {"temp_delta": -1.2}},
    "8": merge(stall([10, 11, 12]), {12: {"note": "様子見"}}),
    "9": {6: {"temp_delta": 1.2, "operation": "暖気入れ"}},
    "10": {16: {"operation": "追水 50L", "note": "泡重い"}},
}

# 前季の判断メモ（下書き。作者が蔵人の経験で書き直す）
PAST_MEMOS = [
    ("3", 18, "add_water", "追水 30L",
     "3号タンク、18日目に追水30Lを入れていますね。どんな様子を見て決めましたか？",
     "15日目あたりから日本酒度が−15前後で止まって、泡も重かった。醪が締まりすぎて酵母が苦しそうだったから、少し水を打って楽にさせた。"),
    ("6", 12, "temp_change", "品温を前日から1.5℃下げた",
     "6号タンク、12日目に品温を1.5度下げていますね。どんな様子を見て決めましたか？",
     "高泡の盛り上がりが例年より2日早かった。香りが荒れる前に温度で抑えておきたかった。"),
    ("1", 8, "temp_change", "品温を前日から1.0℃下げた",
     "1号タンク、8日目に品温を1度下げていますね。どんな様子を見て決めましたか？",
     "大吟醸で高泡が早く来た。急がせると香りが逃げるので、ゆっくり行かせるために冷やした。"),
    ("8", 12, "stall", "日本酒度が3日間ほぼ動いていない（何もしなかった）",
     "8号タンク、10日目から日本酒度があまり動いていませんが、そのままにしていますね。どう見ていましたか？",
     "泡はまだ生きていて、櫂を入れた時の手応えもあった。数字は止まって見えても中は動いていると思って、2日待つことにした。"),
    ("2", 20, "add_water", "追水 20L",
     "2号タンク、20日目に追水20Lを入れていますね。どんな様子を見て決めましたか？",
     "上槽の時期に合わせて、アルコールが上がりすぎないように少しだけ打った。味見して重たさも感じた。"),
    ("9", 6, "temp_change", "暖気入れで品温を1.2℃上げた",
     "9号タンク、6日目に暖気を入れて品温を上げていますね。どんな様子を見て決めましたか？",
     "湧き付きが遅く、泡が筋泡のままだった。蔵が冷え込んだ日だったので、暖気を一本入れて起こした。"),
    ("4", 14, "temp_change", "品温を前日から1.0℃下げた",
     "4号タンク、14日目に品温を1度下げていますね。どんな様子を見て決めましたか？",
     "日本酒度の切れが計画より早かった。このまま行くと辛くなりすぎるので、少し冷やして足を遅くした。"),
    ("10", 16, "add_water", "追水 50L",
     "10号タンク、16日目に追水50Lを入れていますね。どんな様子を見て決めましたか？",
     "本醸造で泡が重く、醪が固かった。櫂が入りにくいほどだったので、多めに打った。"),
    ("5", 12, "stall", "日本酒度が3日間ほぼ動かず、暖気入れで品温を1.0℃上げた",
     "5号タンク、12日目に暖気を入れていますね。日本酒度が止まっていた時、どんな様子を見て決めましたか？",
     "泡が落ちるのが早く、元気がなかった。8号とは違って手応えも弱かったので、温度で後押しした。"),
    ("7", 18, "temp_change", "品温を前日から1.2℃下げた",
     "7号タンク、18日目に品温を1.2度下げていますね。どんな様子を見て決めましたか？",
     "上槽の段取りが2日後ろにずれたので、それまで持たせるために冷やした。"),
]


def build_season(label, start, events, until=None, seed=1):
    rng = random.Random(seed)
    tanks = []
    for i, t in enumerate(KURA["tanks"]):
        soe = start + timedelta(days=3 * i)
        tanks.append(build_tank(t["id"], soe, events.get(t["id"], {}), rng, until))
    season = {"season": label, "draft": True,
              "note": "架空のダミーデータ（作者が確認・修正する下書き）",
              "today": until.isoformat() if until else None, "tanks": tanks}
    return season


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cur = build_season("2026", CURRENT_START, CURRENT_EVENTS, CURRENT_TODAY, seed=7)
    past = build_season("2025", PAST_START, PAST_EVENTS, None, seed=3)

    by_tank = {t["tank"]: t for t in past["tanks"]}
    memos = []
    for n, (tank, day, rule, change, q, a) in enumerate(PAST_MEMOS, 1):
        rec = next(r for r in by_tank[tank]["records"] if r["moromi_day"] == day)
        memos.append({"id": f"past-{n:02d}", "season": "2025", "tank": tank, "date": rec["date"],
                      "moromi_day": day, "rule": rule, "change": change,
                      "question": q, "answer": a, "draft": True})

    for name, obj in [("kura.json", KURA), ("season-current.json", cur),
                      ("season-past.json", past),
                      ("memos-past.json", {"draft": True,
                                           "note": "前季の判断メモ（作者が蔵人の経験で書き直す下書き）",
                                           "memos": memos})]:
        (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print("wrote", OUT / name)


if __name__ == "__main__":
    main()
