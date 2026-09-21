// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The descriptor gate.
 *
 * `templateFit` derives almost everything from the rules themselves — which
 * slots are unfilled comes from `composeTemplate`'s own warnings, and whether a
 * role is satisfied comes from the registry predicate the trigger calls. One
 * thing cannot be derived: `wants`, what a column that does not exist yet would
 * have to BE. A predicate rejects; it does not construct. So `wants` is the one
 * part of the fit report that can lie, and this is the test that stops it.
 *
 * THE FAILURE IT EXISTS TO CATCH. `r12-event-timestamp` tags a timestamp only
 * when its NAME ends `_at`/`_date`/`_on`/`_time`/`_ts`. A repair that adds a
 * column of the right TYPE under a name the classifier does not tag produces a
 * table that still fails the check — a gate that cannot open, and a repair the
 * operator watched succeed. Same for `page-board`, whose requirement reaches
 * into the enum's VALUES: a status of `bronze|silver|gold` is the right type,
 * the right semantic and still no board.
 *
 * So: build a table out of NOTHING but the descriptors, classify it with the
 * real classifier, and require the template to compose. If a descriptor ever
 * stops describing a working column, this fails here rather than in a support
 * conversation about a calendar that stayed empty after the fix.
 */
import { describe, expect, it } from 'vitest';

import { applyClassification } from '../src/classify/index.js';
import { REPAIRABLE_TEMPLATES, fitDescriptorsFor, templateFit } from '../src/generate/index.js';
import { parseDatabaseModel, type DatabaseModel } from '../src/schema-model.js';

/**
 * A model containing one table built from a template's `wants`, and nothing
 * else — no lucky extra column, no helpful name.
 *
 * The people table exists only for a `semantic: 'fk'` role: `personFk` tests
 * the column's `references` AND the target table's name, neither of which a
 * descriptor can carry as a column property. Pointing at `employees` is the
 * test's own assumption, and composition is what validates it.
 */
function modelFromDescriptors(
  template: string,
  /** Which of each role's `suggestedNames` to build with. */
  nameIndex = 0,
): { model: DatabaseModel; tableId: string } {
  const wants = fitDescriptorsFor(template);
  expect(wants.length, `${template} declares no descriptors`).toBeGreaterThan(0);

  const columns: Record<string, unknown>[] = [
    { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
  ];
  const enums: Record<string, unknown>[] = [];
  let needsPeople = false;

  for (const want of wants) {
    // The FIRST logical type, the declared `maxLength` and the declared values:
    // exactly the column a repair builds. Building a friendlier one would test
    // a column the product never creates.
    const name = want.suggestedNames[Math.min(nameIndex, want.suggestedNames.length - 1)] as string;
    const column: Record<string, unknown> = { name, logicalType: want.logicalTypes[0] };
    if (want.maxLength !== undefined) column['maxLength'] = want.maxLength;
    if (want.semantic === 'fk') {
      needsPeople = true;
      column['references'] = { tableId: 'main.employees', column: 'id' };
    }
    if (want.enumValues !== undefined) {
      // How the values reach the model is the projection's business; what this
      // gate pins is that these VALUES, on this TYPE, earn the semantic.
      const id = `main.fit_probe.${name}`;
      enums.push({ id, name, values: want.enumValues, source: 'check' });
      column['enumRef'] = id;
    }
    columns.push(column);
  }

  const tables: Record<string, unknown>[] = [
    { schema: 'main', name: 'fit_probe', columns, primaryKey: ['id'] },
  ];
  if (needsPeople) {
    tables.push({
      schema: 'main',
      name: 'employees',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'full_name', logicalType: 'text' },
      ],
      primaryKey: ['id'],
    });
  }

  const model = applyClassification(
    parseDatabaseModel({
      dialect: 'postgres',
      name: 'fit',
      defaultSchema: 'main',
      schemas: ['main'],
      tables,
      enums,
    }),
  );
  return { model, tableId: 'main.fit_probe' };
}

