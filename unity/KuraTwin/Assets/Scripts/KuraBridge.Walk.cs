using System.Collections.Generic;
using System.Runtime.InteropServices;
using UnityEngine;

// 「歩いて見る」：人の目の高さで、床と足場の上を歩く。壁・タンク・床の物・手すりはすり抜けない。はしごで足場に上がれる。
// Web 側からは setCamera の mode で操作する（命令は5つのまま）：
//   walk（歩いて見るに切り替え）／move（id = "x,y"：スティックやキーの向き -1〜1）／turn（id = left|right）／zoom（id = in|out）
// 見回しは、3Dの上を指でなぞる・マウスでドラッグ（HandleInput）。「戻る」や他の視点、杜氏の案内で、今の操作に戻る。
public partial class KuraBridge
{
#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")] static extern void KuraCameraMode(string mode);
#else
    static void KuraCameraMode(string mode) { }
#endif

    bool walkMode;
    int walkLevel;                 // 0：床、1：足場
    Vector3 walkPos;               // 足もと
    float walkYaw, walkYawTarget, walkPitch;
    Vector2 walkInput;
    float climbT = -1f;
    Vector3 climbFrom, climbTo;
    int climbToLevel;
    readonly List<Bounds> walkBlocks = new List<Bounds>();

    const float WalkRadius = 0.25f, WalkSpeedMax = 1.4f, ClimbTime = 1.8f;
    const float FloorMinX = -11.5f, FloorMaxX = 11.5f, FloorMinZ = -19f, FloorMaxZ = 8.5f; // 壁の内側（手前は入口のあたりまで）
    const float DeckWalkMinX = -7.95f, DeckWalkMaxX = 7.7f, DeckWalkZ = 0.45f;              // 足場の上（手すりの内側）
    const float LadderTopX = -7.55f, LadderFootX = -9.4f;                                   // はしごの上と下（足場の左端）

    /// <summary>床の上で人がぶつかる物（床の小物と、足場の柱・筋交い）を、形の箱から集める</summary>
    void CollectWalkBlocks()
    {
        walkBlocks.Clear();
        var kura = transform.Find("Kura");
        if (kura == null) return;
        void From(Transform root, System.Func<Transform, bool> skip)
        {
            if (root == null) return;
            foreach (var r in root.GetComponentsInChildren<Renderer>())
            {
                if (r is ParticleSystemRenderer || skip(r.transform)) continue;
                var b = r.bounds;
                if (b.min.y > 1.7f || b.max.y < 0.15f) continue;     // 体の高さにかからない物（床の模様・壁の高い所）
                if (b.size.x > 18f || b.size.z > 18f) continue;     // 床・壁そのもの
                walkBlocks.Add(b);
            }
        }
        bool Under(Transform t, string name) { for (var p = t; p != null; p = p.parent) if (p.name == name) return true; return false; }
        // 床を這うホースはまたげるので除く（リールから床へ下りる形のため、箱にすると床の広い範囲をふさいでしまう）
        From(FindDeep(kura, "Props"), t => Under(t, "Floor") || Under(t, "FanBlades") || t.name == "FloorHose" || t.name == "Nozzle");
        From(FindDeep(kura, "Scaffold"), t => Under(t, "Ladder") || !(t.name == "Post" || t.name == "Brace"));
    }

    void StartWalk()
    {
        if (cam == null) return;
        if (walkBlocks.Count == 0) CollectWalkBlocks();
        walkMode = true;
        freeCam = false; overview = false; guideCam = false;
        walkLevel = 0;
        walkPos = new Vector3(1.5f, 0f, -10f); // 入口の近く、タンクの列を前に見る所から
        walkYaw = walkYawTarget = 0f;
        walkPitch = 4f;
        walkInput = Vector2.zero;
        climbT = -1f;
        KuraCameraMode("walk");
    }

    /// <summary>今の操作（蔵全体の視点）に戻す。toOverview=false のときは、呼んだ側が次の視点を決める</summary>
    void ExitWalk(bool toOverview = true)
    {
        if (!walkMode) return;
        walkMode = false;
        walkInput = Vector2.zero;
        climbT = -1f;
        if (toOverview) SetOverview();
        KuraCameraMode("orbit");
    }

