# Control-plane API contract

[control-plane.yaml](./control-plane.yaml) is the source of truth for the initial external API.

Run:

```bash
npm run lint:openapi
```

The placeholder OIDC URLs must be replaced after the identity ADR is accepted. Generated server or client code should be reproducible and committed only if the selected framework requires it.
