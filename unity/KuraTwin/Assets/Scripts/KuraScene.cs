using System;
using System.Collections.Generic;
using UnityEngine;

// 蔵ツイン：蔵の3Dを組み立てる（エディタで「シーンを用意」したときに呼ぶ。間接光を焼き込むため、形はシーンに保存する）。
// 名前の決まり（KuraBridge が実行時に探す）：Kura/Tanks/Tank{n}/ の下に
//   Shell（胴・クリック対象）, Liquid（醪）, Band（品温の帯）, Tag/TagText（温度の札）, RimGlow, FloorGlow, Number
[Serializable]
public class KuraPalette
{
    public Material enamel, enamelInner, lip, plinth, liquid;
    public Material plaster, wood, woodDark, concrete, steel, plank;
    public Material tag, band, glow, glowSoft, lampShade, lampBulb, windowPaper;
    public Material tojiCloth, tojiSkin, tojiTowel;
    public Material text; // 文字（TextMesh）用。奥行きで隠れる
}

public static class KuraScene
{
    public const float TankRadius = 1.0f;
    // 実際の仕込みタンクに近い大きさ：直径2m・高さ3m（人の背丈よりずっと高い）。蔵人は縁と同じ高さの足場から作業する
    public const float TankHeight = 3.0f;
    public const float WallThickness = 0.04f;
    public const float PlinthHeight = 0.1f;
    public const float DeckHeight = PlinthHeight + TankHeight; // 足場の踏み板の上面＝タンクの縁の高さ
    public const float EyeHeight = 1.55f; // 足場に立った人の目の高さ
    public const int TankCount = 10;

    // web/public/data/kura.json と同じ配置：2列×5本
    public static Vector3 TankPosition(int index)
    {
        int col = index % 5, row = index / 5;
        return new Vector3(col * 3.0f - 6.0f, 0f, row * 4.0f - 2.0f);
    }

    /// <param name="keepMesh">作ったメッシュを保存する（エディタではアセット化と光の焼き込み用UV）</param>
    /// <param name="markStatic">動かない物の印（エディタでのみ意味がある）</param>
    public static Transform Build(Transform parent, KuraPalette p, Func<Mesh, Mesh> keepMesh, Action<GameObject> markStatic)
    {
        keepMesh ??= m => m;
        markStatic ??= _ => { };
        var kura = new GameObject("Kura").transform;
        kura.SetParent(parent, false);

        var meshes = new Dictionary<string, Mesh>
        {
            ["shellOuter"] = keepMesh(Tube(64, TankRadius, TankHeight, false, "ShellOuter")),
            ["shellInner"] = keepMesh(Tube(64, TankRadius - WallThickness, TankHeight, true, "ShellInner")),
            ["shellBottom"] = keepMesh(Disc(64, TankRadius - WallThickness, 0.02f, "ShellBottom")),
            ["lip"] = keepMesh(Torus(72, 12, TankRadius - WallThickness * 0.5f, 0.055f, "Lip")),
            ["glowLip"] = keepMesh(Torus(96, 8, TankRadius + 0.05f, 0.016f, "GlowLip")),
            ["band"] = keepMesh(Tube(64, TankRadius + 0.006f, 0.07f, false, "Band")),
            ["floorRing"] = keepMesh(FlatRing(96, TankRadius + 0.24f, TankRadius + 0.29f, "FloorRing")),
            ["plinth"] = keepMesh(Cylinder(48, TankRadius + 0.14f, 0.1f, "Plinth")),
            ["shade"] = keepMesh(Cone(32, 0.42f, 0.08f, 0.3f, "LampShade")),
        };

        BuildBuilding(kura, p, markStatic);
        BuildScaffold(kura, p, markStatic);

        var tanksRoot = new GameObject("Tanks").transform;
        tanksRoot.SetParent(kura, false);
        for (int i = 0; i < TankCount; i++) BuildTank(tanksRoot, i, p, meshes, markStatic);

        BuildLamps(kura, p, meshes, markStatic);
        BuildToji(kura, p);
        return kura;
    }

