"""Node.js が無くても web/ を確認するための簡易サーバー（開発用）。

    python3 -I web/scripts/serve_static.py   → http://localhost:5173

web/ を優先し、無ければ web/public/ を探す（Vite と同じ配置で見える）。
Unity は圧縮なし（Compression Format: Disabled）で書き出す前提。
"""
import http.server
import os
from functools import partial
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
PUBLIC = WEB / "public"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "application/javascript", ".wasm": "application/wasm",
                      ".json": "application/json", ".gz": "application/octet-stream"}

    def translate_path(self, path):
        p = Path(super().translate_path(path))
        rel = p.relative_to(WEB) if p.is_relative_to(WEB) else None
        if rel is not None and not p.exists() and (PUBLIC / rel).exists():
            return str(PUBLIC / rel)
        return str(p)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5173"))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(WEB)))
    print(f"http://localhost:{port}")
    server.serve_forever()
