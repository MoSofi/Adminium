// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Relations tab for the selected table (05-introspection-engine.md §6):
 * declared FKs read-only, inferred relations with confidence + accept /
 * suppress (accept persists a `relation.add` op which re-enters future
 * regenerations at confidence 1.0; suppress persists `relation.remove`),
 * plus the ADD virtual relation form (07-meta-store.md §3.15 payload) for
 * schemas without declared FKs.
 */
import { useState } from 'react';
import { Badge, Button, Combobox, FormField, MonoText, Select } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import {
  relationsForTable,
  tableById,
  tableDisplayLabel,
  type EffectiveModel,
  type EffectiveRelation,
  type EffectiveTable,
} from './model.js';
import { RELATION_OP_CARDINALITIES, type RelationOpCardinality } from './overrides.js';
import { overrideKey, type RemapBuffer } from './useRemapBuffer.js';

export interface RelationsTabProps {
  model: EffectiveModel;
  table: EffectiveTable;
  buffer: RemapBuffer;
}

function endpointText(relation: EffectiveRelation): string {
  const from = `${relation.from.tableId}.${relation.from.columns.join('+')}`;
  const to = `${relation.to.tableId}.${relation.to.columns.join('+')}`;
  return `${from} → ${to}`;
}

/** relation.add cardinality from an inferred relation, FK-side perspective. */
function opCardinality(relation: EffectiveRelation): RelationOpCardinality {
  if (relation.cardinality === 'one-to-many') return 'many-to-one';
  return relation.cardinality;
}

