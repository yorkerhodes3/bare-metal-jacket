# Hello Docker

A dependency-free sample workload for the first end-to-end deployment and rollback test.

It exposes:

- `GET /` with the current release identifier;
- `GET /healthz` for liveness; and
- `GET /readyz` for readiness.

Run directly:

```bash
PORT=8080 RELEASE_ID=local python app.py
```

Test:

```bash
python -m unittest test_app.py
```

Build:

```bash
docker build -t hello-docker:local .
docker run --rm -p 8080:8080 -e RELEASE_ID=local hello-docker:local
```
