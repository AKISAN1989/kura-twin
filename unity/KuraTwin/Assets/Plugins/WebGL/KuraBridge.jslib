// Unity → Web（JavaScript）への通知。受け口は web/src/bridge.js と main.js。
mergeInto(LibraryManager.library, {
  KuraReady: function () {
    if (window.kuraOnUnityReady) window.kuraOnUnityReady();
  },
  KuraTankClicked: function (idPtr) {
    var id = UTF8ToString(idPtr);
    if (window.kuraOnTankClicked) window.kuraOnTankClicked(id);
  },
  // x, y は画面の割合（0〜1、y は下から）
  KuraBubble: function (textPtr, x, y, visible) {
    var text = UTF8ToString(textPtr);
    if (window.kuraOnTojiBubble) window.kuraOnTojiBubble(text, x, y, visible === 1);
  }
});
