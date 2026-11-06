using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

// 蔵ツイン：描画の設定（URP・影・間接光・色調補正）、シーンの用意、確認用の撮影、WebGL 書き出し。
// メニュー「Kura」から、またはコマンド（-executeMethod KuraBuild.SetupAndBuild など）で実行する。
public static class KuraBuild
{
    const string ScenePath = "Assets/Scenes/Kura.unity";
    const string RenderDir = "Assets/Rendering";
    const string MatDir = "Assets/Materials";
    const string TexDir = "Assets/Textures";
    const string MeshDir = "Assets/Generated";
    const string BuildDir = "Builds/kura"; // → Builds/kura/Build/kura.loader.js など

    static string WebUnityDir => Path.GetFullPath(Path.Combine(Application.dataPath, "../../../web/public/unity"));
    static string ShotDir => Path.GetFullPath(Path.Combine(Application.dataPath, "../../../docs/screenshots"));

    // ================= 描画の設定（URP） =================
    static UniversalRenderPipelineAsset EnsurePipeline()
    {
        Directory.CreateDirectory(RenderDir);
        string assetPath = RenderDir + "/KuraURP.asset", rendererPath = RenderDir + "/KuraURP_Renderer.asset";
        var asset = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(assetPath);
        if (asset == null)
        {
            var data = ScriptableObject.CreateInstance<UniversalRendererData>();
            data.postProcessData = AssetDatabase.LoadAssetAtPath<PostProcessData>("Packages/com.unity.render-pipelines.universal/Runtime/Data/PostProcessData.asset");
            AssetDatabase.CreateAsset(data, rendererPath);

            // やわらかい陰（SSAO：物の付け根や角に落ちる間接光の陰）
            var ssao = ScriptableObject.CreateInstance<ScreenSpaceAmbientOcclusion>();
            ssao.name = "SSAO";
            AssetDatabase.AddObjectToAsset(ssao, data);
            var so = new SerializedObject(ssao);
            so.FindProperty("m_Settings.Intensity").floatValue = 1.4f;
            so.FindProperty("m_Settings.Radius").floatValue = 0.35f;
            so.FindProperty("m_Settings.DirectLightingStrength").floatValue = 0.3f;
            so.FindProperty("m_Settings.Falloff").floatValue = 40f;
            so.ApplyModifiedPropertiesWithoutUndo();
            AssetDatabase.TryGetGUIDAndLocalFileIdentifier(ssao, out string _, out long localId);
            var dso = new SerializedObject(data);
            var feats = dso.FindProperty("m_RendererFeatures");
            feats.arraySize = 1; feats.GetArrayElementAtIndex(0).objectReferenceValue = ssao;
            var map = dso.FindProperty("m_RendererFeatureMap");
            map.arraySize = 1; map.GetArrayElementAtIndex(0).longValue = localId;
            dso.ApplyModifiedPropertiesWithoutUndo();

            asset = UniversalRenderPipelineAsset.Create(data);
            AssetDatabase.CreateAsset(asset, assetPath);
        }
        var a = new SerializedObject(asset);
        void Set(string name, Action<SerializedProperty> f) { var p = a.FindProperty(name); if (p != null) f(p); else Debug.LogWarning("[Kura] URP 設定が見つかりません: " + name); }
        Set("m_SupportsHDR", p => p.boolValue = true);
        Set("m_MSAA", p => p.intValue = 4);
        Set("m_RenderScale", p => p.floatValue = 1f);
        Set("m_UpscalingFilter", p => p.intValue = 1); // Bilinear（FSR は WebGL で使えず警告が出るため）
        Set("m_MainLightShadowsSupported", p => p.boolValue = true);
        Set("m_MainLightShadowmapResolution", p => p.intValue = 2048);
        Set("m_AdditionalLightShadowsSupported", p => p.boolValue = true);
        Set("m_AdditionalLightsShadowmapResolution", p => p.intValue = 2048);
        Set("m_AdditionalLightsPerObjectLimit", p => p.intValue = 4);
        Set("m_ShadowDistance", p => p.floatValue = 40f);
        Set("m_ShadowCascadeCount", p => p.intValue = 2);
        Set("m_SoftShadowsSupported", p => p.boolValue = true);
        Set("m_SoftShadowQuality", p => p.intValue = 3); // High
        Set("m_MixedLightingSupported", p => p.boolValue = true);
        Set("m_ReflectionProbeBlending", p => p.boolValue = true);
        Set("m_ReflectionProbeBoxProjection", p => p.boolValue = true);
        Set("m_ColorGradingMode", p => p.intValue = 1); // HDR
        a.ApplyModifiedPropertiesWithoutUndo();
        EditorUtility.SetDirty(asset);

        GraphicsSettings.defaultRenderPipeline = asset;
        GraphicsSettings.lightsUseLinearIntensity = true; // URP 前提の光の強さ（焼き込みと実時間で揃える）
        int current = QualitySettings.GetQualityLevel();
        for (int i = 0; i < QualitySettings.names.Length; i++)
        {
            QualitySettings.SetQualityLevel(i, false);
            QualitySettings.renderPipeline = asset;
        }
        QualitySettings.SetQualityLevel(current, false);
        PlayerSettings.colorSpace = ColorSpace.Linear;
        AssetDatabase.SaveAssets();
        return asset;
    }

    static VolumeProfile EnsureVolumeProfile()
    {
        string path = RenderDir + "/KuraLook.asset";
        AssetDatabase.DeleteAsset(path);
        var profile = ScriptableObject.CreateInstance<VolumeProfile>();
        AssetDatabase.CreateAsset(profile, path);
        T Add<T>() where T : VolumeComponent { var c = profile.Add<T>(true); AssetDatabase.AddObjectToAsset(c, profile); return c; }

        var tone = Add<Tonemapping>(); tone.mode.Override(TonemappingMode.ACES);
        var bloom = Add<Bloom>(); bloom.threshold.Override(1.0f); bloom.intensity.Override(0.35f); bloom.scatter.Override(0.6f);
        var color = Add<ColorAdjustments>(); color.postExposure.Override(0.55f); color.contrast.Override(12f); color.saturation.Override(-12f);
        var wb = Add<WhiteBalance>(); wb.temperature.Override(6f); wb.tint.Override(1f);
        var vig = Add<Vignette>(); vig.intensity.Override(0.3f); vig.smoothness.Override(0.45f);
        var lgg = Add<LiftGammaGain>(); lgg.lift.Override(new Vector4(1f, 0.98f, 0.95f, 0.02f));
        var grain = Add<FilmGrain>(); grain.type.Override(FilmGrainLookup.Thin1); grain.intensity.Override(0.12f);
        EditorUtility.SetDirty(profile);
        AssetDatabase.SaveAssets();
        return profile;
    }

