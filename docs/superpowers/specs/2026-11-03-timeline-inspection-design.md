# Timeline inspection and historical heatmap

## Approved behavior

Time navigation changes the playback position without opening the event stream.
This includes dragging, scrolling, navigation keys, prompt navigation controls,
and pausing live playback. Clicking a timeline event or activating it with Enter
or Space opens the stream and centers that event. Existing manual-open controls
remain available. Navigating after closing the stream must not reopen it.
The current prompt remains clickable through its slider overlay, and keyboard
navigation transfers focus to the playback handle before activation.

The heatmap and inspector reconstruct recorded file activity through the selected
event, including pending, successful, failed, and reverted snapshots. Later
events must not change this historical view. Go live restores the latest activity.
The timeline retains the complete session history so users can navigate forward.
Recording and read approvals remain live.
Heatmap prompt/file filters preserve the existing live or paused playback mode;
clearing those filters while paused does not resume live updates.

## Architecture

Keep selection and explicit activation as separate callbacks in `Timeline` and
`useTimelineScrubber`. Only activation creates the application's event inspection
request. Pointer cancellation and completed drags never activate an event.
Keyboard navigation selects; Enter and Space activate the focused event.

Keep full-history prompts for timeline boundaries. Derive a separate set of
heatmap prompts from events through the playback cutoff, using the existing
snapshot collector rather than interpreting file changes again.

## Verification

Exercise event clicks, keyboard activation, dragging, scrolling, navigation keys,
prompt controls, pause/resume, closed-stream navigation, and historical snapshot
updates. Run frontend tests, TypeScript checking, and the production build.
