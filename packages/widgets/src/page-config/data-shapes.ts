import { z } from 'zod';

/**
 * The eighteen canonical data-contract shapes (04-widget-registry.md §3).
 * Server payloads and widget data contracts discriminate on these keys.
 */
export const DATA_SHAPES = [
  'single-metric',
  'metric+delta',
  'timeseries',
  'multi-timeseries',
  'categorical',
  'record-list',
  'record',
  'matrix',
  'hierarchy/tree',
  'calendar-events',
  'geo-points',
  'flows',
  'ohlc',
  'distribution',
  'boolean-map',
  'stream',
  'form-state',
  'static',
] as const;

export const dataShapeSchema = z.enum(DATA_SHAPES);

export type DataShape = z.infer<typeof dataShapeSchema>;
