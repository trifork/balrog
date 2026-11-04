# Balrog retrospective

## Session and evidence

- Session: `{{session-id}}`
- Task and constraints: {{original task and constraints, or unknown}}
- Repository and revision: {{verified repository and revision, or unverified}}
- Assessment coverage: {{calls with evidence-supported reason and outcome assessments}} / {{included calls; distinguish unknowns and pending calls}}
- Skill-activation coverage: {{complete, partial, or unknown; identify available activation evidence and missing context}}
- Reporting helpers excluded: {{count}}
- Review-time calls excluded: {{yes, no, or unknown; explain snapshot limits without showing the cutoff unless requested}}
- Assessment publication: {{published call count, skipped because no calls remain, or failure and reason}}
- Evidence limits: {{missing context, unknown timestamps, current-revision inspections, or redactions; use none when applicable}}

## Commands

Capabilities, reasons, and outcomes below are retrospective assessments of the recorded
conversation, not original agent reports. Original records remain unchanged.

| id | command | capability | reason | outcome |
| --- | --- | --- | --- | --- |
| 1 | {{tool name and arguments, or reference to argument block}} | {{technical operation; unknown if unsupported}} | {{evidence-supported purpose; unknown if unsupported}} | {{evidence-supported finding, failure, partial progress, pending, or unknown}} |

<!-- Repeat rows in chronological order with consecutive numeric IDs. For an empty session, keep the header and state that no calls were recorded. -->

<!-- Add argument blocks only when needed. Key each block by the displayed command ID and use an appropriate code fence. -->

## Activated skills

| skill | activation evidence | task fit and contribution | future use |
| --- | --- | --- | --- |
| {{skill ID or name}} | {{displayed call IDs or explicitly labeled target-conversation activation context; note repeat activations}} | {{scope/trigger fit, observed benefit or overhead, and uncertainty}} | {{KEEP, NARROW, REPLACE, STOP, or UNKNOWN; concrete task trigger or condition and rationale}} |

<!-- List each distinct activated skill once within the reviewed snapshot, excluding review-only activations. If none are observed, remove the placeholder row and say so; do not claim no skills were activated when coverage is incomplete. Do not treat available skills or failed loads as activations. -->

## Higher-level improvements

| improvement | complexity | gain | evidence | validation |
| --- | --- | --- | --- | --- |
| {{P1: durable change and verified paths or instruction sections; include assumptions}} | {{LOW, MEDIUM, or HIGH}} | {{LOW, MEDIUM, or HIGH}} | {{displayed call IDs and observed pattern}} | {{follow-up task or check to test the expected gain}} |

<!-- Repeat rows for distinct supported proposals, including actionable skill-use changes from the assessment above. If none are justified, remove the placeholder row and say so. Estimates are qualitative, not measured savings. -->

## Recommendation

{{Identify the smallest promising change, or state that no change is justified.}}

{{Describe how a later comparable task would test the recommendation while preserving correctness and required verification. Note model, revision, or task differences that limit comparison.}}

Recommendations require separate approval before implementation.
