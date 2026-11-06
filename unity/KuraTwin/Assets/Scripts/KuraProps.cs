using System;
using System.Collections.Generic;
using UnityEngine;

// 蔵ツイン：酒蔵の現場らしさを足す小物。タンクと杜氏が主役のままになるよう、控えめに置く。
// 神棚・床の水の跡と排水の溝・床を這うホースと壁のホースリール・立てかけた櫂・タンクの覆いと手書きの札・仕込み予定の黒板・換気扇とダクト
public static partial class KuraScene
{
    static void BuildProps(Transform kura, KuraPalette p, Func<Mesh, Mesh> keepMesh, Action<GameObject> markStatic)
    {
        if (p.hose == null) return;
        var props = new GameObject("Props").transform;
        props.SetParent(kura, false);
        BuildFloorWet(props, p, markStatic);
        BuildHose(props, p, keepMesh, markStatic);
        BuildKai(props, p, markStatic);
        BuildKamidana(props, p, markStatic);
        BuildBlackboard(props, p, markStatic);
        BuildFanAndDuct(props, p, keepMesh, markStatic);
        BuildTankCoversAndTags(kura, p, keepMesh, markStatic);
    }

    // ---------- 床：排水の溝と、水の跡（濡れてつやのある所） ----------
    static void BuildFloorWet(Transform props, KuraPalette p, Action<GameObject> markStatic)
    {
        var floor = new GameObject("Floor").transform;
        floor.SetParent(props, false);
        // 手前の列の前を横切る排水の溝（鉄の格子のふた）
        markStatic(Box(floor, "DrainEdge", new Vector3(0, 0.003f, -3.85f), new Vector3(19.6f, 0.006f, 0.42f), p.steel));
        markStatic(Box(floor, "DrainGrating", new Vector3(0, 0.008f, -3.85f), new Vector3(19.4f, 0.006f, 0.32f), p.grating));
        // 奥の壁ぎわの溝
        markStatic(Box(floor, "DrainBack", new Vector3(0, 0.008f, 8.3f), new Vector3(22f, 0.006f, 0.28f), p.grating));
        // 水の跡（溝のまわり・タンクの足元・ホースの先）
        var spots = new (Vector3 pos, Vector2 size, float rot)[]
        {
            (new Vector3(-3.4f, 0, -4.3f), new Vector2(3.2f, 1.4f), 8f),
            (new Vector3(2.6f, 0, -4.4f), new Vector2(2.4f, 1.1f), -12f),
            (new Vector3(-0.6f, 0, -3.3f), new Vector2(1.6f, 1.0f), 30f),
            (new Vector3(6.4f, 0, -3.5f), new Vector2(1.8f, 1.2f), 70f),
            (new Vector3(-7.8f, 0, -4.0f), new Vector2(2.0f, 1.0f), -20f),
            (new Vector3(1.2f, 0, 5.0f), new Vector2(3.0f, 1.6f), 15f),
            (new Vector3(-1.5f, 0, 0.2f), new Vector2(2.2f, 1.3f), -35f),
            (new Vector3(4.5f, 0, -0.2f), new Vector2(1.8f, 1.2f), 50f),
            (new Vector3(-6.2f, 0, 4.6f), new Vector2(2.6f, 1.4f), 10f),
            (new Vector3(7.8f, 0, 5.4f), new Vector2(2.0f, 1.2f), -60f),
        };
        int i = 0;
        foreach (var (pos, size, rot) in spots)
        {
            var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
            q.name = "Wet" + i++;
            UnityEngine.Object.DestroyImmediate(q.GetComponent<Collider>());
            q.transform.SetParent(floor, false);
            q.transform.localPosition = pos + Vector3.up * (0.012f + i * 0.0006f);
            q.transform.localRotation = Quaternion.Euler(90f, rot, 0f);
            q.transform.localScale = new Vector3(size.x, size.y, 1f);
            var r = q.GetComponent<Renderer>();
            r.sharedMaterial = p.wet; r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        }
    }

