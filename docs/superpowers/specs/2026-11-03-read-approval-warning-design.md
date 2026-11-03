# Read approval warning

New live sensitive-read requests trigger a single smooth ember-orange screen-edge
glow and an accessible announcement. The effect never blocks pointer input or
steals focus. Existing requests do not retrigger on unrelated renders or on a
browser reconnect with the same pending identities.

Approval cards gain a warning icon, a one-time light sweep, and a slow border
pulse while awaiting a decision. Replying or disconnected requests stop pulsing.
Reduced-motion users see static highlights instead of animation. There is no
sound, rapid flashing, or modal, and permission routing is unchanged.

After tests and a production build, trigger a native read permission request for
a harmless demo appsettings file. Verify it reaches the live viewer without
opening real credentials or approving it on the user's behalf.
