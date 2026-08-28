import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from app import configured_port, create_server


class HelloDockerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = create_server(host="127.0.0.1", port=0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def get_json(self, path: str) -> tuple[int, dict[str, str]]:
        with urllib.request.urlopen(f"{self.base_url}{path}", timeout=2) as response:
            return response.status, json.load(response)

    def test_root_identifies_release(self) -> None:
        with patch.dict(os.environ, {"RELEASE_ID": "test-release"}):
            status, payload = self.get_json("/")

        self.assertEqual(status, 200)
        self.assertEqual(payload["release"], "test-release")

    def test_health_endpoints_are_ready(self) -> None:
        for path in ("/healthz", "/readyz"):
            status, payload = self.get_json(path)
            self.assertEqual(status, 200)
            self.assertEqual(payload, {"status": "ok"})

    def test_unknown_path_returns_json_404(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(f"{self.base_url}/missing", timeout=2)

        self.assertEqual(context.exception.code, 404)
        self.assertEqual(json.load(context.exception), {"error": "not_found"})

    def test_port_validation(self) -> None:
        with patch.dict(os.environ, {"PORT": "not-a-number"}):
            with self.assertRaisesRegex(ValueError, "PORT must be an integer"):
                configured_port()

        with patch.dict(os.environ, {"PORT": "70000"}):
            with self.assertRaisesRegex(ValueError, "PORT must be between"):
                configured_port()


if __name__ == "__main__":
    unittest.main()