    // ---------- 壁のホースリールと、床を這う太いホース ----------
    static void BuildHose(Transform props, KuraPalette p, Func<Mesh, Mesh> keepMesh, Action<GameObject> markStatic)
    {
        var h = new GameObject("Hose").transform;
        h.SetParent(props, false);
        // 左の壁のリール（壁に付けた金具・巻き胴・巻いたホース）
        var reel = new GameObject("Reel").transform;
        reel.SetParent(h, false);
        reel.localPosition = new Vector3(-11.6f, 1.25f, -1.4f);
        reel.localRotation = Quaternion.Euler(0, 0, 90f); // 胴の軸を壁に直角（x向き）に
        markStatic(Box(h, "ReelBracket", new Vector3(-11.8f, 1.25f, -1.4f), new Vector3(0.06f, 0.7f, 0.5f), p.steel));
        markStatic(Prim(reel, PrimitiveType.Cylinder, "Drum", Vector3.zero, new Vector3(0.36f, 0.14f, 0.36f), p.steel));
        markStatic(Prim(reel, PrimitiveType.Cylinder, "FlangeA", new Vector3(0, 0.15f, 0), new Vector3(0.9f, 0.01f, 0.9f), p.steel));
        markStatic(Prim(reel, PrimitiveType.Cylinder, "FlangeB", new Vector3(0, -0.15f, 0), new Vector3(0.9f, 0.01f, 0.9f), p.steel));
        var coil = keepMesh(Torus(40, 10, 0.3f, 0.045f, "HoseCoil"));
        for (int k = 0; k < 3; k++)
        {
            var c = MeshObj(reel, "Coil" + k, coil, p.hose, new Vector3(0, -0.09f + k * 0.09f, 0));
            markStatic(c);
        }
        // 床を這うホース：リールから床へ下り、手前の列の前を通って、先が少し曲がる
        var path = new List<Vector3>
        {
            new Vector3(-11.45f, 1.0f, -1.4f), new Vector3(-11.25f, 0.4f, -1.7f), new Vector3(-11.0f, 0.05f, -2.3f),
            new Vector3(-9.8f, 0.05f, -3.3f), new Vector3(-7.6f, 0.05f, -3.45f), new Vector3(-5.2f, 0.05f, -3.35f),
            new Vector3(-3.0f, 0.05f, -3.5f), new Vector3(-1.4f, 0.05f, -3.35f), new Vector3(-0.5f, 0.05f, -2.95f), new Vector3(-0.2f, 0.05f, -3.35f),
        };
        markStatic(MeshObj(h, "FloorHose", keepMesh(TubeAlong(Smooth(path, 8), 0.05f, 10, "FloorHose")), p.hose, Vector3.zero));
        // 先の口金
        var nozzle = Prim(h, PrimitiveType.Cylinder, "Nozzle", new Vector3(-0.2f, 0.05f, -3.42f), new Vector3(0.07f, 0.09f, 0.07f), p.steel);
        nozzle.transform.localRotation = Quaternion.Euler(90f, 0, 0);
        markStatic(nozzle);
    }

    // ---------- 長い櫂（壁とタンクに立てかける） ----------
    static void BuildKai(Transform props, KuraPalette p, Action<GameObject> markStatic)
    {
        var k = new GameObject("Kai").transform;
        k.SetParent(props, false);
        // 奥の壁に3本、10号のタンクに1本
        Kai(k, new Vector3(2.3f, 0f, 8.25f), new Vector3(2.45f, 3.3f, 8.92f), p, markStatic);
        Kai(k, new Vector3(2.75f, 0f, 8.3f), new Vector3(2.8f, 3.25f, 8.92f), p, markStatic);
        Kai(k, new Vector3(-9.3f, 0f, 8.3f), new Vector3(-9.1f, 3.3f, 8.92f), p, markStatic);
        Kai(k, new Vector3(7.55f, 0f, 1.6f), new Vector3(7.02f, 3.05f, 1.9f), p, markStatic);
    }

