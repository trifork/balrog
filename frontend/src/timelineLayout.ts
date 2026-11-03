const scaleAtDistance = (distance: number) => 0.6 + 0.4 * Math.exp(-((Math.max(0, distance - 2) / 25) ** 2));

export function timelineLayout(count: number, activeIndex: number, viewportWidth: number, markerWidths: readonly number[] = []) {
  const inset = 28;
  const scales = Array.from({ length: count }, (_, index) => scaleAtDistance(Math.abs(index - activeIndex)));
  const intervals = Array.from({ length: Math.max(0, count - 1) }, (_, index) => {
    const padding = 7 * scaleAtDistance(Math.abs(index + 0.5 - activeIndex));
    return ((markerWidths[index] ?? 1) * scales[index] + (markerWidths[index + 1] ?? 1) * scales[index + 1]) / 2 + padding;
  });
  const total = intervals.reduce((sum, width) => sum + width, 0);
  const stretch = Math.max(1, (viewportWidth - inset * 2) / Math.max(1, total));
  const width = Math.max(viewportWidth, total * stretch + inset * 2);
  let offset = count === 1 ? width - inset : inset;
  const positions = scales.map((_, index) => {
    if (index) offset += intervals[index - 1] * stretch;
    return offset;
  });

  return { positions, scales, width };
}

export function moveTimelinePosition(positions: readonly number[], index: number, delta: number) {
  if (positions.length < 2) return 0;
  index = Math.max(0, Math.min(positions.length - 1, index));
  const start = Math.min(Math.floor(index), positions.length - 2);
  const current = positions[start] + (positions[start + 1] - positions[start]) * (index - start);
  const target = Math.max(positions[0], Math.min(positions[positions.length - 1], current + delta));
  let left = 0;
  let right = positions.length - 1;
  while (right - left > 1) {
    const middle = Math.floor((left + right) / 2);
    if (positions[middle] <= target) left = middle;
    else right = middle;
  }
  return left + (target - positions[left]) / (positions[right] - positions[left]);
}
