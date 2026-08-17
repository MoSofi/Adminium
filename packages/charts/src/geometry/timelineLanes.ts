// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Swimlane timeline geometry (`chart-timeline-lanes`, research/widget-registry.md
 * §2): stacked horizontal lanes with events positioned along a shared time
 * axis. The time axis is an LTR island (04 §7.4 — time axes never mirror), so
 * event x-positions are LTR here; the component flips only the lane-label
 * gutter side under RTL. Pure + DOM-free.
 */

export interface LaneEvent {
  lane: string;
  /** Normalized position along the time axis, 0 (oldest) … 1 (newest). */
  position: number;
  label: string;
  tone?: string;
}

export interface PositionedEvent {
  x: number;
  label: string;
  tone?: string | undefined;
}

export interface LaneRow {
  lane: string;
  index: number;
  /** Top y of the lane band. */
  y: number;
  height: number;
  /** Vertical center — the event pill baseline. */
  centerY: number;
  events: PositionedEvent[];
}

export interface LaneLayoutOptions {
  /** Vertical gap between lane bands (px, default 8). */
  laneGap?: number;
}

/**
 * One row per lane (in the given order), each carrying its events at pixel x =
 * `clamp(position, 0, 1) · width`. Events keep input order within a lane.
 */
export function layoutLanes(
  lanes: readonly string[],
  events: readonly LaneEvent[],
  width: number,
  height: number,
  options: LaneLayoutOptions = {},
): LaneRow[] {
  const { laneGap = 8 } = options;
  const count = lanes.length;
  if (count === 0) return [];
  const laneHeight = Math.max(0, (height - laneGap * (count - 1)) / count);

  return lanes.map((lane, index) => {
    const y = index * (laneHeight + laneGap);
    const laneEvents: PositionedEvent[] = events
      .filter((event) => event.lane === lane)
      .map((event) => ({
        x: Math.min(1, Math.max(0, event.position)) * width,
        label: event.label,
        tone: event.tone,
      }));
    return {
      lane,
      index,
      y,
      height: laneHeight,
      centerY: y + laneHeight / 2,
      events: laneEvents,
    };
  });
}

/** Normalize timestamped events to lane positions over a [min, max] time span. */
export function positionByTime(
  events: readonly { lane: string; ms: number; label: string; tone?: string | undefined }[],
): LaneEvent[] {
  if (events.length === 0) return [];
  const times = events.map((event) => event.ms);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = max - min || 1;
  return events.map((event) => ({
    lane: event.lane,
    position: (event.ms - min) / span,
    label: event.label,
    ...(event.tone !== undefined ? { tone: event.tone } : {}),
  }));
}
