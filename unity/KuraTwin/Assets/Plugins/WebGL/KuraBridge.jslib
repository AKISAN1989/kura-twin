// Unity → Web（JavaScript）への通知。受け口は web/src/bridge.js と main.js。
mergeInto(LibraryManager.library, {
  KuraReady: function () {
    if (window.kuraOnUnityReady) window.kuraOnUnityReady();
  },
  KuraTankClicked: function (idPtr) {
    var id = UTF8ToString(idPtr);
    if (window.kuraOnTankClicked) window.kuraOnTankClicked(id);
  },
  // 杜氏の見回りの作業：step = kai（櫂入れ）/ temp（品温を測る）/ write（帳面に書く）/ done
  KuraPatrol: function (idPtr, stepPtr, tempPtr) {
    if (window.kuraOnPatrol) window.kuraOnPatrol(UTF8ToString(idPtr), UTF8ToString(stepPtr), UTF8ToString(tempPtr));
  },
  // x, y は頭の中心、mx, my は口元（画面の割合 0〜1、y は下から）。r は頭の半径（画面の高さに対する割合）
  // 3Dの操作の切り替え：mode = walk（歩いて見る）／ orbit（今の操作）。杜氏の案内で自動で戻ったときも知らせる
  KuraCameraMode: function (modePtr) {
    if (window.kuraOnCameraMode) window.kuraOnCameraMode(UTF8ToString(modePtr));
  },
  KuraBubble: function (textPtr, x, y, visible, mx, my, r) {
    var text = UTF8ToString(textPtr);
    if (window.kuraOnTojiBubble) window.kuraOnTojiBubble(text, x, y, visible === 1, mx, my, r);
  }
});