    static VolumeProfile EnsurePastProfile()
    {
        string path = RenderDir + "/KuraLookPast.asset";
        AssetDatabase.DeleteAsset(path);
        var profile = ScriptableObject.CreateInstance<VolumeProfile>();
        AssetDatabase.CreateAsset(profile, path);
        T Add<T>() where T : VolumeComponent { var c = profile.Add<T>(true); AssetDatabase.AddObjectToAsset(c, profile); return c; }
        var wb = Add<WhiteBalance>(); wb.temperature.Override(-7f); wb.tint.Override(-1f);
        var color = Add<ColorAdjustments>(); color.postExposure.Override(0.85f); color.contrast.Override(4f); color.saturation.Override(-16f);
        var lgg = Add<LiftGammaGain>(); lgg.lift.Override(new Vector4(0.98f, 1.0f, 1.03f, 0.03f));
        var bloom = Add<Bloom>(); bloom.threshold.Override(0.9f); bloom.intensity.Override(0.5f); bloom.scatter.Override(0.7f);
        EditorUtility.SetDirty(profile);
        AssetDatabase.SaveAssets();
        return profile;
    }

    // ================= 質感（テクスチャと材質） =================
    static Texture2D SaveTex(string name, int size, Func<float, float, Color> f, bool normal = false, bool linear = false)
    {
        Directory.CreateDirectory(TexDir);
        var t = new Texture2D(size, size, TextureFormat.RGBA32, false, true);
        var px = new Color[size * size];
        for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
                px[y * size + x] = f((float)x / size, (float)y / size);
        t.SetPixels(px); t.Apply();
        string path = $"{TexDir}/{name}.png";
        File.WriteAllBytes(path, t.EncodeToPNG());
        UnityEngine.Object.DestroyImmediate(t);
        AssetDatabase.ImportAsset(path);
        var imp = (TextureImporter)AssetImporter.GetAtPath(path);
        imp.textureType = normal ? TextureImporterType.NormalMap : TextureImporterType.Default;
        imp.sRGBTexture = !(normal || linear);
        imp.wrapMode = TextureWrapMode.Repeat;
        imp.mipmapEnabled = true;
        imp.anisoLevel = 4;
        imp.maxTextureSize = 1024;
        imp.SaveAndReimport();
        return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
    }

    // くり返して貼っても継ぎ目が出ないノイズ（格子を周期的にした値ノイズの重ね合わせ）
    static float Noise(float u, float v, int cells, int seed)
    {
        float x = u * cells, y = v * cells;
        int x0 = Mathf.FloorToInt(x), y0 = Mathf.FloorToInt(y);
        float fx = x - x0, fy = y - y0;
        float H(int i, int j)
        {
            i = ((i % cells) + cells) % cells; j = ((j % cells) + cells) % cells;
            uint h = (uint)(i * 374761393 + j * 668265263 + seed * 1442695041);
            h = (h ^ (h >> 13)) * 1274126177u;
            return ((h ^ (h >> 16)) & 0xffff) / 65535f;
        }
        float sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        return Mathf.Lerp(Mathf.Lerp(H(x0, y0), H(x0 + 1, y0), sx), Mathf.Lerp(H(x0, y0 + 1), H(x0 + 1, y0 + 1), sx), sy);
    }
    static float Fbm(float u, float v, int cells, int seed, int oct = 5)
    {
        float s = 0, amp = 0.5f, norm = 0;
        for (int o = 0; o < oct; o++) { s += Noise(u, v, cells << o, seed + o * 17) * amp; norm += amp; amp *= 0.5f; }
        return s / norm;
    }
    static Func<float, float, Color> NormalFrom(Func<float, float, float> h, float strength, int size)
    {
        float e = 1f / size;
        return (u, v) =>
        {
            float dx = (h(u + e, v) - h(u - e, v)) * strength, dy = (h(u, v + e) - h(u, v - e)) * strength;
            var n = new Vector3(-dx, -dy, 1).normalized;
            return new Color(n.x * 0.5f + 0.5f, n.y * 0.5f + 0.5f, n.z * 0.5f + 0.5f, 1);
        };
    }

    static Material Lit(string name, Color c, float smooth, float metal = 0f, Texture2D albedo = null, Texture2D normal = null, Vector2? tiling = null, float bump = 1f)
    {
        Directory.CreateDirectory(MatDir);
        string path = $"{MatDir}/{name}.mat";
        var m = AssetDatabase.LoadAssetAtPath<Material>(path);
        var shader = Shader.Find("Universal Render Pipeline/Lit");
        if (m == null) { m = new Material(shader); AssetDatabase.CreateAsset(m, path); }
        m.shader = shader;
        m.SetColor("_BaseColor", c);
        m.SetFloat("_Smoothness", smooth);
        m.SetFloat("_Metallic", metal);
        m.SetTexture("_BaseMap", albedo);
        m.SetTexture("_BumpMap", normal);
        m.SetFloat("_BumpScale", bump);
        if (normal != null) m.EnableKeyword("_NORMALMAP"); else m.DisableKeyword("_NORMALMAP");
        var t = tiling ?? Vector2.one;
        m.SetTextureScale("_BaseMap", t);
        m.SetTextureScale("_BumpMap", t);
        m.DisableKeyword("_EMISSION");
        m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.EmissiveIsBlack;
        EditorUtility.SetDirty(m);
        return m;
    }

    static Material Emissive(string name, Color baseColor, Color emission, bool bakeGI)
    {
        var m = Lit(name, baseColor, 0.2f);
        m.EnableKeyword("_EMISSION");
        m.SetColor("_EmissionColor", emission);
        m.globalIlluminationFlags = bakeGI ? MaterialGlobalIlluminationFlags.BakedEmissive : MaterialGlobalIlluminationFlags.RealtimeEmissive;
        EditorUtility.SetDirty(m);
        return m;
    }

    // 足元の灯り：床に落ちるやわらかい光（加算の半透明。色は実行時に _BaseColor で変える）
    static Material SoftGlow(string name, Texture2D tex)
    {
        string path = $"{MatDir}/{name}.mat";
        var shader = Shader.Find("Universal Render Pipeline/Unlit");
        var m = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (m == null) { m = new Material(shader); AssetDatabase.CreateAsset(m, path); }
        m.shader = shader;
        m.SetTexture("_BaseMap", tex);
        m.SetColor("_BaseColor", new Color(1f, 0.42f, 0.1f));
        m.SetFloat("_Surface", 1f);
        m.SetFloat("_Blend", 2f); // Additive
        m.SetFloat("_SrcBlend", (float)BlendMode.One);
        m.SetFloat("_DstBlend", (float)BlendMode.One);
        m.SetFloat("_SrcBlendAlpha", (float)BlendMode.One);
        m.SetFloat("_DstBlendAlpha", (float)BlendMode.One);
        m.SetFloat("_ZWrite", 0f);
        m.SetOverrideTag("RenderType", "Transparent");
        m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
        m.renderQueue = (int)RenderQueue.Transparent;
        EditorUtility.SetDirty(m);
        return m;
    }

