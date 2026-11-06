using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using UnityEngine;

// 蔵ツイン：Webの右側から届く5つの命令（SetDay / HighlightTank / SetCamera / SelectTank / TojiSay）を受けて、
// 3Dの蔵を動かす。蔵の形はエディタで組み立ててシーンに保存してある（KuraScene）。
// データは持たない（毎回 JS から JSON で受け取る）。醸造の判断もしない。
public class KuraBridge : MonoBehaviour
{
    [Header("材質（エディタの「シーンを用意」で設定）")]
    public KuraPalette palette = new KuraPalette();

    // --- JS 側の関数（Plugins/WebGL/KuraBridge.jslib） ---
#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")] static extern void KuraReady();
    [DllImport("__Internal")] static extern void KuraTankClicked(string id);
    [DllImport("__Internal")] static extern void KuraBubble(string text, float x, float y, int visible);
#else
    static void KuraReady() { Debug.Log("[Kura] ready"); }
    static void KuraTankClicked(string id) { Debug.Log("[Kura] clicked " + id); }
    static void KuraBubble(string text, float x, float y, int visible) { if (visible == 1 && text != null) Debug.Log("[Kura] toji: " + text); }
#endif

    [Serializable] public class TankState { public string id; public string stage; public float level; public float temp; public string joubou; }
    [Serializable] public class DayState { public int dayIndex; public string date; public float tempMin = 5; public float tempMax = 16; public TankState[] tanks; }
    [Serializable] class HighlightMsg { public string id; public bool on; }
    [Serializable] class CameraMsg { public string mode; public string id; }

    class Tank
    {
        public string id;
        public Transform root, liquid;
        public Renderer band, rimGlow, floorGlow;
        public GameObject tag;
        public TextMesh tagText;
        public float targetLevel, level;
        public float temp = -999f;
        public Color targetBand = BandNeutral, bandColor = BandNeutral;
        public bool highlighted, selected;
        public float glow; // 0〜1（ふわっと点く）
    }

    readonly Dictionary<string, Tank> tanks = new Dictionary<string, Tank>();
    Camera cam;
    Vector3 camTargetPos, camLookAt, camLookAtCurrent;
    Transform tojiHead;
    string bubbleText = "";
    float bubbleUntil;
    MaterialPropertyBlock mpb;
    bool ready;

    static readonly Color BandNeutral = new Color(0.55f, 0.55f, 0.53f);
    static readonly Color BandCool = new Color(0.22f, 0.4f, 0.62f);    // 低い品温：くすんだ藍
    static readonly Color BandWarm = new Color(0.86f, 0.42f, 0.16f);   // 高い品温：くすんだ柿色
    static readonly Color GlowAlert = new Color(1.0f, 0.42f, 0.1f);    // 変化あり：灯りの色
    static readonly Color GlowSelect = new Color(0.95f, 0.88f, 0.70f); // 選択：やわらかい白
    static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
    static readonly int EmissionId = Shader.PropertyToID("_EmissionColor");

    void Awake()
    {
        Init();
        SetOverview();
        if (cam != null) { cam.transform.position = camTargetPos; camLookAtCurrent = camLookAt; cam.transform.LookAt(camLookAt); }
    }

    void Start() { KuraReady(); }

    /// <summary>シーンに保存された蔵から、動かす部品を探す（無ければ組み立てる）</summary>
    public void Init()
    {
        if (ready) return;
        mpb = new MaterialPropertyBlock();
        cam = Camera.main;
        // TextMesh（番号・温度の札）は、奥行きで隠れる文字の材質で描く。文字の画像（動的フォント）は作り直されることがあるので追いかける
        var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        if (palette.text != null)
        {
            palette.text.mainTexture = font.material.mainTexture;
            Font.textureRebuilt += f => { if (f == font) palette.text.mainTexture = f.material.mainTexture; };
        }
        var kura = transform.Find("Kura") ?? KuraScene.Build(transform, palette, null, null);
        tanks.Clear();
        for (int i = 0; i < KuraScene.TankCount; i++)
        {
            string id = (i + 1).ToString();
            var r = kura.Find("Tanks/Tank" + id);
            if (r == null) continue;
            var t = new Tank
            {
                id = id, root = r,
                liquid = r.Find("Liquid"),
                band = r.Find("Band").GetComponent<Renderer>(),
                rimGlow = r.Find("RimGlow").GetComponent<Renderer>(),
                floorGlow = r.Find("FloorGlow").GetComponent<Renderer>(),
                tag = r.Find("Tag").gameObject,
                tagText = r.Find("Tag/TagText").GetComponent<TextMesh>(),
            };
            t.tag.SetActive(false);
            tanks[id] = t;
        }
        tojiHead = kura.Find("Toji/Head");
        ready = true;
    }