    // ---------- 蔵：コンクリートの床、白い漆喰の壁、太い木の梁 ----------
    static void BuildBuilding(Transform kura, KuraPalette p, Action<GameObject> markStatic)
    {
        var b = new GameObject("Building").transform;
        b.SetParent(kura, false);
        const float W = 12f, Back = 9f, Front = -26f, H = 9.5f;
        float depth = Back - Front, midZ = (Back + Front) / 2f;

        markStatic(Box(b, "Floor", new Vector3(0, -0.05f, midZ), new Vector3(W * 2, 0.1f, depth), p.concrete));
        // 壁（漆喰）と腰板
        markStatic(Box(b, "WallBack", new Vector3(0, H / 2, Back + 0.15f), new Vector3(W * 2 + 0.6f, H, 0.3f), p.plaster));
        markStatic(Box(b, "WallLeft", new Vector3(-W - 0.15f, H / 2, midZ), new Vector3(0.3f, H, depth), p.plaster));
        markStatic(Box(b, "WallRight", new Vector3(W + 0.15f, H / 2, midZ), new Vector3(0.3f, H, depth), p.plaster));
        markStatic(Box(b, "WainscotBack", new Vector3(0, 0.55f, Back - 0.02f), new Vector3(W * 2, 1.1f, 0.06f), p.woodDark));
        markStatic(Box(b, "WainscotLeft", new Vector3(-W + 0.02f, 0.55f, midZ), new Vector3(0.06f, 1.1f, depth), p.woodDark));
        markStatic(Box(b, "WainscotRight", new Vector3(W - 0.02f, 0.55f, midZ), new Vector3(0.06f, 1.1f, depth), p.woodDark));
        // 長押（壁の中ほどの横木）
        markStatic(Box(b, "NageshiBack", new Vector3(0, 4.2f, Back - 0.04f), new Vector3(W * 2, 0.16f, 0.1f), p.wood));
        markStatic(Box(b, "NageshiLeft", new Vector3(-W + 0.04f, 4.2f, midZ), new Vector3(0.1f, 0.16f, depth), p.wood));
        markStatic(Box(b, "NageshiRight", new Vector3(W - 0.04f, 4.2f, midZ), new Vector3(0.1f, 0.16f, depth), p.wood));
        // 柱
        for (float x = -W; x <= W + 0.01f; x += 4f)
            markStatic(Box(b, "PillarBack", new Vector3(x, H / 2, Back - 0.05f), new Vector3(0.32f, H, 0.32f), p.wood));
        for (float z = Back - 4f; z >= Front; z -= 4f)
        {
            markStatic(Box(b, "PillarLeft", new Vector3(-W + 0.05f, H / 2, z), new Vector3(0.32f, H, 0.32f), p.wood));
            markStatic(Box(b, "PillarRight", new Vector3(W - 0.05f, H / 2, z), new Vector3(0.32f, H, 0.32f), p.wood));
        }
        // 梁（太い木）と桁。全体を見渡すカメラの視線をふさがないよう、タンクより奥にだけ渡す。天井は暗がりのまま
        foreach (var z in new[] { 7.2f, 3.6f, 0f })
            markStatic(Box(b, "Beam", new Vector3(0, 8.3f, z), new Vector3(W * 2, 0.6f, 0.42f), p.wood));
        markStatic(Box(b, "GirderLeft", new Vector3(-W + 0.25f, 8.8f, midZ), new Vector3(0.4f, 0.45f, depth), p.wood));
        markStatic(Box(b, "GirderRight", new Vector3(W - 0.25f, 8.8f, midZ), new Vector3(0.4f, 0.45f, depth), p.wood));
        // 高窓（障子紙が外の光で明るい）
        for (int i = -1; i <= 1; i++)
        {
            float x = i * 7f;
            markStatic(Box(b, "Window", new Vector3(x, 6.6f, Back - 0.03f), new Vector3(2.4f, 1.1f, 0.04f), p.windowPaper));
            markStatic(Box(b, "WindowFrameT", new Vector3(x, 7.18f, Back - 0.07f), new Vector3(2.6f, 0.08f, 0.08f), p.wood));
            markStatic(Box(b, "WindowFrameB", new Vector3(x, 6.02f, Back - 0.07f), new Vector3(2.6f, 0.08f, 0.08f), p.wood));
            for (int k = 0; k <= 4; k++)
                markStatic(Box(b, "WindowBar", new Vector3(x - 1.2f + k * 0.6f, 6.6f, Back - 0.07f), new Vector3(0.05f, 1.1f, 0.05f), p.wood));
        }
    }