describe('fit descriptors describe a column that actually works', () => {
  it.each([...REPAIRABLE_TEMPLATES])('%s composes from its own descriptors alone', (template) => {
    const { model, tableId } = modelFromDescriptors(template);
    const fit = templateFit(model, tableId, template);

    expect(fit.satisfied, `${template} does not compose from its own wants: ${JSON.stringify(fit.unfilled)}`).toBe(true);
    expect(fit.unfilled).toEqual([]);
    // Every declared role must be filled by the column the descriptor named —
    // composing for some OTHER reason would hide a broken descriptor.
    for (const requirement of fit.requirements) {
      const want = fitDescriptorsFor(template).find((w) => w.semantic === requirement.wants.semantic);
      expect(requirement.satisfiedBy).toBe(want?.suggestedNames[0]);
    }
  });

  it.each([...REPAIRABLE_TEMPLATES])('%s composes under EVERY fallback name it offers', (template) => {
    // The fallbacks are not decoration: the first name can be taken by a column
    // that fails the role (a text `event_date`, an integer `status`), and the
    // repair then reaches for the next one. A fallback the classifier does not
    // tag would be a repair that runs, succeeds, and leaves the page refusing.
    const longest = Math.max(...fitDescriptorsFor(template).map((w) => w.suggestedNames.length));
    expect(longest).toBeGreaterThan(1);
    for (let index = 1; index < longest; index += 1) {
      const { model, tableId } = modelFromDescriptors(template, index);
      const fit = templateFit(model, tableId, template);
      expect(fit.satisfied, `${template} fails at fallback name #${String(index)}`).toBe(true);
    }
  });

  it('the suggested name alone carries the semantic — no override needed', () => {
    // Half of D3: the pre-filled name must satisfy the classifier's heuristic
    // unaided, so the repair survives an operator clearing the override.
    const { model } = modelFromDescriptors('page-calendar');
    const column = model.tables
      .find((t) => t.id === 'main.fit_probe')
      ?.columns.find((c) => c.name === 'event_date');
    expect(column?.semantics?.primary).toBe('event-timestamp');
    expect(column?.semantics?.source).toBe('heuristic');
  });

  it('a name the classifier does NOT tag fails the same check (the control)', () => {
    // `date` is the right type and the wrong name. If this composed, the test
    // above would be proving nothing about the name.
    const model = applyClassification(
      parseDatabaseModel({
        dialect: 'postgres',
        name: 'fit',
        defaultSchema: 'main',
        schemas: ['main'],
        tables: [
          {
            schema: 'main',
            name: 'fit_probe',
            columns: [
              { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
              { name: 'title', logicalType: 'text' },
              { name: 'date', logicalType: 'timestamptz' },
            ],
            primaryKey: ['id'],
          },
        ],
      }),
    );
    expect(templateFit(model, 'main.fit_probe', 'page-calendar').satisfied).toBe(false);
  });

  it('a board whose status values are not kanban-shaped is refused (the value-level control)', () => {
    const model = applyClassification(
      parseDatabaseModel({
        dialect: 'postgres',
        name: 'fit',
        defaultSchema: 'main',
        schemas: ['main'],
        tables: [
          {
            schema: 'main',
            name: 'fit_probe',
            columns: [
              { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
              { name: 'title', logicalType: 'text' },
              { name: 'status', logicalType: 'enum', enumRef: 'main.fit_probe.status' },
            ],
            primaryKey: ['id'],
          },
        ],
        enums: [
          {
            id: 'main.fit_probe.status',
            name: 'status',
            values: ['bronze', 'silver', 'gold'],
            source: 'check',
          },
        ],
      }),
    );
    // Right type, right semantic, no board — which is why the descriptor seeds
    // values rather than only a column.
    const fit = templateFit(model, 'main.fit_probe', 'page-board');
    expect(fit.satisfied).toBe(false);
    expect(fit.unfilled.map((s) => s.slot)).toContain('board');
  });
});