    // ---------- 命令（JS → Unity） ----------
    public void SetDay(string json)
    {
        var day = JsonUtility.FromJson<DayState>(json);
        if (day?.tanks == null) return;
        foreach (var s in day.tanks)
        {
            if (!tanks.TryGetValue(s.id, out var t)) continue;
            t.targetLevel = Mathf.Clamp01(s.level);
            t.temp = s.temp;
            t.targetBand = BandColor(s.temp, day.tempMin, day.tempMax);
            bool has = s.temp > -100f && s.level > 0.001f;
            t.tag.SetActive(has);
            if (has) t.tagText.text = s.temp.ToString("0.0", CultureInfo.InvariantCulture) + "°C";
        }
    }

    public void HighlightTank(string json)
    {
        var msg = JsonUtility.FromJson<HighlightMsg>(json);
        if (msg != null && tanks.TryGetValue(msg.id, out var t)) t.highlighted = msg.on;
    }

    public void SetCamera(string json)
    {
        var msg = JsonUtility.FromJson<CameraMsg>(json);
        if (msg == null) return;
        if (msg.mode == "toji" && tanks.TryGetValue(msg.id ?? "", out var t)) SetTojiView(t);
        else SetOverview();
    }

    public void SelectTank(string id)
    {
        foreach (var t in tanks.Values) t.selected = t.id == id;
    }

    public void TojiSay(string text)
    {
        bubbleText = text ?? "";
        bubbleUntil = Time.time + Mathf.Clamp(bubbleText.Length * 0.25f, 6f, 40f);
        if (string.IsNullOrEmpty(bubbleText)) KuraBubble("", 0, 0, 0);
    }

    // ---------- 表示 ----------
    // 品温は帯の色で控えめに：低い＝くすんだ藍、高い＝くすんだ柿色。温度が無い＝灰
    public static Color BandColor(float temp, float min, float max)
    {
        if (temp < -100f) return BandNeutral;
        return Color.Lerp(BandCool, BandWarm, Mathf.InverseLerp(min, max, temp));
    }

    bool overview = true;

    float targetFov = 40f;

    void SetOverview()
    {
        overview = true;
        targetFov = 40f;
        // 蔵の前から見下ろす。横は10本＋足場が入る距離まで引き、縦は手前の床が画面の下端ぎりぎりに来るように置く
        // （縦長の画面でも手前の空いた床が間延びしない）
        float aspect = cam != null ? cam.aspect : 1.6f;
        float vfov = (cam != null ? cam.fieldOfView : 40f) * Mathf.Deg2Rad;
        float hfov = 2f * Mathf.Atan(Mathf.Tan(vfov / 2f) * aspect);
        float pitch = Mathf.Lerp(47f, 36f, Mathf.InverseLerp(1.1f, 1.9f, aspect)) * Mathf.Deg2Rad; // 縦長ほど上から
        float axial = Mathf.Max(11f, 8.6f / Mathf.Tan(hfov / 2f)); // 手前の列までの、視線方向の距離
        float bottomRay = pitch + vfov / 2f * 0.86f;               // 画面の下端より少し内側を通る視線
        var floorFront = new Vector3(-0.3f, 0f, -3.5f);            // 手前の列のすぐ前の床
        float t = axial / Mathf.Cos(bottomRay - pitch);
        camTargetPos = floorFront + new Vector3(0, Mathf.Sin(bottomRay), -Mathf.Cos(bottomRay)) * t;
        camLookAt = camTargetPos + new Vector3(0, -Mathf.Sin(pitch), Mathf.Cos(pitch)) * 12f;
    }

    void SetTojiView(Tank t)
    {
        overview = false;
        targetFov = 52f;
        // 足場（2列の間の通路）に立った人が、縁越しに覗き込む目の位置
        var p = t.root.position;
        float toward = p.z < 0 ? 1f : -1f; // タンクから足場へ向かう向き
        camTargetPos = new Vector3(p.x + 0.5f, KuraScene.DeckHeight + KuraScene.EyeHeight, p.z + toward * 1.55f); // 足場の端（縁の手前）に立つ
        float liquidY = KuraScene.PlinthHeight + KuraScene.TankHeight * Mathf.Max(0.3f, t.level) * 0.96f;
        camLookAt = new Vector3(p.x, liquidY, p.z - toward * 0.35f);
    }

