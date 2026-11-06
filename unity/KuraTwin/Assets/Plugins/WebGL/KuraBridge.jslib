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
  // x, y は画面の割合（0〜1、y は下から）
  KuraBubble: function (textPtr, x, y, visible) {
    var text = UTF8ToString(textPtr);
    if (window.kuraOnTojiBubble) window.kuraOnTojiBubble(text, x, y, visible === 1);
  }
});