    static void Kai(Transform parent, Vector3 bottom, Vector3 top, KuraPalette p, Action<GameObject> markStatic)
    {
        var kai = new GameObject("KaiPole").transform;
        kai.SetParent(parent, false);
        var dir = top - bottom;
        kai.localPosition = bottom;
        kai.localRotation = Quaternion.FromToRotation(Vector3.up, dir.normalized);
        float len = dir.magnitude;
        // 柄（細い丸棒）と、下の先の板（醪をかき混ぜる所）
        markStatic(Prim(kai, PrimitiveType.Cylinder, "Shaft", new Vector3(0, len / 2f + 0.15f, 0), new Vector3(0.045f, len / 2f - 0.1f, 0.045f), p.plank));
        markStatic(Box(kai, "Blade", new Vector3(0, 0.16f, 0), new Vector3(0.26f, 0.3f, 0.03f), p.plank));
        markStatic(Box(kai, "Grip", new Vector3(0, len + 0.05f, 0), new Vector3(0.16f, 0.04f, 0.04f), p.plank));
    }

    // ---------- 神棚（梁の上。お札は無地） ----------
    static void BuildKamidana(Transform props, KuraPalette p, Action<GameObject> markStatic)
    {
        var g = new GameObject("Kamidana").transform;
        g.SetParent(props, false);
        g.localPosition = new Vector3(-0.2f, 8.6f, 7.15f); // 奥の梁の上（梁の上面）
        markStatic(Box(g, "Shelf", new Vector3(0, 0.03f, 0), new Vector3(1.6f, 0.06f, 0.5f), p.hinoki));
        markStatic(Box(g, "Base", new Vector3(0, 0.09f, 0.04f), new Vector3(0.62f, 0.06f, 0.34f), p.hinoki));
        markStatic(Box(g, "Shrine", new Vector3(0, 0.33f, 0.05f), new Vector3(0.44f, 0.42f, 0.26f), p.hinoki));
        var roofL = Box(g, "RoofL", new Vector3(-0.15f, 0.6f, 0.05f), new Vector3(0.38f, 0.035f, 0.36f), p.wood);
        roofL.transform.localRotation = Quaternion.Euler(0, 0, 24f);
        var roofR = Box(g, "RoofR", new Vector3(0.15f, 0.6f, 0.05f), new Vector3(0.38f, 0.035f, 0.36f), p.wood);
        roofR.transform.localRotation = Quaternion.Euler(0, 0, -24f);
        markStatic(roofL); markStatic(roofR);
        markStatic(Box(g, "Ofuda", new Vector3(0, 0.33f, -0.085f), new Vector3(0.11f, 0.3f, 0.01f), p.shide)); // お札（無地）
        foreach (var x in new[] { -0.55f, 0.55f })
        {
            markStatic(Prim(g, PrimitiveType.Cylinder, "Vase", new Vector3(x, 0.14f, 0.02f), new Vector3(0.09f, 0.08f, 0.09f), p.shide));
            markStatic(Prim(g, PrimitiveType.Sphere, "Sakaki", new Vector3(x, 0.32f, 0.02f), new Vector3(0.22f, 0.26f, 0.16f), p.sakaki));
        }
        // 注連縄と紙垂
        var rope = Prim(g, PrimitiveType.Cylinder, "Shimenawa", new Vector3(0, 0.78f, -0.22f), new Vector3(0.05f, 0.85f, 0.05f), p.straw);
        rope.transform.localRotation = Quaternion.Euler(0, 0, 90f);
        markStatic(rope);
        foreach (var x in new[] { -0.5f, 0f, 0.5f })
            markStatic(Box(g, "Shide", new Vector3(x, 0.66f, -0.22f), new Vector3(0.07f, 0.2f, 0.005f), p.shide));
    }

