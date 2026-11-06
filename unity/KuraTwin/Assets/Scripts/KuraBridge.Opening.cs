using UnityEngine;

// 開いたときのオープニング（6〜8秒）：蔵の大戸が開き、朝の光が差し込む中をカメラがゆっくり入っていく。
// 足場の上の杜氏がこちらを振り向き「よう来たな」と一言。そのまま蔵全体の視点に落ち着く。
// 画面を触る（クリック・タップ・スクロール・キー）とすぐ飛ばせる。大戸と表の壁はオープニングのあいだだけ組み立てる（3Dのファイルは増やさない）。
// Web 側からは setCamera("opening", "hold") で閉じた大戸の前に止め、読み込み中の画面が消えたら setCamera("opening", "go") で動かす（開くたびに再生）
public partial class KuraBridge
{
    const float OpeningTime = 7.5f;
    const float DoorX = 1.5f, DoorZ = -19.5f, DoorHalf = 2.1f, DoorH = 4.2f; // 大戸口（入口は手前の右寄り）

    bool opening, openingSpoke, swallowPointer, openingHeld;
    float openingT;
    Transform openingRoot, doorL, doorR;
    Vector3 opP0, opPm, opP1, opL0, opLm, opL1;

    void StartOpening()
    {
        if (cam == null || toji == null) return;
        if (opening) EndOpening();
        AbortWork();
        guiding = false; walking = false; patrolMoving = false; leanTarget = 0f;
        guideCam = false; freeCam = false;
        Speak("");

        // 杜氏：入口から見える足場の手前側に立ち、横を向いて仕事をしている
        toji.position = new Vector3(DoorX, KuraScene.DeckHeight, -StandZ);
        toji.rotation = Quaternion.LookRotation(Vector3.right);

        BuildDoors();

        // カメラの道筋：大戸の外 → 戸口をくぐる → 蔵全体の視点
        SetOverview();
        opP1 = camTargetPos; opL1 = camLookAt;
        overview = false;
        opP0 = new Vector3(DoorX, 1.7f, DoorZ - 6.2f); // 表の壁と大戸が見える距離から
        opPm = new Vector3(DoorX, 2.4f, -15f);
        opL0 = new Vector3(DoorX, 2.6f, -10f);
        opLm = toji.position + Vector3.up * 1.6f;
        cam.transform.position = opP0;
        cam.transform.LookAt(opL0);
        cam.fieldOfView = 50f;
        camLookAtCurrent = opL0;

        openingT = 0f;
        openingSpoke = false;
        opening = true;
    }

    // 表の壁（漆喰）と大戸。影は落とさない（蔵の中の光を変えないため）
    void BuildDoors()
    {
        if (openingRoot != null) Destroy(openingRoot.gameObject);
        var kura = transform.Find("Kura");
        openingRoot = new GameObject("Opening").transform;
        openingRoot.SetParent(kura != null ? kura : transform, false);
        const float W = 12f, H = 9.5f, T = 0.3f;
        var plaster = palette.plaster; var wood = palette.wood; var dark = palette.woodDark;
        float l = DoorX - DoorHalf - 0.2f, r = DoorX + DoorHalf + 0.2f;
        KuraScene.Box(openingRoot, "FacadeLeft", new Vector3((-W + l) / 2f, H / 2f, DoorZ), new Vector3(l + W, H, T), plaster);
        KuraScene.Box(openingRoot, "FacadeRight", new Vector3((W + r) / 2f, H / 2f, DoorZ), new Vector3(W - r, H, T), plaster);
        KuraScene.Box(openingRoot, "FacadeTop", new Vector3(DoorX, (DoorH + H) / 2f, DoorZ), new Vector3(r - l, H - DoorH, T), plaster);
        KuraScene.Box(openingRoot, "Wainscot", new Vector3(0, 0.55f, DoorZ - T / 2f - 0.03f), new Vector3(W * 2, 1.1f, 0.06f), dark);
        // 戸口の枠（柱と鴨居）
        KuraScene.Box(openingRoot, "PostL", new Vector3(DoorX - DoorHalf - 0.1f, DoorH / 2f, DoorZ - 0.05f), new Vector3(0.28f, DoorH + 0.2f, 0.42f), wood);
        KuraScene.Box(openingRoot, "PostR", new Vector3(DoorX + DoorHalf + 0.1f, DoorH / 2f, DoorZ - 0.05f), new Vector3(0.28f, DoorH + 0.2f, 0.42f), wood);
        KuraScene.Box(openingRoot, "Lintel", new Vector3(DoorX, DoorH + 0.12f, DoorZ - 0.05f), new Vector3(DoorHalf * 2 + 0.7f, 0.32f, 0.46f), wood);
        // 大戸：左右2枚の板戸（横桟と取っ手）。外側へ引いて開ける
        doorL = Door("DoorL", -1f, dark, wood);
        doorR = Door("DoorR", 1f, dark, wood);
        foreach (var rd in openingRoot.GetComponentsInChildren<Renderer>())
            rd.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
    }

