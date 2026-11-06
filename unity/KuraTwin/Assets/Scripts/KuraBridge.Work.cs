using System.Globalization;
using System.Runtime.InteropServices;
using UnityEngine;

// 蔵ツイン：杜氏の見回りの作業。変化のあったタンクの前で、
// ①長い櫂を差し入れて数回かき混ぜる（櫂入れ・液面が少し揺れる）→ ②温度計を差して目盛りを見る（吹き出しに品温）→ ③手元の帳面に書き込む。
// 櫂・温度計・帳面と鉛筆は Unity の中で作り、腕の向きを計算して（2関節の IK）手に持たせる。
// 道具は「実際の手の位置」から毎フレーム置き直すので、手と道具がずれない。差し入れる角度は、縁の内側を通り、手すりの上を越えるように決めてある。
public partial class KuraBridge
{
#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")] static extern void KuraPatrol(string id, string step, string temp);
#else
    static void KuraPatrol(string id, string step, string temp) { Debug.Log($"[Kura] 見回り {id} {step} {temp}"); }
#endif

    enum WorkPhase { None, Kai, Temp, Write }
    WorkPhase work = WorkPhase.None;
    float workStart;
    Tank workTank;
    Transform kaiTool, thermoTool, thermoRod, bookTool, pencilTool;
    Transform rUpper, rFore, rHand, lUpper, lFore, lHand;
    float armWeight; // 0〜1：作業中だけ腕を道具に合わせる
    string workBubble = "";
    float workBubbleUntil;
    const float KaiTime = 6f, TempTime = 4.2f, WriteTime = 3.6f;

    void InitWork(Transform model)
    {
        if (model == null) return;
        rUpper = FindDeep(model, "R_Upperarm"); rFore = FindDeep(model, "R_Forearm"); rHand = FindDeep(model, "R_Hand");
        lUpper = FindDeep(model, "L_Upperarm"); lFore = FindDeep(model, "L_Forearm"); lHand = FindDeep(model, "L_Hand");
        var tools = new GameObject("Tools").transform;
        tools.SetParent(toji.parent, false); // 杜氏の体とは別に、毎フレーム手の位置へ置く

        // 櫂：長い柄と、先の板
        kaiTool = new GameObject("Kai").transform; kaiTool.SetParent(tools, false);
        Part(kaiTool, PrimitiveType.Cylinder, new Vector3(0, 1.65f, 0), new Vector3(0.04f, 1.6f, 0.04f), palette.plank);
        Part(kaiTool, PrimitiveType.Cube, new Vector3(0, 0.12f, 0), new Vector3(0.24f, 0.26f, 0.03f), palette.plank);
        // 温度計：細い棒（長さは実行時に合わせる）と、上の目盛りの板
        thermoTool = new GameObject("Thermometer").transform; thermoTool.SetParent(tools, false);
        thermoRod = Part(thermoTool, PrimitiveType.Cylinder, new Vector3(0, 0.5f, 0), new Vector3(0.018f, 0.5f, 0.018f), palette.steel).transform;
        Part(thermoTool, PrimitiveType.Cube, Vector3.zero, new Vector3(0.07f, 0.16f, 0.02f), palette.shide).name = "Gauge";
        // 帳面（開いた2枚）と鉛筆
        bookTool = new GameObject("Notebook").transform; bookTool.SetParent(tools, false);
        Part(bookTool, PrimitiveType.Cube, new Vector3(-0.1f, 0, 0), new Vector3(0.2f, 0.27f, 0.012f), palette.paperTag);
        Part(bookTool, PrimitiveType.Cube, new Vector3(0.1f, 0, 0), new Vector3(0.2f, 0.27f, 0.012f), palette.paperTag);
        Part(bookTool, PrimitiveType.Cube, new Vector3(0, 0, 0.008f), new Vector3(0.42f, 0.29f, 0.006f), palette.tojiCloth);
        pencilTool = new GameObject("Pencil").transform; pencilTool.SetParent(tools, false);
        Part(pencilTool, PrimitiveType.Cylinder, new Vector3(0, 0.07f, 0), new Vector3(0.012f, 0.07f, 0.012f), palette.wood);
        ShowTools(WorkPhase.None);
    }

    static GameObject Part(Transform parent, PrimitiveType type, Vector3 pos, Vector3 scale, Material mat)
    {
        var g = GameObject.CreatePrimitive(type);
        Destroy(g.GetComponent<Collider>());
        g.transform.SetParent(parent, false);
        g.transform.localPosition = pos; g.transform.localScale = scale;
        g.GetComponent<Renderer>().sharedMaterial = mat;
        return g;
    }

