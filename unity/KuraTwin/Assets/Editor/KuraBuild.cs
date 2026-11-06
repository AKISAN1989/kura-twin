using System;
using System.IO;
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
            enamel = Lit("Enamel", new Color(0.93f, 0.925f, 0.9f), 0.82f, 0f, null, enamelN, new Vector2(2, 1), 0.4f),
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
            band = Lit("TempBand", new Color(0.55f, 0.55f, 0.53f), 0.55f),
            glow = Emissive("Glow", new Color(0.2f, 0.12f, 0.05f), new Color(1f, 0.55f, 0.18f) * 2f, false),
            glowSoft = SoftGlow("GlowSoft", ringTex),
            lampShade = Lit("LampShade", new Color(0.18f, 0.24f, 0.2f), 0.6f, 0.2f),
            lampBulb = Emissive("LampBulb", Color.white, new Color(1f, 0.82f, 0.6f) * 6f, false),
            windowPaper = Emissive("WindowPaper", new Color(0.95f, 0.93f, 0.88f), new Color(1f, 0.93f, 0.82f) * 1.6f, true),
            tojiCloth = Lit("TojiCloth", new Color(0.72f, 0.7f, 0.66f), 0.1f), // 仮の杜氏は淡い灰色（目立たせない）
            tojiSkin = Lit("TojiSkin", new Color(0.74f, 0.72f, 0.68f), 0.1f),
            tojiTowel = Lit("TojiTowel", new Color(0.95f, 0.95f, 0.93f), 0.1f),
            text = TextMat(),
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
        Directory.CreateDirectory(ShotDir);
        // 横長（動画）とブラウザの左側（やや縦長）の2通りで全体を撮る
        foreach (var (w, h, suffix) in new[] { (1600, 900, "overview"), (1020, 860, "overview-web") })
        {
            Camera.main.aspect = (float)w / h;
            bridge.PreviewCamera("overview", null);
            bridge.ApplyInstant();
            Shoot($"{tag}-{suffix}", w, h);
        }
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
        Debug.Log("[Kura] 書き出して Web に置きました: " + dst);
    }

    // コマンドから
    public static void SetupAndBuild() { SetupScene(false); BuildWebGL(); }
    public static void SetupQuickAndSnapshot() { SetupScene(false); Snapshot(); }
    public static void SetupBakeAndSnapshot() { SetupScene(true); Snapshot(); }
}