    // ---------- 作業用の足場（2列のタンクの間の通路）とはしご ----------
    static void BuildScaffold(Transform kura, KuraPalette p, Action<GameObject> markStatic)
    {
        var s = new GameObject("Scaffold").transform;
        s.SetParent(kura, false);
        const float x0 = -8.0f, x1 = 7.9f, half = 0.66f, y = DeckHeight;
        float len = x1 - x0, cx = (x0 + x1) / 2f;
        // 踏み板（板を並べる）
        for (int i = 0; i < 6; i++)
        {
            float z = -half + 0.11f + i * 0.22f;
            markStatic(Box(s, "Plank", new Vector3(cx, y, z), new Vector3(len, 0.045f, 0.2f), p.plank));
        }
        markStatic(Box(s, "SideFront", new Vector3(cx, y - 0.07f, -half), new Vector3(len, 0.14f, 0.05f), p.steel));
        markStatic(Box(s, "SideBack", new Vector3(cx, y - 0.07f, half), new Vector3(len, 0.14f, 0.05f), p.steel));
        // 柱と手すり（タンクの間に立てる）
        float[] posts = { x0, -4.5f, -1.5f, 1.5f, 4.5f, x1 };
        foreach (var x in posts)
            foreach (var z in new[] { -half, half })
            {
                markStatic(Box(s, "Post", new Vector3(x, y / 2f, z), new Vector3(0.06f, y, 0.06f), p.steel));
                markStatic(Box(s, "RailPost", new Vector3(x, y + 0.5f, z), new Vector3(0.045f, 1.0f, 0.045f), p.steel));
            }
        foreach (var z in new[] { -half, half })
        {
            markStatic(Box(s, "Rail", new Vector3(cx, y + 1.0f, z), new Vector3(len, 0.045f, 0.045f), p.steel));
            markStatic(Box(s, "RailMid", new Vector3(cx, y + 0.5f, z), new Vector3(len, 0.03f, 0.03f), p.steel));
        }
        markStatic(Box(s, "RailEnd", new Vector3(x1, y + 1.0f, 0), new Vector3(0.045f, 0.045f, half * 2), p.steel));
        // 筋交い
        for (int i = 0; i < posts.Length - 1; i++)
        {
            float a = posts[i], b = posts[i + 1];
            var brace = Box(s, "Brace", new Vector3((a + b) / 2f, y / 2f, 0), new Vector3(0.035f, Mathf.Sqrt((b - a) * (b - a) + y * y) * 0.98f, 0.035f), p.steel);
            brace.transform.localRotation = Quaternion.Euler(0, 0, Mathf.Atan2(b - a, y) * Mathf.Rad2Deg);
            markStatic(brace);
        }
        // はしご（左端。床から足場へ斜めに）
        var ladder = new GameObject("Ladder").transform;
        ladder.SetParent(s, false);
        ladder.localPosition = new Vector3(x0 - 0.8f, 0, 0);
        ladder.localRotation = Quaternion.Euler(0, 0, -15f);
        float lh = y / Mathf.Cos(15f * Mathf.Deg2Rad) + 0.9f;
        foreach (var z in new[] { -0.26f, 0.26f })
            markStatic(Box(ladder, "Stile", new Vector3(0, lh / 2f, z), new Vector3(0.05f, lh, 0.07f), p.steel));
        for (float h = 0.28f; h < lh - 0.2f; h += 0.28f)
            markStatic(Box(ladder, "Rung", new Vector3(0, h, 0), new Vector3(0.035f, 0.035f, 0.52f), p.steel));
    }

