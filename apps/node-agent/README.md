# Node agent

The node agent is the only project component intended to hold local runtime privileges.

It will reconcile signed, authorized workload specifications into Docker resources and report observed state. Its protocol must remain narrow enough to replace Docker Engine with another scheduler without exposing a general-purpose remote Docker API.

The GPU worker bundle's read-only status service is an enrollment precursor, not this privileged agent. It exposes health, declared inventory, and model discovery over the private tailnet, but cannot create containers or access Docker.