    // シェーダーの smoothstep と同じ（Unity の Mathf.SmoothStep は from〜to の補間で、意味が違う）
    static float Smooth(float e0, float e1, float x) { float t = Mathf.Clamp01((x - e0) / (e1 - e0)); return t * t * (3f - 2f * t); }

    // 手書き風の線：日本語の字の代わりに、行ごとの筆の線（札は縦書き、黒板は横書きと罫線）
    static Texture2D Scribble(string name, Color paper, Color ink, int lines, bool vertical, bool grid)
    {
        const int S = 256;
        var rng = new System.Random(name.GetHashCode());
        var px = new Color[S * S];
        for (int i = 0; i < px.Length; i++) px[i] = paper;
        void Dot(float x, float y, float r, float a)
        {
            for (int dy = -2; dy <= 2; dy++)
                for (int dx = -2; dx <= 2; dx++)
                {
                    int X = Mathf.RoundToInt(x) + dx, Y = Mathf.RoundToInt(y) + dy;
                    if (X < 0 || Y < 0 || X >= S || Y >= S) continue;
                    float d = Mathf.Sqrt(dx * dx + dy * dy);
                    if (d > r) continue;
                    var c = px[Y * S + X]; px[Y * S + X] = Color.Lerp(c, ink, a * (1f - d / (r + 0.5f)));
                }
        }
        if (grid)
            for (int k = 1; k < 6; k++)
                for (int x = 6; x < S - 6; x++) Dot(x, S - 26 - k * 40 + 18, 0.8f, 0.35f);
        for (int l = 0; l < lines; l++)
        {
            // 1行の中に、字のかたまりを数個
            float baseCoord = vertical ? S - 40 - l * (S - 60f) / lines : S - 40 - l * 40f;
            float pos = vertical ? 30 : (grid ? 70 : 20);
            int chars = rng.Next(4, 8);
            for (int c = 0; c < chars; c++)
            {
                float cx = pos, size = 14 + (float)rng.NextDouble() * 6;
                int strokes = rng.Next(2, 5);
                for (int s = 0; s < strokes; s++)
                {
                    float x0 = (float)rng.NextDouble() * size, y0 = (float)rng.NextDouble() * size;
                    float x1 = (float)rng.NextDouble() * size, y1 = (float)rng.NextDouble() * size;
                    for (float t = 0; t <= 1f; t += 0.03f)
                    {
                        float x = Mathf.Lerp(x0, x1, t), y = Mathf.Lerp(y0, y1, t) + Mathf.Sin(t * 3f) * 1.5f;
                        if (vertical) Dot(baseCoord - 8 + x * 0.8f, S - 24 - cx - y, 1.4f, 0.9f);
                        else Dot(cx + x, baseCoord - y, 1.3f, 0.85f);
                    }
                }
                pos += size + 6;
                if (pos > S - 30) break;
            }
        }
        var t2 = new Texture2D(S, S, TextureFormat.RGBA32, false);
        t2.SetPixels(px); t2.Apply();
        string path = $"{TexDir}/{name}.png";
        File.WriteAllBytes(path, t2.EncodeToPNG());
        UnityEngine.Object.DestroyImmediate(t2);
        AssetDatabase.ImportAsset(path);
        return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
    }

    static Material TwoSided(Material m) { m.SetFloat("_Cull", 0f); EditorUtility.SetDirty(m); return m; }

    // 床の水の跡：濡れて暗く、つやのある半透明
    static Material WetMat(Texture2D blob)
    {
        var m = Lit("WetFloor", new Color(0.13f, 0.12f, 0.11f, 0.78f), 0.95f, 0f, blob);
        m.SetFloat("_Surface", 1f);
        m.SetFloat("_Blend", 0f);
        m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
        m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
        m.SetFloat("_SrcBlendAlpha", (float)BlendMode.One);
        m.SetFloat("_DstBlendAlpha", (float)BlendMode.OneMinusSrcAlpha);
        m.SetFloat("_ZWrite", 0f);
        m.SetOverrideTag("RenderType", "Transparent");
        m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
        m.renderQueue = (int)RenderQueue.Transparent - 10;
        EditorUtility.SetDirty(m);
        return m;
    }

    static Texture2D SoftDot() => SaveTex("SoftDot", 64, (u, v) =>
    {
        float d = Mathf.Clamp01(1f - Vector2.Distance(new Vector2(u, v), new Vector2(0.5f, 0.5f)) * 2f);
        float a = d * d * (3f - 2f * d);
        return new Color(1f, 1f, 1f, a);
    });

    // 空気の演出の材質：光の筋（Unlit・加算・両面）、ほこり（粒子・加算）、湯気（粒子・半透明）
    static Material AirMat(string name, Texture2D tex, bool additive, bool particles)
    {
        string path = $"{MatDir}/{name}.mat";
        var shader = Shader.Find(particles ? "Universal Render Pipeline/Particles/Unlit" : "Universal Render Pipeline/Unlit");
        var m = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (m == null) { m = new Material(shader); AssetDatabase.CreateAsset(m, path); }
        m.shader = shader;
        m.SetTexture("_BaseMap", tex);
        m.SetColor("_BaseColor", Color.white);
        m.SetFloat("_Surface", 1f);
        m.SetFloat("_Blend", additive ? 2f : 0f);
        m.SetFloat("_SrcBlend", (float)(additive ? BlendMode.SrcAlpha : BlendMode.SrcAlpha));
        m.SetFloat("_DstBlend", (float)(additive ? BlendMode.One : BlendMode.OneMinusSrcAlpha));
        m.SetFloat("_SrcBlendAlpha", (float)BlendMode.One);
        m.SetFloat("_DstBlendAlpha", (float)(additive ? BlendMode.One : BlendMode.OneMinusSrcAlpha));
        m.SetFloat("_ZWrite", 0f);
        m.SetFloat("_Cull", 0f); // 両面
        m.SetOverrideTag("RenderType", "Transparent");
        m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
        m.renderQueue = (int)RenderQueue.Transparent;
        EditorUtility.SetDirty(m);
        return m;
    }

    static Material TextMat()
    {
        string path = $"{MatDir}/Text3D.mat";
        var shader = Shader.Find("Kura/Text3D");
        var m = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (m == null) { m = new Material(shader); AssetDatabase.CreateAsset(m, path); }
        m.shader = shader;
        m.mainTexture = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf").material.mainTexture;
        EditorUtility.SetDirty(m);
        return m;
    }

