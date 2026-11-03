# Balrog retrospective

## Session and evidence

- Session: `{{session-id}}`
- Task and constraints: {{original task and constraints, or unknown}}
- Repository and revision: {{verified repository and revision, or unverified}}
- Outcome coverage: {{calls with recorded outcomes}} / {{included calls}}
- Reporting helpers excluded: {{count}}
- Review-time calls excluded: {{yes, no, or unknown; explain snapshot limits without showing the cutoff unless requested}}
- Evidence limits: {{missing context, unknown timestamps, current-revision inspections, or redactions; use none when applicable}}

## Commands

| id | command | reason | outcome |
| --- | --- | --- | --- |
| 1 | {{tool name and arguments, or reference to argument block}} | {{verbatim reason or null}} | {{verbatim outcome or null}} |

<!-- Repeat rows in chronological order with consecutive numeric IDs. For an empty session, keep the header and state that no calls were recorded. -->

<!-- Add argument blocks only when needed. Key each block by the displayed command ID and use an appropriate code fence. -->

## Higher-level improvements

| improvement | complexity | gain | evidence | validation |
| --- | --- | --- | --- | --- |
| {{P1: durable change and verified paths or instruction sections; include assumptions}} | {{LOW, MEDIUM, or HIGH}} | {{LOW, MEDIUM, or HIGH}} | {{displayed call IDs and observed pattern}} | {{follow-up task or check to test the expected gain}} |

<!-- Repeat rows for distinct supported proposals. If none are justified, remove the placeholder row and say so. Estimates are qualitative, not measured savings. -->

## Recommendation

{{Identify the smallest promising change, or state that no change is justified.}}

{{Describe how a later comparable task would test the recommendation while preserving correctness and required verification. Note model, revision, or task differences that limit comparison.}}

Recommendations require separate approval before implementation.
