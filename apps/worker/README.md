# Worker

The worker will claim durable jobs, invoke narrow build and runtime adapters, persist state transitions, and publish deployment events.

Jobs must be idempotent, lease-based, and safe to retry after process or host failure. A build result does not activate a release.