    static KuraPalette MakePalette()
    {
        const int S = 512;
        var concreteH = new Func<float, float, float>((u, v) => Fbm(u, v, 8, 1) * 0.7f + Fbm(u, v, 64, 2, 3) * 0.3f);
        var concrete = SaveTex("Concrete", S, (u, v) =>
        {
            float n = concreteH(u, v), stain = Mathf.SmoothStep(0.55f, 0.8f, Fbm(u, v, 4, 9, 3));
            float g = 0.78f + 0.28f * n - 0.12f * stain;
            return new Color(g, g * 0.985f, g * 0.96f, 1);
        });
        var concreteN = SaveTex("Concrete_N", S, NormalFrom(concreteH, 1.2f, S), normal: true);
        var plasterH = new Func<float, float, float>((u, v) => Fbm(u, v, 16, 3, 4));
        var plaster = SaveTex("Plaster", S, (u, v) => { float g = 0.95f + 0.06f * plasterH(u, v) - 0.04f * Fbm(u, v, 3, 5, 3); return new Color(g, g * 0.99f, g * 0.965f, 1); });
        var plasterN = SaveTex("Plaster_N", S, NormalFrom(plasterH, 1.2f, S), normal: true);
        var woodH = new Func<float, float, float>((u, v) => 0.5f + 0.5f * Mathf.Sin((v * 24f + Fbm(u * 0.25f, v, 8, 7, 4) * 6f) * Mathf.PI * 2f));
        var wood = SaveTex("Wood", S, (u, v) => { float g = 0.78f + 0.22f * woodH(u, v) * (0.7f + 0.3f * Fbm(u, v, 32, 8, 2)); return new Color(g, g, g, 1); });
        var woodN = SaveTex("Wood_N", S, NormalFrom(woodH, 0.6f, S), normal: true);
        // 醪の表面：白〜クリームの粒立ち（米粒と細かな泡）
        var moromiH = new Func<float, float, float>((u, v) => Mathf.Pow(Fbm(u, v, 24, 11, 4), 1.5f) * 0.7f + Fbm(u, v, 96, 12, 2) * 0.3f);
        var moromi = SaveTex("Moromi", S, (u, v) => { float h = moromiH(u, v); float g = 0.9f + 0.1f * h; return new Color(g, g * 0.985f, g * 0.94f, 1); });
        var moromiN = SaveTex("Moromi_N", S, NormalFrom(moromiH, 4f, S), normal: true);
        var ringTex = SaveTex("GlowRing", 128, (u, v) => { float a = Mathf.SmoothStep(0f, 0.12f, v) * Mathf.Pow(1f - v, 2.2f); return new Color(a, a, a, a); });
        var enamelN = SaveTex("Enamel_N", 256, NormalFrom((u, v) => Fbm(u, v, 6, 21, 3), 0.25f, 256), normal: true);

        return new KuraPalette
        {
            // 琺瑯タンク：外はくすんだ深緑（つやは控えめ）、内は白
            enamel = Lit("Enamel", new Color(0.23f, 0.3f, 0.26f), 0.45f, 0f, null, enamelN, new Vector2(2, 1), 0.4f),
            enamelRim = Lit("EnamelRim", new Color(0.27f, 0.34f, 0.3f), 0.5f),
            enamelHoop = Lit("EnamelHoop", new Color(0.16f, 0.21f, 0.18f), 0.4f),
            enamelInner = Lit("EnamelInner", new Color(0.9f, 0.9f, 0.88f), 0.75f),
            lip = Lit("EnamelLip", new Color(0.86f, 0.86f, 0.84f), 0.7f, 0.15f),
            plinth = Lit("Plinth", new Color(0.6f, 0.59f, 0.57f), 0.15f, 0f, concrete, concreteN, new Vector2(1, 1)),
            liquid = Lit("Moromi", new Color(0.97f, 0.95f, 0.88f), 0.42f, 0f, moromi, moromiN, new Vector2(1.5f, 1.5f), 0.9f),
            plaster = Lit("Plaster", new Color(0.97f, 0.96f, 0.93f), 0.08f, 0f, plaster, plasterN, new Vector2(4, 2), 0.6f),
            wood = Lit("Wood", new Color(0.36f, 0.24f, 0.15f), 0.28f, 0f, wood, woodN, new Vector2(1, 3)),
            woodDark = Lit("WoodDark", new Color(0.22f, 0.15f, 0.1f), 0.22f, 0f, wood, woodN, new Vector2(1, 6)),
            concrete = Lit("Concrete", new Color(0.62f, 0.61f, 0.59f), 0.22f, 0f, concrete, concreteN, new Vector2(6, 6)),
            steel = Lit("Steel", new Color(0.42f, 0.43f, 0.44f), 0.5f, 0.75f),
            plank = Lit("Plank", new Color(0.55f, 0.42f, 0.29f), 0.25f, 0f, wood, woodN, new Vector2(4, 0.3f)),
            tag = Lit("Tag", new Color(0.8f, 0.7f, 0.52f), 0.2f, 0f, wood, woodN, new Vector2(0.3f, 0.3f)),
            band = Lit("TempBand", new Color(0.82f, 0.81f, 0.77f), 0.4f),
            glow = Emissive("Glow", new Color(0.2f, 0.12f, 0.05f), new Color(1f, 0.55f, 0.18f) * 2f, false),
            glowSoft = SoftGlow("GlowSoft", ringTex),
            lampShade = Lit("LampShade", new Color(0.18f, 0.24f, 0.2f), 0.6f, 0.2f),
            lampBulb = Emissive("LampBulb", Color.white, new Color(1f, 0.82f, 0.6f) * 6f, false),
            windowPaper = Emissive("WindowPaper", new Color(0.95f, 0.93f, 0.88f), new Color(1f, 0.93f, 0.82f) * 1.6f, true),
            tojiCloth = Lit("TojiCloth", new Color(0.72f, 0.7f, 0.66f), 0.1f), // 仮の杜氏は淡い灰色（目立たせない）
            tojiSkin = Lit("TojiSkin", new Color(0.74f, 0.72f, 0.68f), 0.1f),
            tojiTowel = Lit("TojiTowel", new Color(0.95f, 0.95f, 0.93f), 0.1f),
            text = TextMat(),
            hose = Lit("Hose", new Color(0.16f, 0.3f, 0.22f), 0.55f),
            cloth = TwoSided(Lit("CoverCloth", new Color(0.9f, 0.88f, 0.83f), 0.08f, 0f, plaster, plasterN, new Vector2(2, 2), 0.8f)),
            vinyl = TwoSided(Lit("CoverVinyl", new Color(0.62f, 0.72f, 0.78f), 0.8f, 0.05f)),
            paperTag = Lit("PaperTag", Color.white, 0.1f, 0f, Scribble("PaperScribble", new Color(0.97f, 0.95f, 0.9f), new Color(0.12f, 0.1f, 0.12f), 5, vertical: true, grid: false)),
            blackboard = Lit("Blackboard", Color.white, 0.18f, 0f, Scribble("ChalkScribble", new Color(0.12f, 0.17f, 0.15f), new Color(0.88f, 0.88f, 0.84f), 5, vertical: false, grid: true)),
            wet = WetMat(SaveTex("WetBlob", 128, (u, v) =>
            {
                float d = Vector2.Distance(new Vector2(u, v), new Vector2(0.5f, 0.5f)) * 2f + (Fbm(u, v, 4, 31, 3) - 0.5f) * 0.9f;
                float a = 1f - Smooth(0.55f, 1f, d);
                return new Color(1, 1, 1, a);
            })),
            grating = Lit("Grating", new Color(0.3f, 0.3f, 0.31f), 0.45f, 0.7f, SaveTex("GratingTex", 128, (u, v) =>
            {
                float bar = Mathf.Abs(Mathf.Sin(u * Mathf.PI * 16f));
                float g = bar > 0.35f ? 0.75f : 0.08f;
                return new Color(g, g, g, 1);
            }), null, new Vector2(60, 1)),
            hinoki = Lit("Hinoki", new Color(0.86f, 0.74f, 0.55f), 0.3f, 0f, wood, woodN, new Vector2(1, 1)),
            sakaki = Lit("Sakaki", new Color(0.15f, 0.32f, 0.16f), 0.4f),
            straw = Lit("Straw", new Color(0.78f, 0.68f, 0.42f), 0.15f),
            shide = Lit("Shide", new Color(0.98f, 0.98f, 0.96f), 0.1f),
            beam = AirMat("LightBeam", SaveTex("BeamGrad", 64, (u, v) => { float a = Mathf.Pow(Mathf.Sin(Mathf.PI * u), 1.6f) * Smooth(0f, 0.08f, v) * Mathf.Pow(1f - v, 1.4f); return new Color(a, a, a, a); }), additive: true, particles: true), // 粒子用のシェーダーで描く（Unlit の半透明は描かれなかった）
            dust = AirMat("Dust", SoftDot(), additive: true, particles: true),
            steam = AirMat("Steam", SoftDot(), additive: false, particles: true),
        };
    }