    /// <summary>エディタでの確認用：補間せずに今の状態をそのまま見せる</summary>
    public void ApplyInstant(float pulse = 0.6f)
    {
        foreach (var t in tanks.Values) { t.level = t.targetLevel; t.bandColor = t.targetBand; t.glow = (t.highlighted || t.selected) ? 1f : 0f; }
        UpdateTanks(0f, pulse);
        if (cam != null) { cam.fieldOfView = targetFov; cam.transform.position = camTargetPos; camLookAtCurrent = camLookAt; cam.transform.LookAt(camLookAt); }
    }

    public void PreviewCamera(string mode, string id)
    {
        if (mode == "toji" && tanks.TryGetValue(id, out var t)) SetTojiView(t); else SetOverview();
    }

    void UpdateTanks(float k, float pulse)
    {
        foreach (var t in tanks.Values)
        {
            if (k > 0f)
            {
                t.level = Mathf.Lerp(t.level, t.targetLevel, k);
                t.bandColor = Color.Lerp(t.bandColor, t.targetBand, k);
                t.glow = Mathf.Lerp(t.glow, (t.highlighted || t.selected) ? 1f : 0f, k);
            }
            if (t.liquid != null) KuraScene.SetLiquid(t.liquid, t.level);

            mpb.Clear();
            mpb.SetColor(BaseColorId, t.bandColor);
            t.band.SetPropertyBlock(mpb);

            // 変化あり：縁と足元がゆっくり明滅する灯り色。選択だけ：足元がやわらかい白
            bool on = t.glow > 0.01f;
            t.rimGlow.enabled = on && t.highlighted;
            t.floorGlow.enabled = on;
            if (on)
            {
                float breathe = 0.65f + 0.35f * pulse;
                Color c = t.highlighted ? GlowAlert : GlowSelect;
                mpb.Clear();
                mpb.SetColor(BaseColorId, c * 0.2f);
                mpb.SetColor(EmissionId, c * (t.highlighted ? 2.0f * breathe : 0.7f) * t.glow);
                t.rimGlow.SetPropertyBlock(mpb);
                mpb.Clear(); // 足元：床に細い灯りの輪
                mpb.SetColor(BaseColorId, c * 0.2f);
                mpb.SetColor(EmissionId, c * (t.highlighted ? 1.6f * breathe : 0.9f) * t.glow);
                t.floorGlow.SetPropertyBlock(mpb);
            }
        }
    }

    void Update()
    {
        float k = 1f - Mathf.Exp(-Time.deltaTime * 4f);
        float pulse = 0.5f + 0.5f * Mathf.Sin(Time.time * 2.2f);
        UpdateTanks(k, pulse);

        if (cam != null)
        {
            if (overview) SetOverview(); // 画面の大きさが変わっても全体が入るように
            cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, targetFov, k);
            cam.transform.position = Vector3.Lerp(cam.transform.position, camTargetPos, k);
            camLookAtCurrent = Vector3.Lerp(camLookAtCurrent, camLookAt, k);
            cam.transform.LookAt(camLookAtCurrent);
        }

        // クリックでタンクを選ぶ
        if (Input.GetMouseButtonDown(0) && cam != null)
        {
            if (Physics.Raycast(cam.ScreenPointToRay(Input.mousePosition), out var hit, 100f))
            {
                var target = hit.collider.GetComponent<TankClickTarget>();
                if (target != null) KuraTankClicked(target.tankId);
            }
        }

        // 吹き出しの位置を Web 側へ（日本語の文字は HTML で描く）
        if (!string.IsNullOrEmpty(bubbleText) && cam != null && tojiHead != null)
        {
            if (Time.time > bubbleUntil) { bubbleText = ""; KuraBubble("", 0, 0, 0); }
            else
            {
                var sp = cam.WorldToScreenPoint(tojiHead.position + Vector3.up * 0.35f);
                bool visible = sp.z > 0;
                KuraBubble(bubbleText, sp.x / Screen.width, sp.y / Screen.height, visible ? 1 : 0);
            }
        }
    }
}
