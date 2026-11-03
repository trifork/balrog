## Excalidraw

Commit: `c711e80ec55b3d3713ce0e796540d16c401b2fbe`

When two elements are close together, elbow arrows can produce unnecessary short
jogs or extra segments. These routes look awkward, especially when a clean one-
or two-corner path could connect the elements without crossing them. Changing,
flipping, or pasting arrowhead styles can also leave an existing route with
segments that are too short to display the arrowhead correctly. Desired behavior

Elbow arrows should prefer the simplest valid route between bound elements:
- Use a single-corner route when the arrow leaves and enters the elements in
  perpendicular directions.
- Use a two-corner route when the arrow leaves and enters in compatible parallel
  directions.
- Keep every segment clear of the connected elements, including their stroke
  width and binding gap.
- Ensure segments are long enough to preserve rounded corners and fit any
  arrowheads.
- Fall back to the existing grid-based routing when a simple route would overlap
  an element or create segments that are too short.
- Recalculate the route when arrowheads are changed, flipped, or applied by
  pasting styles.
- Avoid rendering tiny, effectively invisible jogs as visual knots.

---