    // ---------- タンク：白い琺瑯、厚みのある縁、台座、品温の帯と札、番号 ----------
    static void BuildTank(Transform root, int index, KuraPalette p, Dictionary<string, Mesh> m, Action<GameObject> markStatic)
    {
        string id = (index + 1).ToString();
        var t = new GameObject("Tank" + id).transform;
        t.SetParent(root, false);
        t.localPosition = TankPosition(index);

        var plinth = MeshObj(t, "Plinth", m["plinth"], p.plinth, Vector3.zero);
        markStatic(plinth);
        float baseY = PlinthHeight;

        var shell = MeshObj(t, "Shell", m["shellOuter"], p.enamel, new Vector3(0, baseY, 0));
        markStatic(shell);
        var col = shell.AddComponent<CapsuleCollider>();
        col.radius = TankRadius; col.height = TankHeight + 0.5f; col.center = new Vector3(0, TankHeight / 2f, 0);
        shell.AddComponent<TankClickTarget>().tankId = id;
        markStatic(MeshObj(shell.transform, "Inner", m["shellInner"], p.enamelInner, Vector3.zero));
        markStatic(MeshObj(shell.transform, "Bottom", m["shellBottom"], p.enamelInner, Vector3.zero));
        markStatic(MeshObj(shell.transform, "Lip", m["lip"], p.lip, new Vector3(0, TankHeight, 0)));
        // 胴の補強の帯（琺瑯タンクらしさ）
        var hoop = MeshObj(shell.transform, "Hoop", m["band"], p.lip, new Vector3(0, 0.35f, 0));
        hoop.transform.localScale = new Vector3(1.004f, 1.1f, 1.004f);
        markStatic(hoop);

        // 醪（液面）：実行時に高さを変えるので動く物
        var liquid = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        liquid.name = "Liquid";
        UnityEngine.Object.DestroyImmediate(liquid.GetComponent<Collider>());
        liquid.transform.SetParent(t, false);
        liquid.GetComponent<Renderer>().sharedMaterial = p.liquid;
        SetLiquid(liquid.transform, 0.7f);

        // 品温：縁の下の細い帯と、温度の札（色は控えめ）
        MeshObj(t, "Band", m["band"], p.band, new Vector3(0, baseY + TankHeight - 0.22f, 0));
        var tag = new GameObject("Tag").transform;
        tag.SetParent(t, false);
        float a = -118f * Mathf.Deg2Rad; // 正面（-z）から少し左
        tag.localPosition = new Vector3(Mathf.Cos(a) * (TankRadius + 0.02f), baseY + TankHeight - 0.5f, Mathf.Sin(a) * (TankRadius + 0.02f));
        tag.localRotation = Quaternion.LookRotation(new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)));
        Box(tag, "Board", Vector3.zero, new Vector3(0.36f, 0.19f, 0.018f), p.tag).transform.localRotation = Quaternion.identity;
        Box(tag, "Nail", new Vector3(0, 0.07f, 0.012f), new Vector3(0.02f, 0.02f, 0.01f), p.steel);
        var tt = Text(tag, "TagText", "", 120, 0.013f, new Color(0.12f, 0.1f, 0.08f), p.text);
        tt.transform.localPosition = new Vector3(0, -0.01f, 0.012f);
        tt.transform.localRotation = Quaternion.Euler(0, 180f, 0);

        // 番号（胴に描いた字）
        var num = Text(t, "Number", id, 160, 0.026f, new Color(0.42f, 0.11f, 0.08f), p.text);
        num.transform.localPosition = new Vector3(0, baseY + TankHeight * 0.52f, -TankRadius - 0.012f);

        // 変化があったときに控えめに光る縁と足元（ふだんは消しておく）
        var rimGlow = MeshObj(t, "RimGlow", m["glowLip"], p.glow, new Vector3(0, baseY + TankHeight - 0.02f, 0));
        rimGlow.GetComponent<Renderer>().enabled = false;
        var floorGlow = MeshObj(t, "FloorGlow", m["floorRing"], p.glow, new Vector3(0, 0.012f, 0));
        floorGlow.GetComponent<Renderer>().enabled = false;
    }

    public static void SetLiquid(Transform liquid, float level)
    {
        float h = Mathf.Max(0.002f, level * TankHeight * 0.96f);
        liquid.gameObject.SetActive(level > 0.001f);
        float r = (TankRadius - WallThickness) * 2f * 0.995f;
        liquid.localPosition = new Vector3(0, PlinthHeight + h / 2f, 0);
        liquid.localScale = new Vector3(r, h / 2f, r); // Cylinder は高さ2
    }

    // ---------- 照明（梁から下がる笠付きの電灯） ----------
    static void BuildLamps(Transform kura, KuraPalette p, Dictionary<string, Mesh> m, Action<GameObject> markStatic)
    {
        var l = new GameObject("Lamps").transform;
        l.SetParent(kura, false);
        float[] xs = { -6f, 0f, 6f };
        foreach (var x in xs)
        {
            var lamp = new GameObject("Lamp").transform;
            lamp.SetParent(l, false);
            lamp.localPosition = new Vector3(x, 6.9f, 0f);
            markStatic(Box(lamp, "Cord", new Vector3(0, 0.55f, 0), new Vector3(0.015f, 1.1f, 0.015f), p.steel));
            markStatic(MeshObj(lamp, "Shade", m["shade"], p.lampShade, Vector3.zero));
            var bulb = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            bulb.name = "Bulb";
            UnityEngine.Object.DestroyImmediate(bulb.GetComponent<Collider>());
            bulb.transform.SetParent(lamp, false);
            bulb.transform.localPosition = new Vector3(0, -0.06f, 0);
            bulb.transform.localScale = Vector3.one * 0.13f;
            bulb.GetComponent<Renderer>().sharedMaterial = p.lampBulb;
            markStatic(bulb);
        }
    }

    // ---------- 杜氏の仮キャラ（Tripo のモデルに差し替える予定） ----------
    static void BuildToji(Transform kura, KuraPalette p)
    {
        // 仮の杜氏：Tripo のモデルに差し替えるまで、足場の左端に立つ淡い色の人形にして目立たせない。吹き出しの位置（Head）だけ使う
        var toji = new GameObject("Toji").transform;
        toji.SetParent(kura, false);
        toji.localPosition = new Vector3(-7.4f, DeckHeight, 0.1f);
        toji.localRotation = Quaternion.Euler(0, 150, 0);
        var body = Prim(toji, PrimitiveType.Capsule, "Body", new Vector3(0, 0.72f, 0), new Vector3(0.4f, 0.72f, 0.3f), p.tojiCloth);
        UnityEngine.Object.DestroyImmediate(body.GetComponent<Collider>());
        Prim(toji, PrimitiveType.Sphere, "Head", new Vector3(0, 1.56f, 0), Vector3.one * 0.24f, p.tojiSkin);
    }

    // ---------- 部品 ----------
    static GameObject Box(Transform parent, string name, Vector3 pos, Vector3 scale, Material mat)
    {
        var g = GameObject.CreatePrimitive(PrimitiveType.Cube);
        g.name = name;
        UnityEngine.Object.DestroyImmediate(g.GetComponent<Collider>());
        g.transform.SetParent(parent, false);
        g.transform.localPosition = pos;
        g.transform.localScale = scale;
        g.GetComponent<Renderer>().sharedMaterial = mat;
        return g;
    }

    static GameObject Prim(Transform parent, PrimitiveType type, string name, Vector3 pos, Vector3 scale, Material mat)
    {
        var g = GameObject.CreatePrimitive(type);
        g.name = name;
        g.transform.SetParent(parent, false);
        g.transform.localPosition = pos;
        g.transform.localScale = scale;
        g.GetComponent<Renderer>().sharedMaterial = mat;
        if (type != PrimitiveType.Capsule) UnityEngine.Object.DestroyImmediate(g.GetComponent<Collider>());
        return g;
    }

    static GameObject MeshObj(Transform parent, string name, Mesh mesh, Material mat, Vector3 pos)
    {
        var g = new GameObject(name);
        g.transform.SetParent(parent, false);
        g.transform.localPosition = pos;
        g.AddComponent<MeshFilter>().sharedMesh = mesh;
        g.AddComponent<MeshRenderer>().sharedMaterial = mat;
        return g;
    }

    static TextMesh Text(Transform parent, string name, string text, int size, float charSize, Color color, Material mat)
    {
        var g = new GameObject(name);
        g.transform.SetParent(parent, false);
        var tm = g.AddComponent<TextMesh>();
        tm.text = text; tm.fontSize = size; tm.characterSize = charSize;
        tm.anchor = TextAnchor.MiddleCenter; tm.alignment = TextAlignment.Center;
        tm.color = color;
        tm.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        g.GetComponent<MeshRenderer>().sharedMaterial = mat != null ? mat : tm.font.material;
        return tm;
    }

    // ---------- メッシュ ----------
    // 円筒の側面（inward=true なら内向き）。高さ0〜h
    static Mesh Tube(int seg, float r, float h, bool inward, string name)
    {
        var v = new List<Vector3>(); var n = new List<Vector3>(); var uv = new List<Vector2>(); var tri = new List<int>();
        for (int i = 0; i <= seg; i++)
        {
            float a = i * Mathf.PI * 2 / seg;
            var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
            v.Add(d * r); v.Add(d * r + Vector3.up * h);
            var nn = inward ? -d : d; n.Add(nn); n.Add(nn);
            float u = (float)i / seg * 4f;
            uv.Add(new Vector2(u, 0)); uv.Add(new Vector2(u, h / 2f));
        }
        for (int i = 0; i < seg; i++)
        {
            int a0 = i * 2, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3;
            if (inward) tri.AddRange(new[] { a0, a1, b0, a1, b1, b0 });
            else tri.AddRange(new[] { a0, b0, a1, a1, b0, b1 });
        }
        return Make(name, v, n, uv, tri);
    }

    static Mesh Disc(int seg, float r, float y, string name)
    {
        var v = new List<Vector3> { new Vector3(0, y, 0) }; var n = new List<Vector3> { Vector3.up };
        var uv = new List<Vector2> { new Vector2(0.5f, 0.5f) }; var tri = new List<int>();
        for (int i = 0; i <= seg; i++)
        {
            float a = i * Mathf.PI * 2 / seg;
            v.Add(new Vector3(Mathf.Cos(a) * r, y, Mathf.Sin(a) * r)); n.Add(Vector3.up);
            uv.Add(new Vector2(0.5f + Mathf.Cos(a) * 0.5f, 0.5f + Mathf.Sin(a) * 0.5f));
        }
        for (int i = 0; i < seg; i++) tri.AddRange(new[] { 0, i + 2, i + 1 });
        return Make(name, v, n, uv, tri);
    }

    // 上下に蓋のある円柱（台座）
    static Mesh Cylinder(int seg, float r, float h, string name)
    {
        var v = new List<Vector3>(); var n = new List<Vector3>(); var uv = new List<Vector2>(); var tri = new List<int>();
        for (int i = 0; i <= seg; i++)
        {
            float a = i * Mathf.PI * 2 / seg;
            var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
            v.Add(d * r); v.Add(d * r + Vector3.up * h); n.Add(d); n.Add(d);
            uv.Add(new Vector2((float)i / seg * 4, 0)); uv.Add(new Vector2((float)i / seg * 4, h));
        }
        for (int i = 0; i < seg; i++) { int a0 = i * 2; tri.AddRange(new[] { a0, a0 + 1, a0 + 2, a0 + 2, a0 + 1, a0 + 3 }); }
        int c = v.Count; v.Add(Vector3.up * h); n.Add(Vector3.up); uv.Add(new Vector2(0.5f, 0.5f));
        for (int i = 0; i <= seg; i++)
        {
            float a = i * Mathf.PI * 2 / seg;
            v.Add(new Vector3(Mathf.Cos(a) * r, h, Mathf.Sin(a) * r)); n.Add(Vector3.up);
            uv.Add(new Vector2(0.5f + Mathf.Cos(a) * 0.5f, 0.5f + Mathf.Sin(a) * 0.5f));
        }
        for (int i = 0; i < seg; i++) tri.AddRange(new[] { c, c + i + 2, c + i + 1 });
        return Make(name, v, n, uv, tri);
    }

    // 床に置く平らな輪
    static Mesh FlatRing(int seg, float r0, float r1, string name)
    {
        var v = new List<Vector3>(); var n = new List<Vector3>(); var uv = new List<Vector2>(); var tri = new List<int>();
        for (int i = 0; i <= seg; i++)
        {
            float a = i * Mathf.PI * 2 / seg;
            var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
            v.Add(d * r0); v.Add(d * r1); n.Add(Vector3.up); n.Add(Vector3.up);
            uv.Add(new Vector2((float)i / seg, 0)); uv.Add(new Vector2((float)i / seg, 1));
        }
        for (int i = 0; i < seg; i++) { int a = i * 2; tri.AddRange(new[] { a, a + 2, a + 1, a + 2, a + 3, a + 1 }); }
        return Make(name, v, n, uv, tri);
    }

    static Mesh Torus(int seg, int tubeSeg, float R, float r, string name)
    {
        var v = new List<Vector3>(); var n = new List<Vector3>(); var uv = new List<Vector2>(); var tri = new List<int>();
        for (int i = 0; i <= seg; i++)
        {
            float a = i * Mathf.PI * 2 / seg;
            var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
            for (int j = 0; j <= tubeSeg; j++)
            {
                float b = j * Mathf.PI * 2 / tubeSeg;
                var nn = d * Mathf.Cos(b) + Vector3.up * Mathf.Sin(b);
                v.Add(d * R + nn * r); n.Add(nn);
                uv.Add(new Vector2((float)i / seg * 8, (float)j / tubeSeg));
            }
        }
        int row = tubeSeg + 1;
        for (int i = 0; i < seg; i++)
            for (int j = 0; j < tubeSeg; j++)
            {
                int a0 = i * row + j, a1 = (i + 1) * row + j;
                tri.AddRange(new[] { a0, a0 + 1, a1, a1, a0 + 1, a1 + 1 });
            }
        return Make(name, v, n, uv, tri);
    }

    // 電灯の笠（下が広い円錐の筒、両面）
    static Mesh Cone(int seg, float rBottom, float rTop, float h, string name)
    {
        var v = new List<Vector3>(); var n = new List<Vector3>(); var uv = new List<Vector2>(); var tri = new List<int>();
        for (int side = 0; side < 2; side++)
        {
            int start = v.Count;
            for (int i = 0; i <= seg; i++)
            {
                float a = i * Mathf.PI * 2 / seg;
                var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                var nn = (d * h + Vector3.up * (rBottom - rTop)).normalized;
                if (side == 1) nn = -nn;
                v.Add(d * rBottom); v.Add(d * rTop + Vector3.up * h); n.Add(nn); n.Add(nn);
                uv.Add(new Vector2((float)i / seg, 0)); uv.Add(new Vector2((float)i / seg, 1));
            }
            for (int i = 0; i < seg; i++)
            {
                int a0 = start + i * 2, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3;
                if (side == 0) tri.AddRange(new[] { a0, b0, a1, a1, b0, b1 });
                else tri.AddRange(new[] { a0, a1, b0, a1, b1, b0 });
            }
        }
        return Make(name, v, n, uv, tri);
    }

    static Mesh Make(string name, List<Vector3> v, List<Vector3> n, List<Vector2> uv, List<int> tri)
    {
        var m = new Mesh { name = name };
        m.SetVertices(v); m.SetNormals(n); m.SetUVs(0, uv); m.SetTriangles(tri, 0);
        m.RecalculateTangents(); m.RecalculateBounds();
        return m;
    }
}