    // ================= シーン =================
    [MenuItem("Kura/1. シーンを用意")]
    public static void SetupScene() => SetupScene(false);

    public static void SetupScene(bool bake)
    {
        EnsurePipeline();
        var profile = EnsureVolumeProfile();
        var palette = MakePalette();
        Directory.CreateDirectory("Assets/Scenes");
        if (Directory.Exists(MeshDir)) AssetDatabase.DeleteAsset(MeshDir);
        Directory.CreateDirectory(MeshDir);
        AssetDatabase.Refresh();

        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        var camGo = new GameObject("Main Camera");
        camGo.tag = "MainCamera";
        var cam = camGo.AddComponent<Camera>();
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.05f, 0.045f, 0.04f);
        cam.fieldOfView = 40;
        cam.nearClipPlane = 0.1f; cam.farClipPlane = 80f;
        var camData = camGo.AddComponent<UniversalAdditionalCameraData>();
        camData.renderPostProcessing = true;
        camData.antialiasing = AntialiasingMode.None;
        camGo.AddComponent<AudioListener>();

        // 色調補正（ポストエフェクト）
        var vol = new GameObject("Look").AddComponent<Volume>();
        vol.isGlobal = true; vol.sharedProfile = profile;
        // 過去の記録を見ているあいだの色（朝の少し冷たい空気）。重みは KuraBridge が 0〜1 で動かす
        var past = new GameObject("LookPast").AddComponent<Volume>();
        past.isGlobal = true; past.priority = 1; past.weight = 0f; past.sharedProfile = EnsurePastProfile();

        // 光：大戸口から入る外光（主光源）、梁から下がる電灯3つ、高窓
        var sun = new GameObject("Daylight").AddComponent<Light>();
        sun.type = LightType.Directional;
        sun.color = new Color(1f, 0.9f, 0.76f);
        sun.intensity = 1.25f;
        sun.shadows = LightShadows.Soft;
        sun.shadowStrength = 0.9f;
        sun.transform.rotation = Quaternion.Euler(42f, 28f, 0f);
        sun.lightmapBakeType = LightmapBakeType.Mixed;

        RenderSettings.ambientMode = AmbientMode.Trilight;
        RenderSettings.ambientSkyColor = new Color(0.32f, 0.3f, 0.27f);
        RenderSettings.ambientEquatorColor = new Color(0.24f, 0.21f, 0.18f);
        RenderSettings.ambientGroundColor = new Color(0.12f, 0.1f, 0.08f);
        RenderSettings.skybox = null;
        RenderSettings.fog = false;

        var bridge = new GameObject("KuraBridge").AddComponent<KuraBridge>();
        bridge.palette = palette;
        Func<Mesh, Mesh> keep = m =>
        {
            Unwrapping.GenerateSecondaryUVSet(m);
            AssetDatabase.CreateAsset(m, $"{MeshDir}/{m.name}.asset");
            return m;
        };
        Action<GameObject> markStatic = g =>
        {
            GameObjectUtility.SetStaticEditorFlags(g, StaticEditorFlags.ContributeGI | StaticEditorFlags.ReflectionProbeStatic | StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccluderStatic | StaticEditorFlags.OccludeeStatic);
        };
        var kura = KuraScene.Build(bridge.transform, palette, keep, markStatic);
        InstallToji(kura);
        // 朝の光は奥（高窓の側）から差し込む。奥の壁と梁が光を遮らないよう、影を落とさない
        kura.Find("Building/WallBack").GetComponent<Renderer>().shadowCastingMode = ShadowCastingMode.Off;
        foreach (Transform t in kura.Find("Building"))
            if (t.name == "Beam" || t.name.StartsWith("Window") || t.name == "PillarBack" || t.name == "WainscotBack" || t.name == "NageshiBack")
                t.GetComponent<Renderer>().shadowCastingMode = ShadowCastingMode.Off;

        foreach (Transform lamp in kura.Find("Lamps"))
        {
            var l = new GameObject("LampLight").AddComponent<Light>();
            l.transform.SetParent(lamp, false);
            l.transform.localPosition = new Vector3(0, -0.12f, 0);
            l.transform.localRotation = Quaternion.Euler(90, 0, 0);
            l.type = LightType.Spot;
            l.spotAngle = 120f; l.innerSpotAngle = 50f;
            l.range = 14f;
            l.color = new Color(1f, 0.78f, 0.55f);
            l.intensity = 9f;
            l.shadows = LightShadows.Soft;
            l.shadowStrength = 0.8f;
            l.lightmapBakeType = LightmapBakeType.Mixed;
        }

        // 反射（琺瑯のつや用）と、動く物（醪）のための光のサンプル点
        var probe = new GameObject("ReflectionProbe").AddComponent<ReflectionProbe>();
        probe.transform.position = new Vector3(0, 4.2f, -1f);
        probe.size = new Vector3(24f, 9.6f, 27f);
        probe.center = new Vector3(0, 0.6f, -2.5f);
        probe.boxProjection = true;
        probe.mode = ReflectionProbeMode.Baked;
        probe.resolution = 256;
        probe.intensity = 0.9f;
        var lpg = new GameObject("LightProbes").AddComponent<LightProbeGroup>();
        var pts = new System.Collections.Generic.List<Vector3>();
        for (float x = -10f; x <= 10.01f; x += 2.5f)
            for (float z = -12f; z <= 8.01f; z += 2.5f)
                foreach (var y in new[] { 0.6f, 2.2f, 3.6f, 5f, 7.5f })
                    pts.Add(new Vector3(x, y, z));
        lpg.probePositions = pts.ToArray();

