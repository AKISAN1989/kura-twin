// 音声入力：ブラウザの音声認識で文字にしてから使う。使えないブラウザでは文字入力だけ。
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const speechAvailable = !!Recognition;

/** button を押すと、textarea に話した内容を書き足す */
export function attachMic(button, textarea) {
  if (!Recognition) { button.hidden = true; return; }
  button.hidden = false;
  let rec = null;
  button.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new Recognition();
    rec.lang = "ja-JP";
    rec.interimResults = false;
    rec.continuous = true;
    const before = textarea.value;
    let heard = "";
    rec.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) heard += e.results[i][0].transcript;
      textarea.value = before + heard;
    };
    rec.onend = () => { rec = null; button.textContent = "🎤 声で入力"; button.classList.remove("rec"); };
    rec.onerror = () => rec?.stop();
    rec.start();
    button.textContent = "■ 止める";
    button.classList.add("rec");
  };
}
