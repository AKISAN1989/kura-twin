using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

// 蔵ツイン：シーンの用意と WebGL 書き出し。
// メニュー「Kura」から、またはコマンド（-executeMethod KuraBuild.SetupAndBuild）で実行する。
public static class KuraBuild
{
    const string ScenePath = "Assets/Scenes/Kura.unity";
    const string MaterialPath = "Assets/Materials/KuraBase.mat";
    const string BuildDir = "Builds/kura"; // → Builds/kura/Build/kura.loader.js など

    static string WebUnityDir => Path.GetFullPath(Path.Combine(Application.dataPath, "../../../web/public/unity"));

    [MenuItem("Kura/1. シーンを用意")]
    public static void SetupScene()
    {
        Directory.CreateDirectory("Assets/Scenes");
        Directory.CreateDirectory("Assets/Materials");

        var mat = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
        if (mat == null)
        {
            mat = new Material(Shader.Find("Standard"));
            AssetDatabase.CreateAsset(mat, MaterialPath);
        }

        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        var camGo = new GameObject("Main Camera");
        camGo.tag = "MainCamera";
        var cam = camGo.AddComponent<Camera>();
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.11f, 0.10f, 0.09f);
        cam.fieldOfView = 50;
        camGo.AddComponent<AudioListener>();

        var lightGo = new GameObject("Directional Light");
        var light = lightGo.AddComponent<Light>();
        light.type = LightType.Directional;
        light.intensity = 1.0f;
        light.shadows = LightShadows.Soft;
        lightGo.transform.rotation = Quaternion.Euler(55, -30, 0);

        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
        RenderSettings.ambientLight = new Color(0.45f, 0.42f, 0.38f);

        var bridge = new GameObject("KuraBridge").AddComponent<KuraBridge>();
        bridge.baseMaterial = mat;

        EditorSceneManager.SaveScene(scene, ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        AssetDatabase.SaveAssets();
        Debug.Log("[Kura] シーンを用意しました: " + ScenePath);
    }

    [MenuItem("Kura/2. WebGLで書き出してWebに置く")]
    public static void BuildWebGL()
    {
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
        PlayerSettings.WebGL.decompressionFallback = false;
        PlayerSettings.WebGL.dataCaching = false;
        PlayerSettings.companyName = "KuraTwin";
        PlayerSettings.productName = "KuraTwin";
        PlayerSettings.runInBackground = true;

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

    // コマンドから：シーンを用意して書き出す
    public static void SetupAndBuild()
    {
        SetupScene();
        BuildWebGL();
    }
}
