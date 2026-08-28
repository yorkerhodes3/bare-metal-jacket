# Node agent

The node agent is the only project component intended to hold local runtime privileges.

It will reconcile signed, authorized workload specifications into Docker resources and report observed state. Its protocol must remain narrow enough to replace Docker Engine with another scheduler without exposing a general-purpose remote Docker API.
