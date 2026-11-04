# Timeline tooltip event-stream action

## Approved behavior

Add a compact **Open in event stream** button below the timeline tooltip summary for both prompt and command markers. Activating it pauses playback at the displayed event, opens the event stream, and centers the matching card. Hovering and scrubbing alone do not open the stream.

## Integration

Reuse `Timeline`'s existing activation callback and `App`'s `inspectEvent` path. Make `FileActivity` open its stream when it receives a new jump request, including when the stream is currently closed. Existing search, event-type, and related-event filters must not hide an explicitly requested event.

Keep the action visible while the pointer or keyboard focus is inside the tooltip. Use a native button, retain the existing visual style, and keep interactive controls outside the descriptive `role="tooltip"` content. Dismiss the tooltip after activation and move keyboard focus to the opened stream's toggle.

Render the fixed-position tooltip directly after the scrubber viewport, outside its overflow container, so its action precedes related overflow controls in native Tab order. All delayed hover dismissal paths must check focus inside the tooltip, including timers originating from marker or scrubber pointer departure.

## Verification

Cover activation of a hovered event different from the current playback event, prompt markers, keyboard activation, pointer/focus retention, scrub-generated tooltip lifetime, and reopening a filtered stream. Run the frontend suite, type-check, and build; report previously observed unrelated failures separately.
