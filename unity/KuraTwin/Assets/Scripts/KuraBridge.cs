using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using UnityEngine;

// 蔵ツイン：Webの右側から届く5つの命令（SetDay / HighlightTank / SetCamera / SelectTank / TojiSay）を受けて、
// 3Dの蔵を動かす。蔵・タンク・杜氏の仮キャラは起動時にコードで組み立てる。
// データは持たない（毎回 JS から JSON で受け取る）。醸造の判断もしない。
public class KuraBridge : MonoBehaviour
{
    [Header("材質（Standard シェーダーの元。WebGL でシェーダーが削られないように参照を持つ）")]
    public Material baseMaterial;

    [Header("蔵の寸法（メートル）")]
    public float tankRadius = 1.0f;
    public float tankHeight = 2.2f;
    public int tankCount = 10;

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
        public Transform root;
        public Transform liquid;
        public Renderer liquidRenderer, wallRenderer, rimRenderer;
        public float targetLevel, level;
        public Color targetColor = Color.gray, color = Color.gray;
        public bool highlighted, selected;
    }

    readonly Dictionary<string, Tank> tanks = new Dictionary<string, Tank>();
    Camera cam;
    Vector3 camTargetPos, camLookAt, camLookAtCurrent;
    Transform tojiHead;
    string bubbleText = "";
    float bubbleUntil;

    static readonly Color WallColor = new Color(0.78f, 0.77f, 0.74f);
    static readonly Color RimColor = new Color(0.55f, 0.55f, 0.55f);
    static readonly Color SelectColor = new Color(1f, 0.78f, 0.2f);
    static readonly Color HighlightColor = new Color(0.9f, 0.1f, 0.05f);

    void Awake()
    {
        if (baseMaterial == null) baseMaterial = new Material(Shader.Find("Standard"));
        cam = Camera.main;
        BuildKura();
        SetOverview();
        if (cam != null) { cam.transform.position = camTargetPos; camLookAtCurrent = camLookAt; cam.transform.LookAt(camLookAt); }
    }

    void Start()
    {
        KuraReady();
    }

    // ---------- 組み立て ----------
    Material Mat(Color c, float smooth = 0.3f)
    {
        var m = new Material(baseMaterial);
        m.color = c;
        m.SetFloat("_Glossiness", smooth);
        return m;
    }

    public static Vector3 TankPosition(int index)
    {
        // web/public/data/kura.json と同じ配置：2列×5本
        int col = index % 5, row = index / 5;
        return new Vector3(col * 3.0f - 6.0f, 0f, row * 4.0f - 2.0f);
    }

    void BuildKura()
    {
        var kura = new GameObject("Kura").transform;
        kura.SetParent(transform, false);

        // 床（三和土）と壁（土壁）・梁
        var floor = GameObject.CreatePrimitive(PrimitiveType.Cube);
        floor.name = "Floor"; floor.transform.SetParent(kura, false);
        floor.transform.localPosition = new Vector3(0, -0.05f, 0);
        floor.transform.localScale = new Vector3(40, 0.1f, 40);
        floor.transform.localPosition = new Vector3(0, -0.05f, -8);
        floor.GetComponent<Renderer>().sharedMaterial = Mat(new Color(0.42f, 0.38f, 0.33f), 0.1f);

        var wallMat = Mat(new Color(0.86f, 0.82f, 0.72f), 0.05f);
        var woodMat = Mat(new Color(0.30f, 0.20f, 0.13f), 0.2f);
        MakeBox(kura, "WallBack", new Vector3(0, 5f, 7), new Vector3(40, 10, 0.3f), wallMat);
        MakeBox(kura, "WallLeft", new Vector3(-11, 5f, -8), new Vector3(0.3f, 10, 30), wallMat);
        MakeBox(kura, "WallRight", new Vector3(11, 5f, -8), new Vector3(0.3f, 10, 30), wallMat);
        // 腰板と、奥の壁の梁（視界をふさがないよう壁沿いだけ）
        MakeBox(kura, "BeamBack", new Vector3(0, 6.5f, 6.8f), new Vector3(40, 0.4f, 0.3f), woodMat);
        MakeBox(kura, "Sill", new Vector3(0, 0.5f, 6.8f), new Vector3(40, 1.0f, 0.2f), woodMat);

        // タンク（ホーロータンク）
        var openMesh = OpenCylinderMesh(48);
        for (int i = 0; i < tankCount; i++)
        {
            string id = (i + 1).ToString();
            var t = new Tank { id = id };
            var root = new GameObject("Tank" + id).transform;
            root.SetParent(kura, false);
            root.localPosition = TankPosition(i);
            t.root = root;

            var wall = new GameObject("Wall");
            wall.transform.SetParent(root, false);
            wall.transform.localScale = new Vector3(tankRadius, tankHeight, tankRadius);
            wall.AddComponent<MeshFilter>().sharedMesh = openMesh;
            t.wallRenderer = wall.AddComponent<MeshRenderer>();
            t.wallRenderer.sharedMaterial = Mat(WallColor, 0.7f);
            var col = wall.AddComponent<CapsuleCollider>();
            col.radius = 1f; col.height = 1f; col.center = new Vector3(0, 0.5f, 0);
            wall.AddComponent<TankClickTarget>().tankId = id;

            // 縁（リング）。選択・ハイライトで色が変わる
            var ring = new GameObject("RimRing");
            ring.transform.SetParent(root, false);
            ring.transform.localPosition = new Vector3(0, tankHeight, 0);
            ring.AddComponent<MeshFilter>().sharedMesh = RingMesh(48, tankRadius * 0.96f, tankRadius * 1.06f);
            t.rimRenderer = ring.AddComponent<MeshRenderer>();
            t.rimRenderer.sharedMaterial = Mat(RimColor, 0.6f);

            var liquid = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            liquid.name = "Liquid"; Destroy(liquid.GetComponent<Collider>());
            liquid.transform.SetParent(root, false);
            t.liquid = liquid.transform;
            t.liquidRenderer = liquid.GetComponent<Renderer>();
            t.liquidRenderer.sharedMaterial = Mat(Color.gray, 0.85f);
            ApplyLevel(t, 0f);

            // 番号札（数字のみ。日本語の文字は Web 側で出す）
            var label = new GameObject("Label");
            label.transform.SetParent(root, false);
            label.transform.localPosition = new Vector3(0, tankHeight * 0.55f, -tankRadius - 0.02f);
            label.transform.localRotation = Quaternion.identity;
            var tm = label.AddComponent<TextMesh>();
            tm.text = id; tm.fontSize = 64; tm.characterSize = 0.06f;
            tm.anchor = TextAnchor.MiddleCenter; tm.alignment = TextAlignment.Center;
            tm.color = new Color(0.15f, 0.12f, 0.1f);
            tm.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            label.GetComponent<MeshRenderer>().sharedMaterial = tm.font.material;
            label.transform.localRotation = Quaternion.Euler(0, 0, 0);

            tanks[id] = t;
        }

        // 杜氏の仮キャラ（Tripo のモデルに差し替える予定）
        var toji = new GameObject("Toji").transform;
        toji.SetParent(kura, false);
        toji.localPosition = new Vector3(-8.2f, 0, -4.2f);
        toji.localRotation = Quaternion.Euler(0, 40, 0);
        var body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
        body.name = "Body"; body.transform.SetParent(toji, false);
        body.transform.localPosition = new Vector3(0, 0.85f, 0);
        body.transform.localScale = new Vector3(0.6f, 0.85f, 0.45f);
        body.GetComponent<Renderer>().sharedMaterial = Mat(new Color(0.16f, 0.2f, 0.32f), 0.1f); // 藍の作務衣
        var head = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        head.name = "Head"; head.transform.SetParent(toji, false);
        head.transform.localPosition = new Vector3(0, 1.9f, 0);
        head.transform.localScale = Vector3.one * 0.38f;
        head.GetComponent<Renderer>().sharedMaterial = Mat(new Color(0.85f, 0.7f, 0.58f), 0.2f);
        var towel = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        towel.name = "Hachimaki"; Destroy(towel.GetComponent<Collider>());
        towel.transform.SetParent(toji, false);
        towel.transform.localPosition = new Vector3(0, 1.98f, 0);
        towel.transform.localScale = new Vector3(0.4f, 0.04f, 0.4f);
        towel.GetComponent<Renderer>().sharedMaterial = Mat(Color.white, 0.1f);
        tojiHead = head.transform;
    }

    static void MakeBox(Transform parent, string name, Vector3 pos, Vector3 scale, Material m)
    {
        var g = GameObject.CreatePrimitive(PrimitiveType.Cube);
        g.name = name; g.transform.SetParent(parent, false);
        g.transform.localPosition = pos; g.transform.localScale = scale;
        g.GetComponent<Renderer>().sharedMaterial = m;
        Destroy(g.GetComponent<Collider>());
    }

    // 上が開いた円筒（外側・内側の両面＋底）。高さ1・半径1
    static Mesh OpenCylinderMesh(int seg)
    {
        var v = new List<Vector3>(); var n = new List<Vector3>(); var tri = new List<int>();
        for (int side = 0; side < 2; side++)
        {
            int start = v.Count;
            for (int i = 0; i <= seg; i++)
            {
                float a = i * Mathf.PI * 2 / seg;
                var dir = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                v.Add(dir); v.Add(dir + Vector3.up);
                var nn = side == 0 ? dir : -dir; n.Add(nn); n.Add(nn);
            }
            for (int i = 0; i < seg; i++)
            {
                int a0 = start + i * 2, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3;
                if (side == 0) { tri.AddRange(new[] { a0, b0, a1, a1, b0, b1 }); }
                else { tri.AddRange(new[] { a0, a1, b0, a1, b1, b0 }); }
            }
        }
        int c = v.Count; v.Add(Vector3.zero); n.Add(Vector3.up);
        for (int i = 0; i <= seg; i++) { float a = i * Mathf.PI * 2 / seg; v.Add(new Vector3(Mathf.Cos(a), 0.001f, Mathf.Sin(a))); n.Add(Vector3.up); }
        for (int i = 0; i < seg; i++) tri.AddRange(new[] { c, c + 2 + i, c + 1 + i });
        var m = new Mesh { name = "OpenCylinder" };
        m.SetVertices(v); m.SetNormals(n); m.SetTriangles(tri, 0); m.RecalculateBounds();
        return m;
    }

    static Mesh RingMesh(int seg, float r0, float r1)
    {
        var v = new List<Vector3>(); var tri = new List<int>();
        for (int i = 0; i <= seg; i++)
        {
            float a = i * Mathf.PI * 2 / seg;
            var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
            v.Add(d * r0); v.Add(d * r1);
        }
        for (int i = 0; i < seg; i++) { int a = i * 2; tri.AddRange(new[] { a, a + 2, a + 1, a + 1, a + 2, a + 3 }); }
        var m = new Mesh { name = "Ring" };
        m.SetVertices(v); m.SetTriangles(tri, 0); m.RecalculateNormals(); m.RecalculateBounds();
        return m;
    }

    void ApplyLevel(Tank t, float level)
    {
        float h = Mathf.Max(0.001f, level * tankHeight * 0.97f);
        t.liquid.gameObject.SetActive(level > 0.001f);
        t.liquid.localPosition = new Vector3(0, h / 2f, 0);
        t.liquid.localScale = new Vector3(tankRadius * 1.96f, h / 2f, tankRadius * 1.96f); // Cylinder は高さ2
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
            t.targetColor = TempColor(s.temp, day.tempMin, day.tempMax);
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
    // 品温の色：低い＝青、中＝緑〜黄、高い＝赤。温度が無い（空のタンク）＝灰
    public static Color TempColor(float temp, float min, float max)
    {
        if (temp < -100f) return new Color(0.6f, 0.6f, 0.6f);
        float x = Mathf.InverseLerp(min, max, temp);
        return Color.HSVToRGB(Mathf.Lerp(0.62f, 0.0f, x), 0.75f, 0.95f);
    }

    bool overview = true;

    void SetOverview()
    {
        overview = true;
        // 画面の縦横比に合わせて、10本すべてが入る距離まで引く（横幅 約17m）
        float aspect = cam != null ? cam.aspect : 1.6f;
        float vfov = (cam != null ? cam.fieldOfView : 50f) * Mathf.Deg2Rad;
        float hfov = 2f * Mathf.Atan(Mathf.Tan(vfov / 2f) * aspect);
        float d = Mathf.Max(13f, 9.0f / Mathf.Tan(hfov / 2f));
        camTargetPos = new Vector3(0, d * 0.62f, 0.8f - d * 0.78f);
        camLookAt = new Vector3(0, 0f, 0.8f);
    }

    void SetTojiView(Tank t)
    {
        overview = false;
        // 杜氏がタンクの縁から覗き込む位置
        var p = t.root.position;
        camTargetPos = p + new Vector3(0, tankHeight + 1.5f, -1.3f);
        camLookAt = p + new Vector3(0, tankHeight * Mathf.Max(0.2f, t.level) * 0.97f, 0.1f);
    }

    void Update()
    {
        float k = 1f - Mathf.Exp(-Time.deltaTime * 4f);
        float pulse = 0.5f + 0.5f * Mathf.Sin(Time.time * 5f);
        foreach (var t in tanks.Values)
        {
            t.level = Mathf.Lerp(t.level, t.targetLevel, k);
            t.color = Color.Lerp(t.color, t.targetColor, k);
            ApplyLevel(t, t.level);
            t.liquidRenderer.sharedMaterial.color = t.color;

            Color rim = RimColor, wall = WallColor;
            if (t.selected) rim = SelectColor;
            if (t.highlighted) { rim = Color.Lerp(HighlightColor, Color.white, pulse * 0.3f); wall = Color.Lerp(WallColor, HighlightColor, 0.35f + 0.35f * pulse); }
            t.rimRenderer.sharedMaterial.color = rim;
            t.wallRenderer.sharedMaterial.color = wall;
        }

        if (cam != null)
        {
            if (overview) SetOverview(); // 画面の大きさが変わっても全体が入るように
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

public class TankClickTarget : MonoBehaviour
{
    public string tankId;
}