    void ShowTools(WorkPhase p)
    {
        if (kaiTool == null) return;
        kaiTool.gameObject.SetActive(p == WorkPhase.Kai);
        thermoTool.gameObject.SetActive(p == WorkPhase.Temp);
        bookTool.gameObject.SetActive(p == WorkPhase.Write);
        pencilTool.gameObject.SetActive(p == WorkPhase.Write);
    }

    bool Working => work != WorkPhase.None;

    void StartWork(Tank t)
    {
        if (rHand == null || lHand == null) { work = WorkPhase.None; return; } // 仮の人形には腕が無い
        workTank = t;
        SetPhase(WorkPhase.Kai);
    }

    void SetPhase(WorkPhase p)
    {
        work = p;
        workStart = Time.time;
        ShowTools(p);
        string id = workTank?.id ?? "";
        switch (p)
        {
            case WorkPhase.Kai: KuraPatrol(id, "kai", ""); break;
            case WorkPhase.Temp: KuraPatrol(id, "temp", TempText()); break;
            case WorkPhase.Write: KuraPatrol(id, "write", TempText()); break;
            case WorkPhase.None: KuraPatrol(id, "done", ""); break;
        }
    }

    string TempText() => workTank != null && workTank.temp > -100f ? workTank.temp.ToString("0.0", CultureInfo.InvariantCulture) + "℃" : "";

    /// <summary>案内（若手の質問）が来たら、作業をやめて道具をしまう</summary>
    void AbortWork()
    {
        if (!Working) return;
        work = WorkPhase.None;
        ShowTools(WorkPhase.None);
        workBubble = "";
        if (workTank?.liquid != null) workTank.liquid.localRotation = Quaternion.identity;
        KuraPatrol(workTank?.id ?? "", "done", "");
    }

    /// <summary>見回りの立ち止まりの間に呼ぶ。作業が終わったら false</summary>
    bool UpdateWork()
    {
        if (!Working) return false;
        float t = Time.time - workStart;
        switch (work)
        {
            case WorkPhase.Kai:
                leanTarget = 0.3f;
                if (t > KaiTime) { if (workTank.liquid != null) workTank.liquid.localRotation = Quaternion.identity; SetPhase(WorkPhase.Temp); }
                break;
            case WorkPhase.Temp:
                leanTarget = 0.8f;
                if (t > 1.6f && string.IsNullOrEmpty(workBubble)) { workBubble = TempText(); workBubbleUntil = Time.time + 2.4f; } // 目盛りを読んだところで品温を小さく出す
                if (t > TempTime) SetPhase(WorkPhase.Write);
                break;
            case WorkPhase.Write:
                leanTarget = 0.35f;
                if (t > WriteTime) { SetPhase(WorkPhase.None); workBubble = ""; return false; }
                break;
        }
        return true;
    }

