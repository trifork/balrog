# Header session tabs

## Approved layout

Replace the sidebar and overview introduction with a compact header containing Balrog branding, horizontal session tabs, and connection status. Keep the existing dark palette and orange accent.

On desktop, the header uses one row. On small screens, branding and status stay together above a horizontally scrollable tab row. Long session titles truncate without widening the page.

Use a 48px desktop tab height and 16px main-container top and side padding. On small screens, reduce outer padding to 10–12px and keep tabs at least 44px tall. Keep branding, connection status, and header gaps compact to prioritize event content.

## Navigation and content

Move session selection into a focused `SessionTabs` component. Retain the All sessions option, recent-activity ordering, selected state, keyboard navigation, and URL/history behavior. Use horizontal tab semantics at all viewport sizes and keep focused tabs visible when navigating.

Remove sidebar rendering, session-tab event counts, activity summary cards, and the complete overview introduction, including its description. Keep the event feed, visible event count, search, filters, collapse controls, error display, and live connection status.

The viewer state, transport, event filtering, and event rendering remain unchanged. No server changes or additional dependencies are needed.

## Verification

Do not add, modify, or run tests. Verify with the existing TypeScript check, production build, and diff inspection. Do not create a commit without a user request.
