using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.Rendering;

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

    [Serializable] public class TankState { public string id; public string stage; public float level; public float temp; public string joubou; public float activity; }
    [Serializable] public class DayState { public int dayIndex; public string date; public bool past; public float blend; public float tempMin = 5; public float tempMax = 16; public TankState[] tanks; }
    [Serializable] class HighlightMsg { public string id; public bool on; }
    [Serializable] class CameraMsg { public string mode; public string id; }
    [Serializable] class SayMsg { public string text; public string tank; }

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
        public ParticleSystem steam;
        public float targetActivity, activity; // 湯気の量（0〜1）
    }

    readonly Dictionary<string, Tank> tanks = new Dictionary<string, Tank>();
    Camera cam;
    Vector3 camTargetPos, camLookAt, camLookAtCurrent;
    Transform tojiHead;
    Animator tojiAnimator;
    float nodUntil;

    // 杜氏の案内：足場の上を歩いて根拠のタンクの前へ行き、若手（カメラ）へ振り向いて語る
    Transform toji;
    bool walking, guideCam;
    Vector3 walkTarget, arriveCamPos, arriveLookAt;
    float walkDir = 1f;
    string pendingText = "";
    const float WalkSpeed = 0.85f;                 // m/秒（歩く動きの足運びに合わせる）
    const float DeckMinX = -7.5f, DeckMaxX = 7.4f; // 足場の端（はしごと手すりの手前）
    const float StandZ = 0.3f;                     // 足場の中心からタンク側へ寄る量（手すりは ±0.66）

    // 時を巻き戻す：過去の記録を見ているあいだは、朝の斜めの光と少し冷たい空気にする
    Light sun;
    Light[] lamps = new Light[0];
    Renderer[] beams = new Renderer[0];
    Volume pastLook;
    Quaternion sunNowRot;
    Color sunNowColor, ambSky, ambEq, ambGround;
    float sunNowIntensity, lampNowIntensity = 1f;
    float pastTarget, pastBlend, slowUntil;
    static readonly Quaternion SunMorningRot = Quaternion.Euler(30f, 238f, 0f); // 右奥（高窓の側）から、斜めに低く差し込む
    static readonly Color SunMorningColor = new Color(0.95f, 0.97f, 1.0f);

    static Transform FindDeep(Transform t, string name)
    {
        if (t == null) return null;
        if (t.name == name) return t;
        foreach (Transform c in t) { var f = FindDeep(c, name); if (f != null) return f; }
        return null;
    }
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
                steam = r.Find("Steam")?.GetComponent<ParticleSystem>(),
            };
            t.tag.SetActive(false);
            tanks[id] = t;
        }
        // 吹き出しの位置：Tripo の杜氏なら頭の骨に付けた目印（HeadAnchor）、仮の人形なら Head
        tojiHead = FindDeep(kura.Find("Toji"), "HeadAnchor") ?? kura.Find("Toji/Head");
        tojiAnimator = kura.Find("Toji")?.GetComponentInChildren<Animator>();
        toji = kura.Find("Toji");
        sun = GameObject.Find("Daylight")?.GetComponent<Light>();
        if (sun != null) { sunNowRot = sun.transform.rotation; sunNowColor = sun.color; sunNowIntensity = sun.intensity; }
        lamps = kura.Find("Lamps") != null ? kura.Find("Lamps").GetComponentsInChildren<Light>() : new Light[0];
        if (lamps.Length > 0) lampNowIntensity = lamps[0].intensity;
        pastLook = GameObject.Find("LookPast")?.GetComponent<Volume>();
        var air = kura.Find("Air");
        if (air != null) { var list = new List<Renderer>(); foreach (Transform b in air) list.Add(b.GetComponent<Renderer>()); beams = list.ToArray(); }
        ambSky = RenderSettings.ambientSkyColor; ambEq = RenderSettings.ambientEquatorColor; ambGround = RenderSettings.ambientGroundColor;
        ready = true;
    }

    // ---------- 命令（JS → Unity） ----------
    public void SetDay(string json)
    {
        var day = JsonUtility.FromJson<DayState>(json);
        if (day?.tanks == null) return;
        pastTarget = day.past ? 1f : 0f;
        if (day.blend > 0f) slowUntil = Time.time + day.blend; // 今と過去の切り替え：液面と帯も数秒かけて当時へ
        foreach (var s in day.tanks)
        {
            if (!tanks.TryGetValue(s.id, out var t)) continue;
            t.targetLevel = Mathf.Clamp01(s.level);
            t.targetActivity = s.level > 0.001f ? Mathf.Clamp01(s.activity) : 0f;
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
        guideCam = false;
        if (msg.mode == "toji" && tanks.TryGetValue(msg.id ?? "", out var t)) SetTojiView(t);
        else SetOverview();
    }

    public void SelectTank(string id)
    {
        foreach (var t in tanks.Values) t.selected = t.id == id;
    }

    public void TojiSay(string json)
    {
        // {text, tank}。tank があれば、杜氏が歩いてそのタンクの前まで行ってから語る（古い形の文字列だけでも受ける）
        string text = json ?? "", tank = "";
        if (text.TrimStart().StartsWith("{"))
        {
            var msg = JsonUtility.FromJson<SayMsg>(text);
            text = msg?.text ?? ""; tank = msg?.tank ?? "";
        }
        if (!string.IsNullOrEmpty(tank) && toji != null && tanks.TryGetValue(tank, out var t) && !string.IsNullOrEmpty(text))
        {
            StartGuide(t, text);
            return;
        }
        Speak(text);
    }

    void StartGuide(Tank t, string text)
    {
        var p = t.root.position;
        float side = p.z < 0 ? -1f : 1f; // 足場から見たタンクの側
        walkTarget = new Vector3(Mathf.Clamp(p.x, DeckMinX, DeckMaxX), KuraScene.DeckHeight, side * StandZ);
        float dx = walkTarget.x - toji.position.x;
        if (Mathf.Abs(dx) > 0.05f) walkDir = Mathf.Sign(dx);
        // 着いたときのカメラ：来た方向の少し後ろ、足場の反対側から、杜氏とタンクの両方が入る位置
        arriveCamPos = new Vector3(walkTarget.x - walkDir * 2.3f, KuraScene.DeckHeight + 2.3f, -side * 0.45f);
        arriveLookAt = new Vector3(walkTarget.x + walkDir * 0.15f, KuraScene.DeckHeight - 0.35f, side * 1.25f);
        pendingText = text;
        Speak(""); // 歩いているあいだは吹き出しを出さない
        walking = true;
        guideCam = true;
        overview = false;
        targetFov = 50f;
    }

    void UpdateToji(float dt)
    {
        if (toji == null) return;
        if (walking)
        {
            var to = walkTarget - toji.position; to.y = 0f;
            float dist = to.magnitude;
            if (dist < 0.03f)
            {
                walking = false;
                toji.position = walkTarget;
                Speak(pendingText);
                pendingText = "";
            }
            else
            {
                var step = to / dist * Mathf.Min(dist, WalkSpeed * dt);
                var next = toji.position + step;
                // 足場から落ちない・手すりをすり抜けない：足場の上の通れる範囲に閉じ込める
                next.x = Mathf.Clamp(next.x, DeckMinX, DeckMaxX);
                next.z = Mathf.Clamp(next.z, -StandZ, StandZ);
                next.y = KuraScene.DeckHeight;
                toji.position = next;
                Turn(Quaternion.LookRotation(to / dist), dt);
            }
        }
        else if (guideCam && cam != null)
        {
            // 着いたら若手（カメラ）の方へ振り向く
            var look = cam.transform.position - toji.position; look.y = 0f;
            if (look.sqrMagnitude > 0.01f) Turn(Quaternion.LookRotation(look.normalized), dt);
        }
        if (tojiAnimator != null) tojiAnimator.SetBool("Walking", walking);

        if (guideCam)
        {
            if (walking)
            {
                // 杜氏の後ろを少し離れて追う
                var fwd = toji.forward; fwd.y = 0f; fwd.Normalize();
                camTargetPos = toji.position - fwd * 2.8f + Vector3.up * 1.9f;
                camLookAt = toji.position + fwd * 2.2f + Vector3.up * 0.7f;
            }
            else
            {
                camTargetPos = arriveCamPos;
                camLookAt = arriveLookAt;
            }
        }
    }

    void Turn(Quaternion want, float dt) => toji.rotation = Quaternion.RotateTowards(toji.rotation, want, 240f * dt);

    void Speak(string text)
    {
        bubbleText = text ?? "";
        // 話すあいだ、小さくうなずく（Update でうなずきの層の重みを上げる）
        nodUntil = string.IsNullOrEmpty(bubbleText) ? 0f : Time.time + Mathf.Clamp(bubbleText.Length * 0.12f, 3f, 12f);
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

    void UpdatePast(float dt)
    {
        pastBlend = Mathf.MoveTowards(pastBlend, pastTarget, dt / 2.8f);
        float e = Mathf.SmoothStep(0f, 1f, pastBlend);
        if (sun != null)
        {
            sun.transform.rotation = Quaternion.Slerp(sunNowRot, SunMorningRot, e);
            sun.color = Color.Lerp(sunNowColor, SunMorningColor, e);
            sun.intensity = Mathf.Lerp(sunNowIntensity, 2.1f, e);
        }
        foreach (var l in lamps) l.intensity = Mathf.Lerp(lampNowIntensity, lampNowIntensity * 0.45f, e);
        RenderSettings.ambientSkyColor = Color.Lerp(ambSky, new Color(0.42f, 0.45f, 0.5f), e);
        RenderSettings.ambientEquatorColor = Color.Lerp(ambEq, new Color(0.3f, 0.32f, 0.35f), e);
        RenderSettings.ambientGroundColor = Color.Lerp(ambGround, new Color(0.14f, 0.14f, 0.15f), e);
        if (pastLook != null) pastLook.weight = e;
        // 光の筋：ふだんはごく控えめ、過去（朝）は少しはっきり
        if (beams.Length > 0)
        {
            mpb.Clear();
            // 明るさは色だけで変える（透明度まで下げると見えなくなる）
            var c = Color.Lerp(new Color(1f, 0.9f, 0.75f) * 0.2f, new Color(0.85f, 0.92f, 1f) * 0.65f, e); c.a = 1f;
            mpb.SetColor(BaseColorId, c);
            foreach (var b in beams) b.SetPropertyBlock(mpb);
        }
    }

    /// <summary>エディタでの確認用：過去（朝の光）の見た目にする</summary>
    public void PreviewPast(bool past) { pastTarget = pastBlend = past ? 1f : 0f; UpdatePast(0f); }

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
            // 湯気：液面の少し上から、発酵の盛りほど少し多く（ごく薄く）
            if (t.steam != null)
            {
                t.activity = k > 0f ? Mathf.Lerp(t.activity, t.targetActivity, k) : t.targetActivity;
                var em = t.steam.emission; em.rateOverTime = t.activity * 5f;
                var sp = t.steam.transform.localPosition;
                sp.y = KuraScene.PlinthHeight + KuraScene.TankHeight * Mathf.Max(0.05f, t.level) * 0.96f + 0.05f;
                t.steam.transform.localPosition = sp;
            }

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
        // 今と過去の切り替えのあいだは、液面と帯をゆっくり当時の状態へ
        float kTank = Time.time < slowUntil ? 1f - Mathf.Exp(-Time.deltaTime * 1.1f) : k;
        UpdateTanks(kTank, pulse);
        UpdatePast(Time.deltaTime);
        UpdateToji(Time.deltaTime);

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

        // 話すあいだだけ、うなずきの層（首と頭）をふわっと効かせる
        if (tojiAnimator != null && tojiAnimator.layerCount > 1)
            tojiAnimator.SetLayerWeight(1, Mathf.MoveTowards(tojiAnimator.GetLayerWeight(1), Time.time < nodUntil ? 1f : 0f, Time.deltaTime * 3f));

        // 吹き出しの位置を Web 側へ（日本語の文字は HTML で描く）
        if (!string.IsNullOrEmpty(bubbleText) && cam != null && tojiHead != null)
        {
            if (Time.time > bubbleUntil) { bubbleText = ""; KuraBubble("", 0, 0, 0); }
            else
            {
                var sp = cam.WorldToScreenPoint(tojiHead.position + Vector3.up * 0.3f);
                bool visible = sp.z > 0;
                KuraBubble(bubbleText, sp.x / Screen.width, sp.y / Screen.height, visible ? 1 : 0);
            }
        }
    }
}