    Transform Door(string name, float side, Material board, Material batten)
    {
        var d = new GameObject(name).transform;
        d.SetParent(openingRoot, false);
        d.localPosition = new Vector3(DoorX + side * DoorHalf / 2f, 0f, DoorZ - 0.28f);
        KuraScene.Box(d, "Board", new Vector3(0, DoorH / 2f, 0), new Vector3(DoorHalf, DoorH, 0.1f), board);
        for (int i = 0; i < 4; i++)
            KuraScene.Box(d, "Batten", new Vector3(0, 0.5f + i * 1.05f, -0.07f), new Vector3(DoorHalf - 0.12f, 0.12f, 0.05f), batten);
        KuraScene.Box(d, "Stile", new Vector3(-side * (DoorHalf / 2f - 0.06f), DoorH / 2f, -0.07f), new Vector3(0.12f, DoorH, 0.05f), batten);
        KuraScene.Box(d, "Handle", new Vector3(-side * (DoorHalf / 2f - 0.25f), 1.15f, -0.12f), new Vector3(0.05f, 0.34f, 0.05f), palette.steel);
        return d;
    }

    static float Ease(float x) { x = Mathf.Clamp01(x); return x * x * (3f - 2f * x); }
    static Vector3 Bez(Vector3 a, Vector3 b, Vector3 c, float s) => Vector3.Lerp(Vector3.Lerp(a, b, s), Vector3.Lerp(b, c, s), s);

    // 毎フレーム（Update のカメラの代わりに呼ぶ）
    void UpdateOpening(float dt)
    {
        if (!openingHeld) openingT += dt; // 読み込み中の画面が消えるまでは、閉じた大戸の前で待つ
        float t = openingT;
        // 大戸：0.8〜2.8秒で左右に開く
        float o = Ease((t - 0.8f) / 2f);
        if (doorL != null) doorL.localPosition = new Vector3(DoorX - DoorHalf / 2f - o * (DoorHalf + 0.15f), 0f, DoorZ - 0.28f);
        if (doorR != null) doorR.localPosition = new Vector3(DoorX + DoorHalf / 2f + o * (DoorHalf + 0.15f), 0f, DoorZ - 0.28f);
        // カメラ：2秒目から戸口をくぐり、蔵全体の視点へ
        float s = Ease((t - 2f) / (OpeningTime - 2.3f));
        cam.transform.position = Bez(opP0, opPm, opP1, s);
        camLookAtCurrent = Bez(opL0, opLm, opL1, s);
        cam.transform.LookAt(camLookAtCurrent);
        cam.fieldOfView = Mathf.Lerp(50f, targetFov, s);
        // 杜氏：3.8秒で一言
        if (!openingSpoke && t >= 3.8f) { openingSpoke = true; Speak("よう来たな"); }
        if (t >= OpeningTime) EndOpening();
    }

    // 戸が開くにつれて、外の朝の光が満ちる（UpdatePast が毎フレーム決める明るさに掛ける）
    void ApplyOpeningLight()
    {
        if (!opening) return;
        float f = Mathf.Lerp(0.5f, 1f, Ease((openingT - 0.9f) / 2.6f));
        if (sun != null) sun.intensity *= f;
        RenderSettings.ambientSkyColor *= f;
        RenderSettings.ambientEquatorColor *= f;
        RenderSettings.ambientGroundColor *= f;
    }

    // 杜氏：3.2秒目からカメラ（来た人）の方へ振り向く。それまでは横を向いて立っている
    void UpdateOpeningToji(float dt)
    {
        if (tojiAnimator != null) { tojiAnimator.SetBool("Walking", false); tojiAnimator.speed = 1f; }
        if (openingT < 3.2f || cam == null) return;
        var look = cam.transform.position - toji.position; look.y = 0f;
        if (look.sqrMagnitude > 0.01f) Turn(Quaternion.LookRotation(look.normalized), dt * 0.6f);
    }

    // 画面に触ったか（オープニングを飛ばす）
    static bool AnyInput() =>
        Input.GetMouseButtonDown(0) || Input.GetMouseButtonDown(1) || Input.touchCount > 0 ||
        Mathf.Abs(Input.mouseScrollDelta.y) > 0.01f || Input.anyKeyDown;

    void EndOpening()
    {
        if (!opening) return;
        opening = false;
        if (openingRoot != null) { Destroy(openingRoot.gameObject); openingRoot = null; }
        if (!openingSpoke) Speak(""); // 飛ばしたときは一言も出さない
        resumePatrolAt = Time.time + 4f;
        SetOverview();
        cam.transform.position = camTargetPos;
        camLookAtCurrent = camLookAt;
        cam.transform.LookAt(camLookAt);
        cam.fieldOfView = targetFov;
    }
}