        EditorSceneManager.SaveScene(scene, ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };

        if (bake) Bake();
        // 琺瑯のつやに映り込む周りの景色を焼く（焼き込みなしの試し撮りでも行う）
        Directory.CreateDirectory("Assets/Scenes/Kura");
        Lightmapping.BakeReflectionProbe(probe, "Assets/Scenes/Kura/ReflectionProbe.exr");
        EditorSceneManager.SaveScene(scene, ScenePath);
        AssetDatabase.SaveAssets();
        Debug.Log("[Kura] シーンを用意しました: " + ScenePath);
    }

    // ================= 杜氏（Tripo で作ったモデル） =================
    // Assets/Toji/Toji_idle.fbx（立って待つ）と Toji_nod.fbx（うなずく）があれば、仮の人形と差し替える
    const string TojiDir = "Assets/Toji";

    static void InstallToji(Transform kura)
    {
        string idlePath = TojiDir + "/Toji_idle.fbx", nodPath = TojiDir + "/Toji_nod.fbx", walkPath = TojiDir + "/Toji_walk.fbx";
        if (!File.Exists(idlePath)) { Debug.Log("[Kura] 杜氏のモデルが無いので仮の人形のまま"); return; }

        // 取り込みの設定：Generic の骨、動きはくり返し（うなずきは1回）
        foreach (var (path, loop) in new[] { (idlePath, true), (nodPath, true), (walkPath, true) })
        {
            if (!File.Exists(path)) continue;
            var imp = (ModelImporter)AssetImporter.GetAtPath(path);
            imp.animationType = ModelImporterAnimationType.Generic;
            imp.importAnimation = true;
            imp.materialImportMode = ModelImporterMaterialImportMode.ImportStandard;
            var clips = imp.defaultClipAnimations;
            foreach (var c in clips) { c.loopTime = loop; c.name = Path.GetFileNameWithoutExtension(path); }
            imp.clipAnimations = clips;
            imp.SaveAndReimport();
            // FBX に埋め込まれた材質を取り出し、URP の Lit に直す（そのままだと Built-in の材質で描かれない）
            ExtractAndFixMaterials(path);
        }

        var placeholder = kura.Find("Toji");
        var model = (GameObject)PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>(idlePath));
        model.name = "TojiModel";
        model.transform.SetParent(placeholder, false);
        // 仮の人形の形は消す（Head は目印の予備として残すが描かない）
        foreach (var r in placeholder.GetComponentsInChildren<Renderer>(true))
            if (!r.transform.IsChildOf(model.transform)) r.enabled = false;

        // 大きさ：身長 約1.62m にそろえ、足元を足場の上に置く
        var rends = model.GetComponentsInChildren<Renderer>();
        var b = rends[0].bounds; foreach (var r in rends) b.Encapsulate(r.bounds);
        float scale = 1.62f / Mathf.Max(0.01f, b.size.y);
        model.transform.localScale *= scale;
        // 向き：左右の太ももの骨から体の正面を求め、仮の人形と同じ向き（足場からタンクと手前を見る）にそろえる
        var lThigh = model.GetComponentsInChildren<Transform>().FirstOrDefault(t => t.name == "L_Thigh");
        var rThigh = model.GetComponentsInChildren<Transform>().FirstOrDefault(t => t.name == "R_Thigh");
        if (lThigh != null && rThigh != null)
        {
            var right = rThigh.position - lThigh.position; right.y = 0;
            var facing = Vector3.Cross(right.normalized, Vector3.up);
            var want = placeholder.forward; want.y = 0;
            model.transform.rotation = Quaternion.FromToRotation(facing, want.normalized) * model.transform.rotation;
        }
        rends = model.GetComponentsInChildren<Renderer>();
        b = rends[0].bounds; foreach (var r in rends) b.Encapsulate(r.bounds);
        model.transform.position += new Vector3(placeholder.position.x - b.center.x, placeholder.position.y - b.min.y, placeholder.position.z - b.center.z);
        foreach (var r in rends) { r.shadowCastingMode = ShadowCastingMode.On; r.receiveShadows = true; }

        // 吹き出しの目印を頭の骨に付ける（名前に head を含む骨。無ければ頭のてっぺん付近）
        Transform headBone = null;
        foreach (var t in model.GetComponentsInChildren<Transform>())
            if (t.name.ToLower().Contains("head") && !t.name.ToLower().Contains("end")) { headBone = t; break; }
        var anchor = new GameObject("HeadAnchor").transform;
        if (headBone != null) { anchor.SetParent(headBone, false); anchor.position = headBone.position; }
        else { anchor.SetParent(model.transform, false); anchor.position = new Vector3(b.center.x, b.max.y - 0.1f, b.center.z); }

        // 動き：ふだんは「立って待つ」、話すあいだは首と頭だけ「うなずく」を重ねる
        var idle = AssetDatabase.LoadAllAssetsAtPath(idlePath).OfType<AnimationClip>().FirstOrDefault(c => !c.name.StartsWith("__preview__"));
        var nod = File.Exists(nodPath) ? AssetDatabase.LoadAllAssetsAtPath(nodPath).OfType<AnimationClip>().FirstOrDefault(c => !c.name.StartsWith("__preview__")) : null;
        string ctrlPath = TojiDir + "/Toji.controller";
        AssetDatabase.DeleteAsset(ctrlPath);
        var ctrl = UnityEditor.Animations.AnimatorController.CreateAnimatorControllerAtPath(ctrlPath);
        var sm = ctrl.layers[0].stateMachine;
        var sIdle = sm.AddState("Idle"); sIdle.motion = idle;
        sm.defaultState = sIdle;
        // 歩く：案内のあいだ（Walking）。その場で足踏みする動きで、移動は KuraBridge が足場の上だけで行う
        var walk = File.Exists(walkPath) ? AssetDatabase.LoadAllAssetsAtPath(walkPath).OfType<AnimationClip>().FirstOrDefault(c => !c.name.StartsWith("__preview__")) : null;
        if (walk != null)
        {
            ctrl.AddParameter("Walking", AnimatorControllerParameterType.Bool);
            var sWalk = sm.AddState("Walk"); sWalk.motion = walk;
            var go = sIdle.AddTransition(sWalk); go.AddCondition(UnityEditor.Animations.AnimatorConditionMode.If, 0, "Walking"); go.hasExitTime = false; go.duration = 0.2f;
            var stop = sWalk.AddTransition(sIdle); stop.AddCondition(UnityEditor.Animations.AnimatorConditionMode.IfNot, 0, "Walking"); stop.hasExitTime = false; stop.duration = 0.25f;
        }
        if (nod != null)
        {
            // うなずき：首と頭だけに効く層。体は「立って待つ」のまま。話すあいだだけ層の重みを上げる（KuraBridge）
            string maskPath = TojiDir + "/TojiHeadOnly.mask";
            AssetDatabase.DeleteAsset(maskPath);
            var mask = new AvatarMask();
            var all = model.GetComponentsInChildren<Transform>(true).Where(t => t != model.transform).ToArray();
            mask.transformCount = all.Length;
            for (int i = 0; i < all.Length; i++)
            {
                mask.SetTransformPath(i, AnimationUtility.CalculateTransformPath(all[i], model.transform));
                bool head = all[i].name.StartsWith("Neck") || all[i].name == "Head" || all[i].GetComponentsInParent<Transform>().Any(p => p.name == "Head");
                mask.SetTransformActive(i, head);
            }
            AssetDatabase.CreateAsset(mask, maskPath);
            var layer = new UnityEditor.Animations.AnimatorControllerLayer
            {
                name = "Nod", defaultWeight = 0f, avatarMask = mask,
                stateMachine = new UnityEditor.Animations.AnimatorStateMachine { name = "Nod" },
            };
            AssetDatabase.AddObjectToAsset(layer.stateMachine, ctrl);
            var sNod = layer.stateMachine.AddState("Nod"); sNod.motion = nod;
            layer.stateMachine.defaultState = sNod;
            ctrl.AddLayer(layer);
        }
        var animator = model.GetComponent<Animator>();
        if (animator == null) animator = model.AddComponent<Animator>(); // Unity の部品は ?? で判定できない
        animator.runtimeAnimatorController = ctrl;
        animator.applyRootMotion = false;
        animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
        Debug.Log($"[Kura] 杜氏のモデルを組み込みました（倍率 {scale:0.000}、頭の骨 {(headBone ? headBone.name : "なし")}、動き {idle?.name} / {nod?.name} / {walk?.name}）");
    }

    static void ExtractAndFixMaterials(string fbxPath)
    {
        string matDir = TojiDir + "/Materials";
        Directory.CreateDirectory(matDir);
        var imp = (ModelImporter)AssetImporter.GetAtPath(fbxPath);
        // 前回の差し替え先をいったん外し、FBX 本来の材質から作り直す（何度実行しても同じ結果になるように）
        foreach (var kv in imp.GetExternalObjectMap()) imp.RemoveRemap(kv.Key);
        imp.SaveAndReimport();
        // 埋め込みテクスチャを取り出す
        imp.ExtractTextures(TojiDir + "/Textures");
        AssetDatabase.Refresh();
        var lit = Shader.Find("Universal Render Pipeline/Lit");
        foreach (var src in AssetDatabase.LoadAllAssetsAtPath(fbxPath).OfType<Material>())
        {
            string path = $"{matDir}/{src.name}.mat";
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (m == null) { m = new Material(lit); AssetDatabase.CreateAsset(m, path); }
            // 色の画像：FBX の材質に無ければ、取り出した Color_* を使う
            Texture tex = src.HasProperty("_MainTex") ? src.GetTexture("_MainTex") : null;
            var colorPath = Directory.GetFiles(TojiDir + "/Textures", "Color_*").FirstOrDefault(f => !f.EndsWith(".meta"));
            if (tex == null && colorPath != null) tex = AssetDatabase.LoadAssetAtPath<Texture2D>(colorPath);
            m.shader = lit;
            m.SetTexture("_BaseMap", tex);
            m.SetColor("_BaseColor", Color.white);
            m.SetFloat("_Smoothness", 0.25f);
            // 取り出した凹凸の画像（NormalGL_*）があれば法線マップとして使う
            var normalPath = Directory.GetFiles(TojiDir + "/Textures", "NormalGL_*").FirstOrDefault(f => !f.EndsWith(".meta"));
            if (normalPath != null)
            {
                var ti = (TextureImporter)AssetImporter.GetAtPath(normalPath);
                if (ti.textureType != TextureImporterType.NormalMap) { ti.textureType = TextureImporterType.NormalMap; ti.SaveAndReimport(); }
                m.SetTexture("_BumpMap", AssetDatabase.LoadAssetAtPath<Texture2D>(normalPath));
                m.EnableKeyword("_NORMALMAP");
            }
            m.SetFloat("_Metallic", 0f);
            EditorUtility.SetDirty(m);
            imp.AddRemap(new AssetImporter.SourceAssetIdentifier(typeof(Material), src.name), m);
        }
        imp.SaveAndReimport();
    }

    // 間接光（壁や床に跳ね返る光）を焼き込む。
    // ※ 11/6 時点：この設定で焼くと画面が白飛びして粒が出たため、今は使っていない（環境光・SSAO・反射で代わりに表す）
    static void Bake()
    {
        string path = RenderDir + "/KuraLighting.lighting";
        AssetDatabase.DeleteAsset(path);
        var ls = new LightingSettings
        {
            bakedGI = true,
            realtimeGI = false,
            mixedBakeMode = MixedLightingMode.IndirectOnly,
            lightmapper = LightingSettings.Lightmapper.ProgressiveGPU,
            lightmapResolution = 10f,
            lightmapPadding = 2,
            lightmapMaxSize = 1024,
            maxBounces = 3,
            directSampleCount = 32,
            indirectSampleCount = 256,
            environmentSampleCount = 128,
            lightmapCompression = LightmapCompression.NormalQuality,
            directionalityMode = LightmapsMode.NonDirectional,
            filteringMode = LightingSettings.FilterMode.Auto,
            ao = true,
            aoMaxDistance = 0.6f,
        };
        AssetDatabase.CreateAsset(ls, path);
        Lightmapping.lightingSettings = ls;
        // WebGL でも明るさの幅を保つ形式で焼く（標準の形式だと白飛びと粒が出た）
        SetLightmapEncodingHigh("WebGL");
        SetLightmapEncodingHigh("Standalone");
        var t0 = DateTime.Now;
        bool ok = Lightmapping.Bake();
        Debug.Log($"[Kura] 光の焼き込み {(ok ? "完了" : "失敗")}（{(DateTime.Now - t0).TotalSeconds:0}秒）");
    }

    // プロジェクト設定の「光の焼き込みの形式」を高品質（HDR）にする（公開APIが無いため設定を直接書く）
    static void SetLightmapEncodingHigh(string target)
    {
        var ps = Unsupported.GetSerializedAssetInterfaceSingleton("PlayerSettings");
        var so = new SerializedObject(ps);
        var list = so.FindProperty("m_BuildTargetGroupLightmapEncodingQuality");
        if (list == null) { Debug.LogWarning("[Kura] 焼き込みの形式の設定が見つかりません"); return; }
        SerializedProperty item = null;
        for (int i = 0; i < list.arraySize; i++)
            if (list.GetArrayElementAtIndex(i).FindPropertyRelative("m_BuildTarget").stringValue == target) item = list.GetArrayElementAtIndex(i);
        if (item == null) { list.arraySize++; item = list.GetArrayElementAtIndex(list.arraySize - 1); item.FindPropertyRelative("m_BuildTarget").stringValue = target; }
        item.FindPropertyRelative("m_EncodingQuality").intValue = 2; // High
        so.ApplyModifiedPropertiesWithoutUndo();
    }

    // ================= 確認用の撮影（エディタで描いて PNG に保存） =================
    public static void Snapshot()
    {
        EditorSettings.asyncShaderCompilation = false; // 1枚目がシェーダーの準備前の仮の色で撮れないように
        var scene = EditorSceneManager.OpenScene(ScenePath);
        var bridge = UnityEngine.Object.FindFirstObjectByType<KuraBridge>();
        bridge.Init();
        // 今日（2/10）に近い仮の状態：液面いろいろ、5・6・7号に変化あり、6号を選択
        var temps = new[] { 8.8f, 9.6f, 10.2f, 10.8f, 11.7f, 12.5f, 11.4f, 9.9f, 9.2f, 8.4f };
        var levels = new[] { 0.9f, 0.88f, 0.86f, 0.85f, 0.87f, 0.84f, 0.8f, 0.62f, 0.45f, 0.2f };
        var tanks = new string[10];
        for (int i = 0; i < 10; i++)
            tanks[i] = $"{{\"id\":\"{i + 1}\",\"level\":{levels[i]},\"temp\":{temps[i]}}}";
        bridge.SetDay($"{{\"tempMin\":6,\"tempMax\":14,\"tanks\":[{string.Join(",", tanks)}]}}");
        foreach (var id in new[] { "5", "6", "7" }) bridge.HighlightTank($"{{\"id\":\"{id}\",\"on\":true}}");

        string tag = Environment.GetEnvironmentVariable("KURA_SHOT") ?? "wip";
        if (Environment.GetEnvironmentVariable("KURA_DEBUG_BEAM") == "1") // 光の筋の形と位置の確認用（不透明で描く）
            foreach (Transform b in GameObject.Find("Air").transform) b.GetComponent<Renderer>().sharedMaterial = AssetDatabase.LoadAssetAtPath<Material>(MatDir + "/Glow.mat");
        Directory.CreateDirectory(ShotDir);
        // 横長（動画）とブラウザの左側（やや縦長）の2通りで全体を撮る
        foreach (var (w, h, suffix) in new[] { (1600, 900, "overview"), (1020, 860, "overview-web") })
        {
            Camera.main.aspect = (float)w / h;
            bridge.PreviewCamera("overview", null);
            bridge.ApplyInstant();
            Shoot($"{tag}-{suffix}", w, h);
        }
        Camera.main.aspect = 1020f / 860f;
        bridge.PreviewCamera("overview", null);
        bridge.PreviewPast(true);
        bridge.ApplyInstant();
        Shoot($"{tag}-past", 1020, 860);
        bridge.PreviewPast(false);
        bridge.SelectTank("6");
        Camera.main.aspect = 1600f / 900f;
        bridge.PreviewCamera("toji", "6");
        bridge.ApplyInstant();
        Shoot($"{tag}-toji");
    }

    static void Shoot(string name, int w = 1600, int h = 900)
    {
        var cam = Camera.main;
        cam.aspect = (float)w / h;
        Debug.Log($"[Kura] カメラ {name}: 位置 {cam.transform.position} 向き {cam.transform.forward} 画角 {cam.fieldOfView}");
        var rt = new RenderTexture(w, h, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB) { antiAliasing = 4 };
        var req = new RenderPipeline.StandardRequest { destination = rt };
        if (RenderPipeline.SupportsRenderRequest(cam, req)) RenderPipeline.SubmitRenderRequest(cam, req);
        else { cam.targetTexture = rt; cam.Render(); cam.targetTexture = null; }
        var prev = RenderTexture.active; RenderTexture.active = rt;
        var tex = new Texture2D(w, h, TextureFormat.RGB24, false);
        tex.ReadPixels(new Rect(0, 0, w, h), 0, 0); tex.Apply();
        RenderTexture.active = prev;
        string file = Path.Combine(ShotDir, name + ".png");
        File.WriteAllBytes(file, tex.EncodeToPNG());
        Debug.Log("[Kura] 撮影: " + file);
    }

    // ================= 書き出し =================
    [MenuItem("Kura/2. WebGLで書き出してWebに置く")]
    public static void BuildWebGL()
    {
        // Brotli で圧縮（約44MB → 約10MB）。配信側が Content-Encoding を付けなくても読めるよう、ブラウザ側で解凍する仕組みも入れる
        // （Netlify では netlify.toml でヘッダーを付け、ブラウザ自身に解凍させる）
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
        PlayerSettings.WebGL.decompressionFallback = true;
        PlayerSettings.WebGL.dataCaching = false;
        PlayerSettings.companyName = "KuraTwin";
        PlayerSettings.productName = "KuraTwin";
        PlayerSettings.runInBackground = true;
        PlayerSettings.colorSpace = ColorSpace.Linear;
        // 起動時の「Made with Unity」は出さない（Unity 6 は Personal でも非表示にできる）。読み込み中の画面は Web 側（蔵ツインの見た目）で出す
        PlayerSettings.SplashScreen.show = false;
        PlayerSettings.SplashScreen.showUnityLogo = false;

        var opts = new BuildPlayerOptions
        {
            scenes = new[] { ScenePath },
            locationPathName = BuildDir,
            target = BuildTarget.WebGL,
            options = BuildOptions.None,
        };
        var report = BuildPipeline.BuildPlayer(opts);
        if (report.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded)
        {
            Debug.LogError("[Kura] 書き出しに失敗しました: " + report.summary.result);
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }

        var src = Path.Combine(BuildDir, "Build");
        var dst = Path.Combine(WebUnityDir, "Build");
        if (Directory.Exists(dst)) Directory.Delete(dst, true);
        Directory.CreateDirectory(dst);
        foreach (var f in Directory.GetFiles(src))
            File.Copy(f, Path.Combine(dst, Path.GetFileName(f)), true);
        // 書き出すたびに変わる版の印。Web 側はこれを URL に付けて、古い3Dがキャッシュから読まれないようにする
        File.WriteAllText(Path.Combine(dst, "version.txt"), DateTime.UtcNow.ToString("yyyyMMddHHmmss"));
        Debug.Log("[Kura] 書き出して Web に置きました: " + dst);
    }

    // コマンドから
    public static void SetupAndBuild() { SetupScene(false); BuildWebGL(); }
    public static void SetupQuickAndSnapshot() { SetupScene(false); Snapshot(); }
    public static void SetupBakeAndSnapshot() { SetupScene(true); Snapshot(); }
}
