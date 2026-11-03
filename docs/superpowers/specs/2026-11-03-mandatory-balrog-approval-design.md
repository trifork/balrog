# Mandatory Balrog approval

## Diagnosis

A real sensitive read emitted `permission.asked`, followed by a native `once`
reply nine milliseconds later. The CLI has `session.permissions: autoaccept`.
Synchronizing native requests alone therefore cannot enforce frontend approval.

## Required behavior

For matching reads, suspend `permission.evaluate` on a private Balrog gate before
OpenCode publishes a native request. Each gate has a fresh plugin-owned ID and
travels over the existing plugin/server/browser WebSockets. Only an explicit
Balrog Accept once or Reject command resolves that gate. Native permission
replies, including automatic replies, cannot resolve or remove it.

Accept changes that evaluation to `allow`, avoiding a second native prompt.
Reject changes it to `deny` with an explanation. Configured denies remain final,
and normal reads and other actions are unchanged. Keep native request bridging
for pre-existing requests, but it does not authorize new mandatory gates.

## Lifecycle

Disconnected transports retain gates in the plugin and republish them after
reconnect. Browser snapshots remain separate from recorded history. If transport
is disabled, deny sensitive reads immediately. Session interruption or deletion
and plugin unload deny unresolved gates and clean them up. A plugin reload cannot
carry an in-flight hook to a new instance: the old evaluation is denied and the
read must be retried. Never fall back to a native-only approval.

Check session ownership before adding a gate so globally subscribed plugin
instances do not each demand approval for another location's read. Keep CLI
autoaccept settings unchanged.

## Verification

Regression tests must show that evaluation stays pending until an exact browser
reply, even after a forged/native `once` reply. Cover approval, rejection,
disabled transport, interruption, unload, cross-session identity, ordinary reads,
configured denies, symlinks, and transport reconnects retaining the same gate.
Finish by reading the harmless demo appsettings file through the actual read
tool, not by manufacturing a native permission request.