    // ---------- LateUpdate：腕を道具の握りへ、道具を手の位置へ ----------
    void LateUpdateWork()
    {
        armWeight = Mathf.MoveTowards(armWeight, Working ? 1f : 0f, Time.deltaTime * 2.5f);
        if (!Working || workTank == null || rHand == null) return;
        float t = Time.time - workStart;
        var P = toji.position;
        var F = toji.forward; F.y = 0f; F.Normalize();
        var Rt = Vector3.Cross(Vector3.up, F);
        var c = workTank.root.position;
        float liquidY = KuraScene.PlinthHeight + KuraScene.TankHeight * Mathf.Max(0.2f, workTank.level) * 0.96f;
        var center = new Vector3(c.x, liquidY, c.z);

        switch (work)
        {
            case WorkPhase.Kai:
            {
                // 櫂入れ：櫂をほぼ縦にしてタンクに差し入れ、胸から腰の高さで両手で握り、上下に突いたり引いたりする（6秒で4回ほど）
                float stroke = 0.12f * Mathf.Sin(t / KaiTime * Mathf.PI * 2f * 4f);
                var c2 = new Vector3(c.x, 0f, c.z);
                var toTank = (c2 - new Vector3(P.x, 0f, P.z)).normalized;
                var tip0 = new Vector3(c.x, liquidY - 0.25f, c.z) - toTank * 0.45f; // 縁の内側、杜氏寄り
                var hand0 = P + Vector3.up * 0.88f + F * 0.24f + Rt * 0.04f; // 右手：腰の高さ
                var dir = (hand0 - tip0).normalized;                                  // 上（手の側）向き。縦から20°ほど
                var tip = tip0 + dir * stroke;
                Solve(rUpper, rFore, rHand, hand0 + dir * stroke, P + Vector3.up * 0.75f + Rt * 0.45f - F * 0.15f);
                var hr = HandPoint(rFore, rHand);
                var axis = (hr - tip).normalized;
                Solve(lUpper, lFore, lHand, hr + axis * 0.27f - Rt * 0.02f, P + Vector3.up * 0.95f - Rt * 0.45f - F * 0.15f); // 左手：胸の高さ
                PlaceAlong(kaiTool, tip - axis * 0.05f, axis);
                // 突くたびに液面が少し揺れる
                if (workTank.liquid != null) workTank.liquid.localRotation = Quaternion.Euler(stroke * 9f, 0, stroke * 5f);
                break;
            }
            case WorkPhase.Temp:
            {
                // 温度計：先を縁の内側から醪へ差し、上の目盛りを右手で持つ
                float dip = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(t / 1.2f));
                var tip = center - F * 0.15f - Vector3.up * (0.05f + 0.25f * dip);
                Solve(rUpper, rFore, rHand, P + Vector3.up * 1.18f + F * 0.38f + Rt * 0.06f, P + Vector3.up * 0.9f + Rt * 0.45f - F * 0.2f);
                RestArm(lUpper, lFore, lHand);
                var hr = HandPoint(rFore, rHand);
                var dir = (hr - tip);
                float len = dir.magnitude; dir /= len;
                thermoTool.position = tip;
                thermoTool.rotation = Quaternion.FromToRotation(Vector3.up, dir);
                thermoRod.localScale = new Vector3(0.018f, len / 2f, 0.018f);
                thermoRod.localPosition = new Vector3(0, len / 2f, 0);
                var gauge = thermoTool.Find("Gauge");
                gauge.localPosition = new Vector3(0, len + 0.09f, 0);
                break;
            }
            case WorkPhase.Write:
            {
                // 帳面を左手で胸の前に持ち、右手の鉛筆で書く
                var book = P + Vector3.up * 1.2f + F * 0.25f - Rt * 0.02f;
                Solve(lUpper, lFore, lHand, book - Rt * 0.17f, P + Vector3.up * 0.8f - Rt * 0.5f);
                var hl = HandPoint(lFore, lHand);
                var bookCenter = hl + Rt * 0.17f;
                var faceDir = (P + Vector3.up * 1.55f - bookCenter).normalized; // 顔の方へ少し傾ける
                bookTool.position = bookCenter;
                bookTool.rotation = Quaternion.LookRotation(-faceDir, Vector3.up);
                var page = bookCenter + Rt * (0.06f + 0.05f * Mathf.Sin(t * 5f)) + Vector3.up * (0.06f - 0.03f * (t % 1.2f)) + faceDir * 0.012f;
                Solve(rUpper, rFore, rHand, page + faceDir * 0.1f + Vector3.up * 0.04f, P + Vector3.up * 0.8f + Rt * 0.5f);
                var hr = HandPoint(rFore, rHand);
                PlaceAlong(pencilTool, page, (hr - page).normalized);
                pencilTool.localScale = new Vector3(1f, Vector3.Distance(hr, page) / 0.14f, 1f);
                break;
            }
        }
    }

    // 手のひらのあたり（手首から少し先）
    static Vector3 HandPoint(Transform fore, Transform hand) => hand.position + (hand.position - fore.position).normalized * 0.07f;

    static void PlaceAlong(Transform tool, Vector3 bottom, Vector3 dir)
    {
        tool.position = bottom;
        tool.rotation = Quaternion.FromToRotation(Vector3.up, dir);
    }

    // だらりと下げた腕（作業で使わない方の手）は、アニメーションのまま
    void RestArm(Transform u, Transform f, Transform h) { }

    // 2関節の IK：肩→肘→手首を、手が target に届くように回す（pole の側に肘を曲げる）
    void Solve(Transform upper, Transform fore, Transform hand, Vector3 target, Vector3 pole)
    {
        if (upper == null || fore == null || hand == null || armWeight <= 0f) return;
        var A = upper.position; var B = fore.position; var C = hand.position;
        float la = Vector3.Distance(A, B), lb = Vector3.Distance(B, C);
        var toT = target - A;
        float d = Mathf.Clamp(toT.magnitude, 0.05f, la + lb - 0.002f);
        var dirT = toT.normalized;
        float x = (la * la - lb * lb + d * d) / (2f * d);
        float h = Mathf.Sqrt(Mathf.Max(0f, la * la - x * x));
        var poleDir = Vector3.ProjectOnPlane(pole - A, dirT).normalized;
        var elbow = A + dirT * x + poleDir * h;
        var u0 = upper.rotation;
        upper.rotation = Quaternion.Slerp(u0, Quaternion.FromToRotation(B - A, elbow - A) * u0, armWeight);
        B = fore.position; C = hand.position;
        var f0 = fore.rotation;
        fore.rotation = Quaternion.Slerp(f0, Quaternion.FromToRotation(C - B, A + dirT * d - B) * f0, armWeight);
    }
}
