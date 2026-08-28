import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def configured_port() -> int:
    raw_port = os.environ.get("PORT", "8080")
    try:
        port = int(raw_port)
    except ValueError as error:
        raise ValueError("PORT must be an integer") from error

    if not 1 <= port <= 65535:
        raise ValueError("PORT must be between 1 and 65535")
    return port


class Handler(BaseHTTPRequestHandler):
    server_version = "hello-docker"

    def do_GET(self) -> None:
        if self.path in ("/healthz", "/readyz"):
            self._write_json(200, {"status": "ok"})
            return

        if self.path == "/":
            self._write_json(
                200,
                {
                    "message": "hello from bare metal jacket",
                    "release": os.environ.get("RELEASE_ID", "development"),
                },
            )
            return

        self._write_json(404, {"error": "not_found"})

    def _write_json(self, status: int, payload: dict[str, str]) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        print(
            json.dumps(
                {
                    "remote": self.client_address[0],
                    "message": format % args,
                },
                separators=(",", ":"),
            ),
            flush=True,
        )


def create_server(host: str = "0.0.0.0", port: int | None = None) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, configured_port() if port is None else port), Handler)


if __name__ == "__main__":
    server = create_server()
    print(
        json.dumps(
            {"event": "server_started", "port": server.server_port},
            separators=(",", ":"),
        ),
        flush=True,
    )
    server.serve_forever()
