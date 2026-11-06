using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.Rendering;

// 蔵ツイン：Webの右側から届く5つの命令（SetDay / HighlightTank / SetCamera / SelectTank / TojiSay）を受けて、
// 3Dの蔵を動かす。蔵の形はエディタで組み立ててシーンに保存してある（KuraScene）。
// データは持たない（毎回 JS から JSON で受け取る）。醸造の判断もしない。
public partial class KuraBridge : MonoBehaviour
{
    [Header("材質（エディタの「シーンを用意」で設定）")]
    public KuraPalette palette = new KuraPalette();

    // --- JS 側の関数（Plugins/WebGL/KuraBridge.jslib） ---
#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")] static extern void KuraReady();
    [DllImport("__Internal")] static extern void KuraTankClicked(string id);
    // x, y：頭の中心（画面の割合、y は下から）。mx, my：口元。r：頭の半径（画面の高さに対する割合）
    [DllImport("__Internal")] static extern void KuraBubble(string text, float x, float y, int visible, float mx = 0, float my = 0, float r = 0);
#else
    static void KuraReady() { Debug.Log("[Kura] ready"); }
    static void KuraTankClicked(string id) { Debug.Log("[Kura] clicked " + id); }
    static void KuraBubble(string text, float x, float y, int visible, float mx = 0, float my = 0, float r = 0) { if (visible == 1 && text != null) Debug.Log("[Kura] toji: " + text); }
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
        public ParticleSystem aroma, bubbles; // 香りの粒・醪の表面の泡
        public Renderer liquidRenderer;
        public float phase; // 表面の動きをタンクごとにずらす
        public GameObject cover; // 空のタンクにかける覆い
        public float targetActivity, activity; // 発酵の盛り（0〜1）：香りの粒と泡の量
    }

    readonly Dictionary<string, Tank> tanks = new Dictionary<string, Tank>();
    Camera cam;
    Vector3 camTargetPos, camLookAt, camLookAtCurrent;
    Transform tojiHead;
    Animator tojiAnimator;
    float nodUntil;

    // 杜氏の案内：足場の上を歩いて根拠のタンクの前へ行き、蔵人（カメラ）へ振り向いて語る
    Transform toji;
    bool walking, guideCam;
    Vector3 walkTarget, arriveCamPos, arriveLookAt;
    float walkDir = 1f;
    string pendingText = "";
    const float WalkSpeed = 0.85f;                 // m/秒（歩く動きの足運びに合わせる）
    const float DeckMinX = -7.5f, DeckMaxX = 7.4f; // 足場の端（はしごと手すりの手前）
    const float StandZ = 0.3f;                     // 足場の中心からタンク側へ寄る量（手すりは ±0.66）

    // ふだんの見回り：足場をゆっくり歩き、変化のあったタンクの前で立ち止まって、少し前かがみで中を覗き込む。
    // 蔵人の質問の案内（guiding）と、話しているあいだは止める。カメラは動かさない
    bool guiding, patrolMoving, patrolPeek;
    Vector3 patrolTarget;
    Quaternion patrolFace;
    float patrolWaitUntil, resumePatrolAt, lean, leanTarget;
    int patrolStep;
    Tank patrolTank;      // 見回りで向かっている、変化のあったタンク
    bool pendingWork;     // 着いて向きがそろったら作業を始める
    Transform spineBone, headBone;
    const float PatrolSpeed = 0.45f;
    const float WorkStandZ = 0.45f; // 作業のときの立ち位置（手すりは ±0.66。体の前が手すりに触れるくらい）
    readonly System.Random patrolRng = new System.Random(7);

    // 自由なカメラ：ドラッグで回転、スクロール（ピンチ）で拡大・縮小、右ドラッグ（2本指）で平行移動。
    // 「蔵全体」「杜氏の目線」「杜氏の案内」は自動のカメラ。利用者が触った時点で自由なカメラに切り替わる
    bool freeCam, pressing;
    Vector3 pivot, pivotTarget;
    float yaw, yawTarget, pitch, pitchTarget, dist, distTarget;
    Vector2 lastPointer, downPointer;
    float dragAmount;
    float lastPinch = -1f;
    static readonly Vector3 CamMin = new Vector3(-11.2f, 0.7f, -22f), CamMax = new Vector3(11.2f, 9.2f, 8.6f); // 壁の内側・床の上
    static readonly Vector3 PivotMin = new Vector3(-10f, 0f, -9f), PivotMax = new Vector3(10f, 5f, 7.5f);

    // 時を巻き戻す：過去の記録を見ているあいだは、朝の斜めの光と少し冷たい空気にする
    Light sun;
    Light[] lamps = new Light[0];
    Renderer[] beams = new Renderer[0];
    Transform fanBlades;
    Volume pastLook;
    Quaternion sunNowRot;
    Color sunNowColor, ambSky, ambEq, ambGround;
    float sunNowIntensity, lampNowIntensity = 1f;
    float pastTarget, pastBlend, slowUntil;
    // 過去（朝の青い光）では緑の琺瑯が黒く沈むので、タンクの緑を明るくし、品温の帯を少し光らせる
    Material[] tankMats = new Material[0];
    Color[] tankMatNow = new Color[0];
    float pastE;
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

    static readonly Color BandNeutral = new Color(0.82f, 0.81f, 0.77f); // 温度が無い：生成り
    static readonly Color BandCool = new Color(0.42f, 0.66f, 0.92f);   // 低い品温：明るい藍（緑の胴の上で見えるように）
    static readonly Color BandWarm = new Color(1.0f, 0.56f, 0.22f);    // 高い品温：柿色
    static readonly Color GlowAlert = new Color(1.0f, 0.42f, 0.1f);    // 変化あり：灯りの色
    static readonly Color GlowSelect = new Color(0.95f, 0.88f, 0.70f); // 選択：やわらかい白
    static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
    static readonly int BaseMapStId = Shader.PropertyToID("_BaseMap_ST");
    static readonly Color AromaPastColor = new Color(0.95f, 0.93f, 0.86f, 0.55f); // 昨季：朝の光に合わせて白っぽく
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
                aroma = r.Find("Aroma")?.GetComponent<ParticleSystem>(),
                bubbles = r.Find("Bubbles")?.GetComponent<ParticleSystem>(),
                liquidRenderer = r.Find("Liquid")?.GetComponent<Renderer>(),
                phase = i * 1.7f,
                cover = r.Find("Cover")?.gameObject,
            };
            t.tag.SetActive(false);
            tanks[id] = t;
        }
        // タンクの胴・縁・補強の帯の材質を、この実行だけの写しに差し替える（過去の明るさを変えても元の材質は変えない）
        var clones = new Dictionary<Material, Material>();
        foreach (var t in tanks.Values)
            foreach (var path in new[] { "Shell", "Shell/Lip", "Shell/Hoop" })
            {
                var rd = t.root.Find(path)?.GetComponent<Renderer>();
                if (rd == null || rd.sharedMaterial == null) continue;
                if (!clones.TryGetValue(rd.sharedMaterial, out var mc)) clones[rd.sharedMaterial] = mc = new Material(rd.sharedMaterial);
                rd.sharedMaterial = mc;
            }
        tankMats = new List<Material>(clones.Values).ToArray();
        tankMatNow = Array.ConvertAll(tankMats, m => m.GetColor(BaseColorId));
        // 吹き出しの位置：Tripo の杜氏なら頭の骨に付けた目印（HeadAnchor）、仮の人形なら Head
        tojiHead = FindDeep(kura.Find("Toji"), "HeadAnchor") ?? kura.Find("Toji/Head");
        tojiAnimator = kura.Find("Toji")?.GetComponentInChildren<Animator>();
        toji = kura.Find("Toji");
        // 覗き込むときに曲げる骨（Tripo の杜氏の上の背骨と頭）
        var model = toji != null ? toji.Find("TojiModel") : null;
        spineBone = FindDeep(model, "Spine02");
        headBone = FindDeep(model, "Head");
        InitWork(model);
        resumePatrolAt = 4f;
        fanBlades = FindDeep(kura.Find("Props"), "FanBlades");
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
            if (t.cover != null) t.cover.SetActive(s.level <= 0.001f); // 仕込み前・上槽のあとのタンクには覆いをかける
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
        if (msg.mode == "opening") { StartOpening(); return; }
        if (opening) return; // オープニングのあいだは、ほかの視点の指示を受けない（終われば蔵全体に落ち着く）
        guideCam = false;
        freeCam = false;
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
        // 語るときのカメラ：来た方向の後ろ（追ってきたカメラが杜氏を突き抜けない側）から、振り向いた杜氏の顔を見る。
        // 顔と吹き出しの両方が入るよう、頭の上と横に間をあける（縦長の画面ほど少し引く）
        if (cam != null && cam.aspect < 1f)
        {
            // 縦長（スマホ）：横に吹き出しを置く幅がないので、杜氏の頭を画面の下寄りにして、頭の上に吹き出しの場所をあける
            arriveCamPos = new Vector3(walkTarget.x - walkDir * 3.0f, KuraScene.DeckHeight + 1.45f, -side * 0.1f); // 目の高さから見上げ気味に（顔が帽子に隠れない）
            arriveLookAt = new Vector3(walkTarget.x, KuraScene.DeckHeight + 2.3f, side * StandZ);
        }
        else
        {
            arriveCamPos = new Vector3(walkTarget.x - walkDir * 2.6f, KuraScene.DeckHeight + 1.7f, -side * 0.25f);
            arriveLookAt = new Vector3(walkTarget.x - walkDir * 0.1f, KuraScene.DeckHeight + 1.25f, side * 0.75f);
        }
        pendingText = text;
        Speak(""); // 歩いているあいだは吹き出しを出さない
        guiding = true;
        patrolMoving = false;
        pendingWork = false;
        AbortWork(); // 蔵人の質問の案内を優先する
        if (opening) EndOpening();
        leanTarget = 0f;
        walking = true;
        guideCam = true;
        freeCam = false;
        overview = false;
        targetFov = 50f;
    }

    void UpdateToji(float dt)
    {
        if (toji == null) return;
        if (opening) { UpdateOpeningToji(dt); return; }
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
        else if (guiding)
        {
            // 着いたら蔵人（カメラ）の方へ振り向いて語る。語り終えたら少し間をおいて見回りに戻る
            if (cam != null)
            {
                var look = cam.transform.position - toji.position; look.y = 0f;
                if (look.sqrMagnitude > 0.01f) Turn(Quaternion.LookRotation(look.normalized), dt);
            }
            if (string.IsNullOrEmpty(bubbleText)) { guiding = false; resumePatrolAt = Time.time + 4f; }
        }
        else if (string.IsNullOrEmpty(bubbleText) && Time.time >= resumePatrolAt)
        {
            Patrol(dt);
        }
        else
        {
            // 話しているあいだ（案内以外の吹き出し）は、その場で立ち止まる
            patrolMoving = false;
            leanTarget = 0f;
        }
        if (tojiAnimator != null)
        {
            tojiAnimator.SetBool("Walking", walking || patrolMoving);
            tojiAnimator.speed = patrolMoving && !walking ? 0.6f : 1f; // 見回りはゆっくりの足取り
        }

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

    void Patrol(float dt)
    {
        if (patrolMoving)
        {
            var to = patrolTarget - toji.position; to.y = 0f;
            float dist = to.magnitude;
            if (dist < 0.03f)
            {
                patrolMoving = false;
                patrolWaitUntil = Time.time + (patrolPeek ? 1.2f : 2.5f);
                pendingWork = patrolPeek;
                return;
            }
            var next = toji.position + to / dist * Mathf.Min(dist, PatrolSpeed * dt);
            next.x = Mathf.Clamp(next.x, DeckMinX, DeckMaxX);
            next.z = Mathf.Clamp(next.z, -WorkStandZ, WorkStandZ);
            next.y = KuraScene.DeckHeight;
            toji.position = next;
            Turn(Quaternion.LookRotation(to / dist), dt * 0.6f);
            return;
        }
        if (Time.time < patrolWaitUntil || Working || pendingWork)
        {
            // 立ち止まってタンクの方を向き、櫂入れ → 品温を測る → 帳面に書く。腕の無い仮の人形なら、前かがみで覗き込むだけ
            Turn(patrolFace, dt * 0.5f);
            bool facing = Quaternion.Angle(toji.rotation, patrolFace) < 12f;
            if (pendingWork && facing)
            {
                pendingWork = false;
                StartWork(patrolTank);
                if (!Working) patrolWaitUntil = Time.time + 5f; // 仮の人形：覗き込み
            }
            if (Working) { if (!UpdateWork()) patrolWaitUntil = Time.time + 0.8f; return; }
            leanTarget = patrolPeek && facing && Time.time < patrolWaitUntil ? 1f : 0f;
            if (Time.time < patrolWaitUntil || pendingWork) return;
        }
        leanTarget = 0f;
        if (lean > 0.05f) return; // 体を起こしてから次へ
        PickPatrolTarget();
    }

    // 次の見回り先：変化のあったタンク（左から順に）と、足場のあちこちを交互に
    void PickPatrolTarget()
    {
        var alerts = new List<Tank>();
        foreach (var t in tanks.Values) if (t.highlighted) alerts.Add(t);
        alerts.Sort((a, b) => a.root.position.x.CompareTo(b.root.position.x));
        patrolStep++;
        if (alerts.Count > 0 && patrolStep % 2 == 1)
        {
            var t = alerts[(patrolStep / 2) % alerts.Count];
            patrolTank = t;
            var p = t.root.position;
            float side = p.z < 0 ? -1f : 1f;
            // 作業するときは手すりの際まで寄る（櫂を縦に差し入れられるように）
            patrolTarget = new Vector3(Mathf.Clamp(p.x, DeckMinX, DeckMaxX), KuraScene.DeckHeight, side * WorkStandZ);
            patrolFace = Quaternion.LookRotation(new Vector3(0, 0, side));
            patrolPeek = true;
        }
        else
        {
            float x = Mathf.Lerp(DeckMinX + 0.5f, DeckMaxX - 0.5f, (float)patrolRng.NextDouble());
            float z = ((float)patrolRng.NextDouble() - 0.5f) * StandZ;
            patrolTarget = new Vector3(x, KuraScene.DeckHeight, z);
            patrolFace = Quaternion.LookRotation(new Vector3((float)patrolRng.NextDouble() - 0.5f, 0, patrolRng.NextDouble() < 0.5 ? -1f : 1f));
            patrolPeek = false;
        }
        patrolMoving = true;
    }

    // 前かがみ：アニメーションの後に、背骨と頭を体の右向きの軸で少し前へ傾ける
    void LateUpdate()
    {
        if (toji == null) return;
        lean = Mathf.MoveTowards(lean, leanTarget, Time.deltaTime * 0.9f);
        if (lean > 0.001f)
        {
            float e = Mathf.SmoothStep(0f, 1f, lean);
            var axis = toji.right;
            if (spineBone != null) spineBone.rotation = Quaternion.AngleAxis(24f * e, axis) * spineBone.rotation;
            if (headBone != null) headBone.rotation = Quaternion.AngleAxis(16f * e, axis) * headBone.rotation;
        }
        LateUpdateWork(); // 前かがみのあとで、腕を道具に合わせる
    }

    static Vector3 Clamp(Vector3 v, Vector3 min, Vector3 max) =>
        new Vector3(Mathf.Clamp(v.x, min.x, max.x), Mathf.Clamp(v.y, min.y, max.y), Mathf.Clamp(v.z, min.z, max.z));

    /// <summary>今のカメラの位置から、自由なカメラに切り替える（その場から続けて動かせるように）</summary>
    void EnterFree()
    {
        if (freeCam || cam == null) return;
        freeCam = true;
        overview = false;
        guideCam = false;
        pivot = pivotTarget = Clamp(camLookAtCurrent, PivotMin, PivotMax);
        var d = cam.transform.position - pivot;
        dist = distTarget = Mathf.Clamp(d.magnitude, 2.5f, 26f);
        var n = d.normalized;
        yaw = yawTarget = Mathf.Atan2(-n.x, -n.z) * Mathf.Rad2Deg;
        pitch = pitchTarget = Mathf.Clamp(Mathf.Asin(n.y) * Mathf.Rad2Deg, 5f, 85f);
    }

    void Orbit(Vector2 delta)
    {
        EnterFree();
        yawTarget += delta.x * 0.25f;
        pitchTarget = Mathf.Clamp(pitchTarget - delta.y * 0.2f, 5f, 85f);
    }

    void Pan(Vector2 delta)
    {
        EnterFree();
        float s = distTarget * 0.0016f;
        var right = cam.transform.right; right.y = 0f; right.Normalize();
        var fwd = cam.transform.forward; fwd.y = 0f; fwd.Normalize();
        pivotTarget = Clamp(pivotTarget - right * delta.x * s - fwd * delta.y * s, PivotMin, PivotMax);
    }

    void Zoom(float amount)
    {
        EnterFree();
        distTarget = Mathf.Clamp(distTarget * Mathf.Exp(-amount), 2.5f, 26f);
    }

    /// <summary>タンクへなめらかに寄る（クリック・タップ）</summary>
    void FocusTank(Tank t)
    {
        EnterFree();
        var p = t.root.position;
        pivotTarget = Clamp(new Vector3(p.x, KuraScene.PlinthHeight + KuraScene.TankHeight * 0.7f, p.z), PivotMin, PivotMax);
        distTarget = 7.5f;
        pitchTarget = Mathf.Max(pitchTarget, 38f);
    }

    void HandleInput()
    {
        if (cam == null) return;
        if (opening) { if (AnyInput()) { EndOpening(); swallowPointer = true; } return; } // オープニングは、画面に触ればすぐ飛ばす
        if (swallowPointer)
        {
            // 飛ばすのに使ったクリック・タップは、離すまでほかの操作（タンクを選ぶ・回す）に使わない
            if (Input.GetMouseButton(0) || Input.GetMouseButton(1) || Input.GetMouseButtonUp(0) || Input.GetMouseButtonUp(1) || Input.touchCount > 0) return;
            swallowPointer = false; pressing = false;
        }
        // スマホ：1本指で回転、2本指でつまんで拡大・縮小と平行移動、軽く触れてタンクを選ぶ
        if (Input.touchCount > 0)
        {
            if (Input.touchCount == 1)
            {
                var t = Input.GetTouch(0);
                lastPinch = -1f;
                if (t.phase == TouchPhase.Began) { dragAmount = 0f; }
                else if (t.phase == TouchPhase.Moved) { dragAmount += t.deltaPosition.magnitude; if (dragAmount > 8f) Orbit(t.deltaPosition); }
                else if (t.phase == TouchPhase.Ended && dragAmount <= 8f) Pick(t.position);
            }
            else
            {
                var a = Input.GetTouch(0); var b = Input.GetTouch(1);
                float pinch = Vector2.Distance(a.position, b.position);
                if (lastPinch > 0f) Zoom((pinch - lastPinch) * 0.006f);
                lastPinch = pinch;
                Pan((a.deltaPosition + b.deltaPosition) * 0.5f);
                dragAmount = 999f; // 2本指のあとはタップとして扱わない
            }
            return;
        }
        lastPinch = -1f;

        // マウス：左ドラッグで回転、右（または中）ドラッグで平行移動、ホイール（トラックパッドのピンチ）で拡大・縮小
        Vector2 mp = Input.mousePosition;
        // 押して離すのが同じ瞬間に届いたときも、クリックとして扱う
        if (!pressing && Input.GetMouseButtonUp(0)) { Pick(mp); return; }
        if (Input.GetMouseButtonDown(0) || Input.GetMouseButtonDown(1) || Input.GetMouseButtonDown(2))
        {
            pressing = true; dragAmount = 0f; lastPointer = downPointer = mp;
        }
        if (pressing)
        {
            var delta = mp - lastPointer;
            lastPointer = mp;
            dragAmount += delta.magnitude;
            if (dragAmount > 5f)
            {
                if (Input.GetMouseButton(0) && !Input.GetKey(KeyCode.LeftShift)) Orbit(delta);
                else if (Input.GetMouseButton(1) || Input.GetMouseButton(2) || Input.GetMouseButton(0)) Pan(delta);
            }
            if (Input.GetMouseButtonUp(0) && dragAmount <= 5f) Pick(mp);
            if (!Input.GetMouseButton(0) && !Input.GetMouseButton(1) && !Input.GetMouseButton(2)) pressing = false;
        }
        float scroll = Input.mouseScrollDelta.y;
        if (Mathf.Abs(scroll) > 0.001f) Zoom(Mathf.Clamp(scroll, -3f, 3f) * 0.12f);
    }

    // クリック（タップ）したタンクを選び、そこへ寄る
    void Pick(Vector2 screen)
    {
        if (Physics.Raycast(cam.ScreenPointToRay(screen), out var hit, 100f))
        {
            var target = hit.collider.GetComponent<TankClickTarget>();
            if (target != null)
            {
                KuraTankClicked(target.tankId);
                if (tanks.TryGetValue(target.tankId, out var t)) FocusTank(t);
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
        // 蔵の入口（手前の右寄り）に立った人の目線に近い、斜め横からの低めの角度。
        // 奥の壁（神棚・黒板・櫂）と床（水の跡・ホース）が自然に見え、タンク10本と杜氏が画面に収まる距離まで引く
        float aspect = cam != null ? cam.aspect : 1.6f;
        float pitch = Mathf.Lerp(24f, 17f, Mathf.InverseLerp(1.1f, 1.9f, aspect)); // 縦長の画面ほど少し上から
        const float yaw = -24f;                                                     // 右手前から斜めに見る
        camLookAt = new Vector3(-0.6f, 2.3f, 1.8f);
        var dir = Quaternion.Euler(pitch, yaw, 0f) * Vector3.back;
        float lo = 8f, hi = 34f;
        for (int i = 0; i < 18; i++) { float mid = (lo + hi) / 2f; if (FitsOverview(camLookAt + dir * mid, aspect)) hi = mid; else lo = mid; }
        camTargetPos = Clamp(camLookAt + dir * hi, CamMin, CamMax);
    }

    // タンク10本（足元から縁まで）と杜氏の頭が、画面の内側に入るか
    static readonly List<Vector3> OverviewPoints = BuildOverviewPoints();
    static List<Vector3> BuildOverviewPoints()
    {
        var pts = new List<Vector3>();
        for (int i = 0; i < KuraScene.TankCount; i++)
        {
            var c = KuraScene.TankPosition(i);
            foreach (var y in new[] { 0f, KuraScene.DeckHeight + 0.1f })
                foreach (var d in new[] { Vector3.left, Vector3.right, Vector3.forward, Vector3.back })
                    pts.Add(c + d * (KuraScene.TankRadius + 0.15f) + Vector3.up * y);
        }
        pts.Add(new Vector3(-7.4f, KuraScene.DeckHeight + 1.8f, 0.1f)); // 杜氏の頭（足場の左端）
        pts.Add(new Vector3(-7.4f, KuraScene.DeckHeight, 0.1f));
        return pts;
    }

    bool FitsOverview(Vector3 pos, float aspect)
    {
        var rot = Quaternion.LookRotation(camLookAt - pos);
        float tanV = Mathf.Tan(targetFov * Mathf.Deg2Rad / 2f), tanH = tanV * aspect;
        foreach (var p in OverviewPoints)
        {
            var v = Quaternion.Inverse(rot) * (p - pos);
            if (v.z <= 0.1f) return false;
            float x = v.x / (v.z * tanH), y = v.y / (v.z * tanV);
            if (x < -0.94f || x > 0.94f || y < -0.9f || y > 0.78f) return false; // 上は日付の表示のぶん余白を広めに
        }
        return true;
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
        pastE = e;
        for (int i = 0; i < tankMats.Length; i++) tankMats[i].SetColor(BaseColorId, Color.Lerp(tankMatNow[i], tankMatNow[i] * 1.75f, e));
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
            // 香りの粒と表面の泡：発酵の盛りほど多く、勢いよく。覆いのタンク（空）や仕込み前・上槽間近は activity が 0 で出ない
            t.activity = k > 0f ? Mathf.Lerp(t.activity, t.targetActivity, k) : t.targetActivity;
            float surfaceY = KuraScene.PlinthHeight + KuraScene.TankHeight * Mathf.Max(0.05f, t.level) * 0.96f;
            if (t.targetLevel <= 0.001f) t.activity = 0f; // 覆いをかけたら、液面が下がりきるのを待たずにすぐ止める
            float act = t.level > 0.001f ? t.activity : 0f;
            if (t.aroma != null)
            {
                var em = t.aroma.emission; em.rateOverTime = Mathf.Pow(act, 1.5f) * 6.5f;
                var main = t.aroma.main;
                main.startSpeed = new ParticleSystem.MinMaxCurve(0.1f + 0.12f * act, 0.16f + 0.2f * act);
                main.startColor = Color.Lerp(KuraScene.AromaColor, AromaPastColor, pastE); // 昨季（朝の光）は少し白っぽく
                var sp = t.aroma.transform.localPosition; sp.y = surfaceY + 0.03f; t.aroma.transform.localPosition = sp;
            }
            if (t.bubbles != null)
            {
                var em = t.bubbles.emission; em.rateOverTime = act * 16f;
                var sp = t.bubbles.transform.localPosition; sp.y = surfaceY + 0.012f; t.bubbles.transform.localPosition = sp;
            }
            // 表面がゆっくりわずかに動く（模様をごく少しずつ流す）
            if (t.liquidRenderer != null)
            {
                float tt = Time.time * 0.05f + t.phase;
                float amp = 0.015f + 0.03f * act;
                mpb.Clear();
                mpb.SetVector(BaseMapStId, new Vector4(1.5f, 1.5f, amp * Mathf.Sin(tt) + 0.004f * act * Time.time, amp * Mathf.Cos(tt * 0.8f)));
                t.liquidRenderer.SetPropertyBlock(mpb);
            }

            mpb.Clear();
            mpb.SetColor(BaseColorId, t.bandColor);
            mpb.SetColor(EmissionId, t.bandColor * (0.6f * pastE));
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
        ApplyOpeningLight();
        UpdateToji(Time.deltaTime);
        if (fanBlades != null) fanBlades.Rotate(0f, 0f, 160f * Time.deltaTime, Space.Self); // 換気扇をゆっくり回す

        HandleInput();

        if (cam != null && opening) UpdateOpening(Time.deltaTime);
        else if (cam != null)
        {
            if (overview) SetOverview(); // 画面の大きさが変わっても全体が入るように
            float kc = k;
            if (freeCam)
            {
                // 自由なカメラ：触った動きにすぐ追いつくよう、少し速く寄せる
                kc = 1f - Mathf.Exp(-Time.deltaTime * 12f);
                yaw = Mathf.LerpAngle(yaw, yawTarget, kc);
                pitch = Mathf.Lerp(pitch, pitchTarget, kc);
                dist = Mathf.Lerp(dist, distTarget, kc);
                pivot = Vector3.Lerp(pivot, pivotTarget, kc);
                var pos = pivot + Quaternion.Euler(pitch, yaw, 0f) * (Vector3.back * dist);
                camTargetPos = Clamp(pos, CamMin, CamMax);
                camLookAt = pivot;
                targetFov = 45f;
                cam.transform.position = camTargetPos;
                camLookAtCurrent = pivot;
                cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, targetFov, kc);
                cam.transform.LookAt(pivot);
            }
            else
            {
                cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, targetFov, kc);
                cam.transform.position = Vector3.Lerp(cam.transform.position, camTargetPos, kc);
                camLookAtCurrent = Vector3.Lerp(camLookAtCurrent, camLookAt, kc);
                cam.transform.LookAt(camLookAtCurrent);
            }
        }

        // 話すあいだだけ、うなずきの層（首と頭）をふわっと効かせる
        if (tojiAnimator != null && tojiAnimator.layerCount > 1)
            tojiAnimator.SetLayerWeight(1, Mathf.MoveTowards(tojiAnimator.GetLayerWeight(1), Time.time < nodUntil ? 1f : 0f, Time.deltaTime * 3f));

        // 見回りの品温（目盛りを読んだときだけ、小さく）
        if (string.IsNullOrEmpty(bubbleText) && cam != null && tojiHead != null && !string.IsNullOrEmpty(workBubble))
        {
            if (Time.time > workBubbleUntil) { workBubble = ""; KuraBubble("", 0, 0, 0); }
            else
            {
                SendBubble(workBubble);
            }
        }

        // 吹き出しの位置を Web 側へ（日本語の文字は HTML で描く）
        if (!string.IsNullOrEmpty(bubbleText) && cam != null && tojiHead != null)
        {
            if (Time.time > bubbleUntil) { bubbleText = ""; KuraBubble("", 0, 0, 0); }
            else
            {
                SendBubble(bubbleText);
            }
        }
    }

    // 吹き出しを置くための頭と口元の位置を Web 側へ。吹き出しは顔を避けて置き、しっぽを口元に向ける
    void SendBubble(string text)
    {
        var up = Vector3.up;
        var fwd = toji != null ? toji.forward : Vector3.forward; fwd.y = 0f; fwd.Normalize();
        var center = tojiHead.position + up * 0.09f;
        var c = cam.WorldToScreenPoint(center);
        var top = cam.WorldToScreenPoint(center + up * 0.17f);
        var mouth = cam.WorldToScreenPoint(tojiHead.position + up * 0.03f + fwd * 0.1f);
        float r = Vector2.Distance(new Vector2(c.x, c.y), new Vector2(top.x, top.y)) / Screen.height;
        KuraBubble(text, c.x / Screen.width, c.y / Screen.height, c.z > 0 ? 1 : 0, mouth.x / Screen.width, mouth.y / Screen.height, r);
    }
}