    // ---------- 仕込み予定の黒板（手書き） ----------
    static void BuildBlackboard(Transform props, KuraPalette p, Action<GameObject> markStatic)
    {
        var b = new GameObject("Blackboard").transform;
        b.SetParent(props, false);
        b.localPosition = new Vector3(4.6f, 4.3f, 8.93f);
        markStatic(Box(b, "Frame", Vector3.zero, new Vector3(2.5f, 1.45f, 0.05f), p.wood));
        markStatic(Box(b, "Board", new Vector3(0, 0, -0.03f), new Vector3(2.32f, 1.28f, 0.02f), p.blackboard));
        markStatic(Box(b, "Tray", new Vector3(0, -0.74f, -0.06f), new Vector3(2.3f, 0.04f, 0.1f), p.wood));
        // 日付とタンク番号だけはチョークの数字で（日本語の字は手書き風の線で表す）
        string[] rows = { "1/8", "1/11", "1/14", "1/17", "1/20" };
        for (int r = 0; r < rows.Length; r++)
        {
            var t = Text(b, "Chalk" + r, rows[r], 90, 0.02f, new Color(0.93f, 0.93f, 0.88f), p.text);
            t.anchor = TextAnchor.MiddleLeft;
            t.transform.localPosition = new Vector3(-1.04f, 0.38f - r * 0.2f, -0.045f);
        }
    }

    // ---------- 換気扇とダクト ----------
    static void BuildFanAndDuct(Transform props, KuraPalette p, Func<Mesh, Mesh> keepMesh, Action<GameObject> markStatic)
    {
        var f = new GameObject("Fan").transform;
        f.SetParent(props, false);
        f.localPosition = new Vector3(-9.4f, 6.1f, 8.9f);
        markStatic(Box(f, "Housing", Vector3.zero, new Vector3(0.95f, 0.95f, 0.22f), p.steel));
        var ring = MeshObj(f, "Ring", keepMesh(Torus(36, 8, 0.4f, 0.025f, "FanRing")), p.lip, new Vector3(0, 0, -0.13f));
        ring.transform.localRotation = Quaternion.Euler(90f, 0, 0);
        markStatic(ring);
        var blades = new GameObject("FanBlades").transform; // 実行時にゆっくり回す（KuraBridge）
        blades.SetParent(f, false);
        blades.localPosition = new Vector3(0, 0, -0.1f);
        for (int i = 0; i < 4; i++)
        {
            var bl = Box(blades, "Blade" + i, Vector3.zero, new Vector3(0.12f, 0.34f, 0.01f), p.steel);
            bl.transform.localRotation = Quaternion.Euler(0, 20f, i * 90f);
            bl.transform.localPosition = bl.transform.localRotation * new Vector3(0, 0.18f, 0);
        }
        Prim(blades, PrimitiveType.Sphere, "Hub", Vector3.zero, Vector3.one * 0.1f, p.steel);
        // 丸いダクト：換気扇から上へ、梁の上で奥の壁に沿って右へ
        var duct = keepMesh(TubeAlong(new List<Vector3>
        {
            new Vector3(-9.4f, 6.55f, 8.82f), new Vector3(-9.4f, 7.6f, 8.82f), new Vector3(-9.0f, 7.95f, 8.82f), new Vector3(11.4f, 7.95f, 8.82f),
        }, 0.2f, 14, "Duct"));
        markStatic(MeshObj(f.parent, "Duct", duct, p.lip, Vector3.zero));
    }

