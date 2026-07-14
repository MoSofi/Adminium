import { readFileSync } from 'node:fs';

import type { DatabaseModel, TableModel } from '@adminium/engine';

export function loadFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

export function table(model: DatabaseModel, name: string): TableModel {
  const found = model.tables.find((t) => t.name === name);
  if (!found) {
    throw new Error(`table "${name}" not in model (has: ${model.tables.map((t) => t.name).join(', ')})`);
  }
  return found;
}

export function column(model: DatabaseModel, tableName: string, columnName: string) {
  const t = table(model, tableName);
  const col = t.columns.find((c) => c.name === columnName);
  if (!col) {
    throw new Error(
      `column "${columnName}" not on "${tableName}" (has: ${t.columns.map((c) => c.name).join(', ')})`,
    );
  }
  return col;
}

export function relationBetween(model: DatabaseModel, fromTable: string, toTable: string) {
  return model.relations.find(
    (r) => r.from.tableId === `public.${fromTable}` && r.to.tableId === `public.${toTable}`,
  );
}
