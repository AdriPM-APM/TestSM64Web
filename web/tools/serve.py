"""Static server for the SM64 web build, with the MIME types the build needs.

    python3 web/tools/serve.py [port] [--bind 0.0.0.0] [--root DIR]

Serves this repo's web/ directory by default; pass --root dist to serve a build
produced by build_web.sh. Python's http.server does not know .wasm or
.webmanifest, which breaks `WebAssembly.instantiateStreaming` and PWA installs,
so they are set here.
"""
import functools
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".html": "text/html; charset=utf-8",
    }

    def end_headers(self):
        p = self.path.split("?")[0]
        # The engine and the shell must revalidate; the 13 MB wasm can be immutable
        # once the build hash changes, so keep it cacheable during testing.
        if p.endswith(".wasm"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        elif p.endswith((".js", ".html", ".webmanifest")) or p.endswith("/"):
            self.send_header("Cache-Control", "no-cache")
        # Service workers only control the page from a secure context; localhost counts.
        self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    port = 3000
    bind = "0.0.0.0"
    args = sys.argv[1:]
    if args and args[0].isdigit():
        port = int(args[0])
    if "--bind" in args:
        bind = args[args.index("--bind") + 1]

    root = ROOT
    if "--root" in args:
        root = os.path.abspath(args[args.index("--root") + 1])
    if not os.path.isdir(root):
        raise SystemExit(f"no such directory: {root}")

    handler = functools.partial(Handler, directory=root)
    srv = ThreadingHTTPServer((bind, port), handler)
    print(f"serving {root} on http://{bind}:{port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