export function RelationsTab({ model, table, buffer }: RelationsTabProps) {
  const { declared, inferred, overrides } = relationsForTable(model, table.id);

  const [fromColumn, setFromColumn] = useState<string | null>(null);
  const [toTable, setToTable] = useState<string | null>(null);
  const [toColumn, setToColumn] = useState<string | null>(null);
  const [cardinality, setCardinality] = useState<RelationOpCardinality>('many-to-one');

  const acceptKeyFor = (relation: EffectiveRelation) =>
    overrideKey({
      op: 'relation.add',
      tableName: relation.from.tableId,
      value: {
        fromColumn: relation.from.columns[0] ?? '',
        toTable: relation.to.tableId,
        toColumn: relation.to.columns[0] ?? '',
        cardinality: opCardinality(relation),
      },
    });
  const suppressKeyFor = (relation: EffectiveRelation) =>
    overrideKey({
      op: 'relation.remove',
      tableName: relation.from.tableId,
      value: { fromColumn: relation.from.columns[0] ?? '', toTable: relation.to.tableId },
    });

  const accept = (relation: EffectiveRelation) => {
    buffer.drop(suppressKeyFor(relation));
    buffer.stage({
      op: 'relation.add',
      tableName: relation.from.tableId,
      value: {
        fromColumn: relation.from.columns[0] ?? '',
        toTable: relation.to.tableId,
        toColumn: relation.to.columns[0] ?? '',
        cardinality: opCardinality(relation),
      },
    });
  };

  const suppress = (relation: EffectiveRelation) => {
    buffer.drop(acceptKeyFor(relation));
    buffer.stage({
      op: 'relation.remove',
      tableName: relation.from.tableId,
      value: { fromColumn: relation.from.columns[0] ?? '', toTable: relation.to.tableId },
    });
  };

  const targetTable = toTable === null ? undefined : tableById(model, toTable);
  const canAdd = fromColumn !== null && toTable !== null && toColumn !== null;

  return (
    <div className="flex flex-col gap-5" data-testid="relations-tab">
      <section className="flex flex-col gap-2">
        <h4 className="text-body-sm font-semibold text-fg">
          {t('studio.remap.relations.declared', 'Declared foreign keys')}
        </h4>
        {declared.length === 0 ? (
          <p className="text-body-sm text-fg-muted">
            {t('studio.remap.relations.noneDeclared', 'No declared foreign keys touch this table.')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {declared.map((relation) => (
              <li key={relation.id} className="flex items-center gap-2">
                <MonoText className="truncate text-[12px]">{endpointText(relation)}</MonoText>
                <Badge tone="info">{relation.cardinality}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h4 className="text-body-sm font-semibold text-fg">
          {t('studio.remap.relations.inferred', 'Inferred relations')}
        </h4>
        {inferred.length === 0 ? (
          <p className="text-body-sm text-fg-muted">
            {t('studio.remap.relations.noneInferred', 'Nothing inferred for this table.')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {inferred.map((relation) => {
              const accepted = buffer.get(acceptKeyFor(relation)) !== null;
              const suppressed = buffer.get(suppressKeyFor(relation)) !== null;
              return (
                <li key={relation.id} className="flex flex-wrap items-center gap-2">
                  <MonoText className="truncate text-[12px]">{endpointText(relation)}</MonoText>
                  <Badge tone="accent">
                    {t('studio.remap.relations.confidence', 'inferred · {pct}%', { pct: String(Math.round(relation.confidence * 100)), })}
                  </Badge>
                  {accepted ? <Badge tone="pos">{t('studio.remap.relations.accepted', 'Accepted')}</Badge> : null}
                  {suppressed ? (
                    <Badge tone="danger">{t('studio.remap.relations.suppressed', 'Suppressed')}</Badge>
                  ) : null}
                  <span className="ms-auto flex items-center gap-1">
                    <Button size="sm" variant="secondary" disabled={accepted} onClick={() => accept(relation)}>
                      {t('studio.remap.relations.accept', 'Accept')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={suppressed} onClick={() => suppress(relation)}>
                      {t('studio.remap.relations.suppress', 'Suppress')}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {overrides.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h4 className="text-body-sm font-semibold text-fg">
            {t('studio.remap.relations.overrides', 'Override relations (applied)')}
          </h4>
          <ul className="flex flex-col gap-1.5">
            {overrides.map((relation) => (
              <li key={relation.id} className="flex items-center gap-2">
                <MonoText className="truncate text-[12px]">{endpointText(relation)}</MonoText>
                <Badge tone="pos">{t('studio.remap.relations.overrideBadge', 'override')}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h4 className="text-body-sm font-semibold text-fg">
          {t('studio.remap.relations.add', 'Add virtual relation')}
        </h4>
        <FormField label={t('studio.remap.relations.fromColumn', 'From column')}>
          <Combobox
            mono
            options={table.columns.map((column) => ({ value: column.name, label: column.name }))}
            value={fromColumn}
            onValueChange={setFromColumn}
            emptyText={t('studio.remap.relations.noColumns', 'No matching column')}
            placeholder={t('studio.remap.relations.fromPlaceholder', 'customer_id')}
          />
        </FormField>
        <FormField label={t('studio.remap.relations.toTable', 'To table')}>
          <Combobox
            mono
            options={model.tables.map((candidate) => ({
              value: candidate.id,
              label: candidate.id,
              description: tableDisplayLabel(candidate),
            }))}
            value={toTable}
            onValueChange={(next) => {
              setToTable(next);
              setToColumn(null);
            }}
            emptyText={t('studio.remap.relations.noTables', 'No matching table')}
            placeholder="public.customers"
          />
        </FormField>
        <FormField label={t('studio.remap.relations.toColumn', 'To column')}>
          <Combobox
            mono
            options={(targetTable?.columns ?? []).map((column) => ({ value: column.name, label: column.name }))}
            value={toColumn}
            onValueChange={setToColumn}
            disabled={targetTable === undefined}
            emptyText={t('studio.remap.relations.noColumns', 'No matching column')}
            placeholder="id"
          />
        </FormField>
        <FormField label={t('studio.remap.relations.cardinality', 'Cardinality')}>
          <Select value={cardinality} onChange={(event) => setCardinality(event.target.value as RelationOpCardinality)}>
            {RELATION_OP_CARDINALITIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </FormField>
        <div>
          <Button
            variant="secondary"
            disabled={!canAdd}
            onClick={() => {
              if (!canAdd) return;
              buffer.stage({
                op: 'relation.add',
                tableName: table.id,
                value: {
                  fromColumn: fromColumn as string,
                  toTable: toTable as string,
                  toColumn: toColumn as string,
                  cardinality,
                },
              });
              setFromColumn(null);
              setToTable(null);
              setToColumn(null);
            }}
          >
            {t('studio.remap.relations.addButton', 'Add relation')}
          </Button>
        </div>
      </section>
    </div>
  );
}