    // ---------- タンクの覆い（空のタンクだけ。KuraBridge が出し入れする）と、手書きの札 ----------
    static void BuildTankCoversAndTags(Transform kura, KuraPalette p, Func<Mesh, Mesh> keepMesh, Action<GameObject> markStatic)
    {
        float rimY = PlinthHeight + TankHeight;
        for (int i = 0; i < TankCount; i++)
        {
            var t = kura.Find("Tanks/Tank" + (i + 1));
            if (t == null) continue;
            // 覆い：偶数番は布（深くたるみ、大きなしわ）、奇数番はビニール（浅いたるみ、細かい折れ）。ふだんは隠しておく
            bool cloth = i % 2 == 0;
            var cover = new GameObject("Cover").transform;
            cover.SetParent(t, false);
            cover.localPosition = new Vector3(0, rimY, 0);
            cover.localRotation = Quaternion.Euler(0, i * 47f, 0);
            var mesh = keepMesh(DrapeMesh(i, cloth ? 0.16f : 0.07f, cloth ? 1f : 0.55f, cloth, $"Cover{i + 1}"));
            var mr = MeshObj(cover, "Sheet", mesh, cloth ? p.cloth : p.vinyl, Vector3.zero).GetComponent<MeshRenderer>();
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.TwoSided;
            // 縄：縁の少し下を一周し、正面寄りで結んで端が垂れる
            MeshObj(cover, "Rope", keepMesh(Torus(64, 6, TankRadius + 0.07f, 0.02f, $"CoverRope{i + 1}")), p.straw, new Vector3(0, -0.1f, 0));
            float ka = -100f * Mathf.Deg2Rad;
            var knotPos = new Vector3(Mathf.Cos(ka) * (TankRadius + 0.1f), -0.1f, Mathf.Sin(ka) * (TankRadius + 0.1f));
            Prim(cover, PrimitiveType.Sphere, "Knot", knotPos, new Vector3(0.07f, 0.06f, 0.07f), p.straw);
            for (int e = 0; e < 2; e++)
            {
                var end = Prim(cover, PrimitiveType.Cylinder, "RopeEnd" + e, knotPos + new Vector3(0.02f * (e * 2 - 1), -0.12f - e * 0.03f, 0f), new Vector3(0.025f, 0.11f + e * 0.03f, 0.025f), p.straw);
                end.transform.localRotation = Quaternion.Euler(0, 0, (e * 2 - 1) * 12f);
            }
            cover.gameObject.SetActive(false);

            // 手書きの札（一部のタンクだけ。字は手書き風の線）
            if (i == 1 || i == 3 || i == 6 || i == 8)
            {
                float a = -62f * Mathf.Deg2Rad;
                var tag = Box(t, "PaperTag", new Vector3(Mathf.Cos(a) * (TankRadius + 0.012f), PlinthHeight + TankHeight - 0.75f, Mathf.Sin(a) * (TankRadius + 0.012f)),
                    new Vector3(0.24f, 0.34f, 0.004f), p.paperTag);
                tag.transform.localRotation = Quaternion.LookRotation(-new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a))) * Quaternion.Euler(0, 0, (i % 3 - 1) * 3f);
                markStatic(tag);
            }
        }
    }

    // 覆いの布：縁に掛けて中がたるみ（sag）、上面に放射状のしわ、縄の下は外へ少し広がって裾にひだ、裾の長さは不ぞろい
    static Mesh DrapeMesh(int seed, float sag, float wrinkle, bool cloth, string name)
    {
        const int seg = 72, rings = 10, skirtRows = 7;
        float R = TankRadius + 0.075f;
        var rng = new System.Random(seed * 7919 + 13);
        float ph1 = (float)rng.NextDouble() * 6.28f, ph2 = (float)rng.NextDouble() * 6.28f, ph3 = (float)rng.NextDouble() * 6.28f;
        int folds = cloth ? 9 + seed % 3 : 14 + seed % 4;
        float Wrinkle(float th, float s) => wrinkle * s * (0.022f * Mathf.Sin(th * 5f + ph1 + s * 2.5f) + 0.012f * Mathf.Sin(th * 11f + ph2) + 0.008f * Mathf.Sin(th * 17f + ph3 + s * 4f));
        float Fold(float th) => (cloth ? 0.035f : 0.02f) * Mathf.Sin(th * folds + ph2) + 0.012f * Mathf.Sin(th * (folds * 2 + 3) + ph1);
        float Hem(float th) => (cloth ? 0.3f : 0.24f) + 0.07f * Mathf.Sin(th * 2f + ph3) + 0.04f * Mathf.Sin(th * 5f + ph1);

        var v = new List<Vector3>(); var uv = new List<Vector2>(); var tri = new List<int>();
        int cols = seg + 1, rows = rings + 1 + skirtRows;
        for (int r = 0; r < rows; r++)
            for (int j = 0; j <= seg; j++)
            {
                float th = j * Mathf.PI * 2f / seg;
                var d = new Vector3(Mathf.Cos(th), 0, Mathf.Sin(th));
                Vector3 pt;
                if (r <= rings)
                {
                    // 上面：中ほどがたるみ、縁に近いほどしわ
                    float sN = (float)r / rings;
                    float y = 0.035f - sag * (1f - sN * sN) * (1f + 0.15f * Mathf.Sin(th * 2f + ph1)) + Wrinkle(th, sN);
                    pt = d * (R * sN) + Vector3.up * y;
                }
                else
                {
                    // 裾：縁から下へ。縄（-0.1）までは張り、その下はひだを付けて少し外へ
                    float k = (float)(r - rings) / skirtRows;
                    float y = 0.035f - (Hem(th) + 0.035f) * k;
                    float below = Mathf.Clamp01((-y - 0.1f) / 0.2f);
                    float rr = R + 0.005f + below * (0.03f + Fold(th));
                    pt = d * rr + Vector3.up * y;
                }
                v.Add(pt);
                uv.Add(new Vector2((float)j / seg * 4f, (float)r / rows * 2f));
            }
        for (int r = 0; r < rows - 1; r++)
            for (int j = 0; j < seg; j++)
            {
                int a0 = r * cols + j, a1 = a0 + 1, b0 = a0 + cols, b1 = b0 + 1;
                tri.AddRange(new[] { a0, b0, a1, a1, b0, b1 });
            }
        var m = new Mesh { name = name };
        m.SetVertices(v); m.SetUVs(0, uv); m.SetTriangles(tri, 0);
        m.RecalculateNormals();
        // 面の向きを外（上）にそろえる（材質は両面描き）
        if (m.normals[seg / 4 + (rings / 2) * cols].y < 0f)
        {
            for (int i = 0; i < tri.Count; i += 3) (tri[i + 1], tri[i + 2]) = (tri[i + 2], tri[i + 1]);
            m.SetTriangles(tri, 0);
            m.RecalculateNormals();
        }
        m.RecalculateTangents(); m.RecalculateBounds();
        return m;
    }

    // ---------- メッシュ：点の列に沿った管（ホース・ダクト） ----------
    static List<Vector3> Smooth(List<Vector3> pts, int steps)
    {
        var o = new List<Vector3>();
        for (int i = 0; i < pts.Count - 1; i++)
        {
            Vector3 p0 = pts[Mathf.Max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Mathf.Min(pts.Count - 1, i + 2)];
            for (int s = 0; s < steps; s++)
            {
                float t = (float)s / steps, t2 = t * t, t3 = t2 * t;
                o.Add(0.5f * (2f * p1 + (-p0 + p2) * t + (2f * p0 - 5f * p1 + 4f * p2 - p3) * t2 + (-p0 + 3f * p1 - 3f * p2 + p3) * t3));
            }
        }
        o.Add(pts[pts.Count - 1]);
        return o;
    }

    static Mesh TubeAlong(List<Vector3> pts, float r, int seg, string name)
    {
        var v = new List<Vector3>(); var n = new List<Vector3>(); var uv = new List<Vector2>(); var tri = new List<int>();
        Vector3 prevNormal = Vector3.up;
        for (int i = 0; i < pts.Count; i++)
        {
            var fwd = (pts[Mathf.Min(i + 1, pts.Count - 1)] - pts[Mathf.Max(i - 1, 0)]).normalized;
            var side = Vector3.Cross(fwd, prevNormal);
            if (side.sqrMagnitude < 1e-4f) side = Vector3.Cross(fwd, Vector3.right);
            side.Normalize();
            var up = Vector3.Cross(side, fwd).normalized;
            prevNormal = up;
            for (int j = 0; j <= seg; j++)
            {
                float a = j * Mathf.PI * 2f / seg;
                var d = side * Mathf.Cos(a) + up * Mathf.Sin(a);
                v.Add(pts[i] + d * r); n.Add(d); uv.Add(new Vector2((float)j / seg, i * 0.2f));
            }
        }
        int row = seg + 1;
        for (int i = 0; i < pts.Count - 1; i++)
            for (int j = 0; j < seg; j++)
            {
                int a0 = i * row + j, a1 = (i + 1) * row + j;
                tri.AddRange(new[] { a0, a1, a0 + 1, a0 + 1, a1, a1 + 1 });
            }
        return Make(name, v, n, uv, tri);
    }
}
