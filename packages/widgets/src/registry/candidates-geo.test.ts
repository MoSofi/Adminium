// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The map over a lat/lng pair asks for the columns the server reads.
 *
 * `geo-points` is positional — `[name, lat, lng, ...metrics]` — and the rule
 * bound the list's columns (display column, status, money…): the pair was not
 * in the second and third places, mostly not there at all, so every row was
 * read as a region with a code and no pin was drawn.
 */
import { describe, expect, it } from 'vitest';

import { emitCandidates, type CandidateContext, type CandidateTableInput } from './candidates.js';
import { validateConfigAgainst, widgetRegistry } from './index.js';

const ctx: CandidateContext = { connectionId: 'conn_01HZX0000000000000000000' };

interface Spec {
  name: string;
  logicalType: string;
  semantic: string;
  pair?: { role: string; partner: string };
  pk?: boolean;
  secret?: boolean;
}

function build(specs: Spec[], displayColumn: string | null): CandidateTableInput {
  return {
    table: {
      id: 'public.stops',
      schema: 'public',
      name: 'stops',
      kind: 'table',
      primaryKey: specs.filter((spec) => spec.pk).map((spec) => spec.name),
      columns: specs.map((spec) => ({ name: spec.name, logicalType: spec.logicalType, nullable: true, isPrimaryKey: spec.pk ?? false, references: null })),
    },
    classified: {
      tableId: 'public.stops',
      shape: 'geo',
      role: 'entity',
      displayColumn,
      columns: specs.map((spec) => ({ column: spec.name, semantic: spec.semantic, format: null, secret: spec.secret ?? false, pair: spec.pair ?? null })),
    },
  };
}

const LAT: Spec = { name: 'lat', logicalType: 'decimal', semantic: 'geo-point', pair: { role: 'lat', partner: 'lng' } };
const LNG: Spec = { name: 'lng', logicalType: 'decimal', semantic: 'geo-point', pair: { role: 'lng', partner: 'lat' } };
const mapOf = (input: CandidateTableInput) => emitCandidates(input.table, input.classified, ctx).find((candidate) => candidate.rule === 'geo.lat-lng-pair');

describe('emitCandidates — a lat/lng pair (geo.lat-lng-pair)', () => {
  it('binds name, then the pair, then the figures: the order the server reads', () => {
    // A status and a date come before the pair in a list; they are not asked for here.
    const stops = build(
      [
        { name: 'id', logicalType: 'integer', semantic: 'pk-id', pk: true },
        { name: 'title', logicalType: 'varchar', semantic: 'plain' },
        { name: 'state', logicalType: 'varchar', semantic: 'status-workflow' },
        { name: 'created_at', logicalType: 'timestamptz', semantic: 'created-at' },
        { name: 'takings', logicalType: 'decimal', semantic: 'money' },
        LAT,
        LNG,
      ],
      'title',
    );
    const map = mapOf(stops);
    expect(map?.widget).toBe('map-bubble');
    expect(map?.binding).toMatchObject({ shape: 'geo-points', select: ['title', 'lat', 'lng', 'takings'] });
    expect(map?.config).toMatchObject({ nameField: 'title', latColumn: 'lat', lngColumn: 'lng', metrics: ['takings'] });
    expect(validateConfigAgainst(widgetRegistry.get('map-bubble')!, map?.config ?? {}).warnings).toEqual([]);
  });

  it('names a point by its key when the table has no display column', () => {
    const map = mapOf(build([{ name: 'id', logicalType: 'integer', semantic: 'pk-id', pk: true }, LAT, LNG], null));
    expect(map?.binding).toMatchObject({ select: ['id', 'lat', 'lng'] });
    expect(map?.config).toMatchObject({ nameField: 'id' });
    expect(map?.config).not.toHaveProperty('metrics');
  });

  it('offers nothing when the pair is all the table has', () => {
    expect(mapOf(build([LAT, LNG], null))).toBeUndefined();
  });
});
