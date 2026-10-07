"""Tiny static server for web/ (adds correct MIME types for .js modules and binary blobs)."""
import http.server, socketserver, sys, pathlib, mimetypes, os

mimetypes.add_type("application/javascript", ".js")
for ext in (".f32", ".u32", ".i16", ".u16", ".u8", ".u64"):
    mimetypes.add_type("application/octet-stream", ext)
ROOT = pathlib.Path(__file__).resolve().parent / "web"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "200" not in (args[1] if len(args) > 1 else ""):
            super().log_message(fmt, *args)


socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), H) as httpd:
    print(f"serving {ROOT} at http://127.0.0.1:{PORT}", flush=True)
    httpd.serve_forever()
