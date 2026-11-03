## Markdown

Commit: `0bfd8c3`

Avoid quadratic parsing of consecutive reference and footnote definitions
Problem
Parsing many consecutive reference-link or footnote definitions becomes disproportionately slow as the number of definitions increases.
Examples:
[id0]: https://example.com/0
[id1]: https://example.com/1
[id2]: https://example.com/2
...
[^0]: Footnote 0
[^1]: Footnote 1
[^2]: Footnote 2
...
Documents containing thousands of definitions exhibit quadratic-time parsing behavior.
Desired behavior
- Parsing consecutive reference and footnote definitions should scale
  approximately linearly with the number of definitions.
- Existing Markdown behavior and rendered output must remain unchanged.
- Definitions must continue to interact correctly with surrounding content
- Existing handling of duplicate, indented, and multiline reference definitions
  must be preserved.
- Existing handling of multiline, lazily indented, and multi-paragraph footnotes
  must be preserved. Acceptance criteria
- A document containing 10,000 consecutive reference definitions completes
  without a disproportionate increase in parsing time.
- A document containing 5,000 consecutive footnote definitions completes without
  a disproportionate increase in parsing time.
- Regression tests cover the large-input cases and interactions with surrounding
  block content.
- Existing tests continue to pass.
- A changelog entry documents the performance improvement.