    /// <summary>setCamera の mode のうち、操作のボタン・歩いて見る に関わるもの。扱ったら true</summary>
    bool HandleCameraControl(string mode, string arg)
    {
        switch (mode)
        {
            case "walk":
                StartWalk();
                // 確かめ・画面の素材用：id = "x,z,向き" で歩き始める場所を決められる
                var a = (arg ?? "").Split(',');
                if (a.Length == 3 && float.TryParse(a[0], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var sx)
                    && float.TryParse(a[1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var sz)
                    && float.TryParse(a[2], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var sy))
                { walkPos = new Vector3(sx, 0f, sz); walkYaw = walkYawTarget = sy; }
                return true;
            case "walkinfo":
                Debug.Log($"[walk] x={walkPos.x:F2} y={walkPos.y:F2} z={walkPos.z:F2} yaw={walkYaw:F0} level={walkLevel} climbing={climbT >= 0f} blocks={walkBlocks.Count}");
                foreach (var b in walkBlocks) if (Mathf.Abs(b.center.x - walkPos.x) < 3f && Mathf.Abs(b.center.z - walkPos.z) < 3f) Debug.Log($"[walk] block {b.center} {b.size}");
                return true;
            case "move":
            {
                var p = (arg ?? "").Split(',');
                float x = 0f, y = 0f;
                if (p.Length == 2) { float.TryParse(p[0], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out x); float.TryParse(p[1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out y); }
                walkInput = new Vector2(Mathf.Clamp(x, -1f, 1f), Mathf.Clamp(y, -1f, 1f));
                return true;
            }
            case "turn":
            {
                float step = arg == "left" ? -30f : 30f;
                if (walkMode) walkYawTarget += step;
                else { EnterFree(); yawTarget += step; }
                return true;
            }
            case "zoom":
                if (!walkMode) Zoom(arg == "in" ? 0.35f : -0.35f);
                return true;
        }
        return false;
    }

    // 見回す（3Dの上をなぞる・ドラッグ）
    void WalkLook(Vector2 delta)
    {
        walkYawTarget += delta.x * 0.18f;
        walkYaw = walkYawTarget;
        walkPitch = Mathf.Clamp(walkPitch - delta.y * 0.14f, -60f, 60f);
    }

    bool WalkFree(Vector3 p)
    {
        if (walkLevel == 1) return p.x >= DeckWalkMinX && p.x <= DeckWalkMaxX && Mathf.Abs(p.z) <= DeckWalkZ;
        if (p.x < FloorMinX || p.x > FloorMaxX || p.z < FloorMinZ || p.z > FloorMaxZ) return false;
        foreach (var t in tanks.Values)
        {
            var c = t.root.position; c.y = 0f;
            if ((new Vector3(p.x, 0f, p.z) - c).magnitude < KuraScene.TankRadius + 0.14f + WalkRadius) return false; // 台座も含めて
        }
        foreach (var b in walkBlocks)
            if (p.x > b.min.x - WalkRadius && p.x < b.max.x + WalkRadius && p.z > b.min.z - WalkRadius && p.z < b.max.z + WalkRadius) return false;
        return true;
    }

    // はしご：床の左端ではしごに向かって進むと足場へ上がり、足場の左端からはしごへ進むと床へ下りる
    bool TryLadder(Vector3 move)
    {
        if (walkLevel == 0 && walkPos.x < -8.1f && walkPos.x > -9.9f && Mathf.Abs(walkPos.z) < 0.6f && move.x > 0f)
        {
            climbFrom = walkPos; climbTo = new Vector3(LadderTopX, KuraScene.DeckHeight, 0f); climbToLevel = 1; climbT = 0f;
            walkYawTarget = 90f; // 足場の先（右）を向いて上がる
            return true;
        }
        if (walkLevel == 1 && walkPos.x < -7.75f && move.x < 0f)
        {
            climbFrom = walkPos; climbTo = new Vector3(LadderFootX, 0f, 0f); climbToLevel = 0; climbT = 0f;
            walkYawTarget = -90f;
            return true;
        }
        return false;
    }

    void UpdateWalk(float dt)
    {
        if (climbT >= 0f)
        {
            climbT += dt / ClimbTime;
            float s = Ease(climbT);
            // 上り下りのあいだは、はしごの傾きに沿って高さを先に変える
            walkPos = new Vector3(Mathf.Lerp(climbFrom.x, climbTo.x, s), Mathf.Lerp(climbFrom.y, climbTo.y, Mathf.Clamp01(climbT * 1.25f)), Mathf.Lerp(climbFrom.z, climbTo.z, s));
            if (climbT >= 1f) { climbT = -1f; walkPos = climbTo; walkLevel = climbToLevel; }
        }
        else
        {
            var input = walkInput;
            if (input.sqrMagnitude > 1f) input.Normalize();
            if (input.sqrMagnitude > 0.0025f)
            {
                var rot = Quaternion.Euler(0f, walkYaw, 0f);
                var move = (rot * Vector3.forward * input.y + rot * Vector3.right * input.x) * WalkSpeedMax * dt;
                if (!TryLadder(move))
                {
                    // ぶつかったら、壁に沿って滑るように片方の向きだけ進む
                    var next = walkPos + move;
                    if (WalkFree(next)) walkPos = next;
                    else if (WalkFree(walkPos + new Vector3(move.x, 0f, 0f))) walkPos += new Vector3(move.x, 0f, 0f);
                    else if (WalkFree(walkPos + new Vector3(0f, 0f, move.z))) walkPos += new Vector3(0f, 0f, move.z);
                }
            }
        }
        walkYaw = Mathf.LerpAngle(walkYaw, walkYawTarget, 1f - Mathf.Exp(-dt * 10f));
        cam.transform.position = walkPos + Vector3.up * KuraScene.EyeHeight;
        cam.transform.rotation = Quaternion.Euler(walkPitch, walkYaw, 0f);
        cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, 62f, 1f - Mathf.Exp(-dt * 6f));
        camTargetPos = cam.transform.position;
        camLookAt = camLookAtCurrent = cam.transform.position + cam.transform.forward * 3f;
    }
}
