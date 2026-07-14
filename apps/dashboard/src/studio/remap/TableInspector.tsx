/**
 * Right-pane inspector for a selected table: label override, icon picker,
 * nav group (read-only — see note below), include/exclude toggle, and the
 * read-only table-shape classification (05-introspection-engine.md §8).
 *
 * Nav group: the v1 override vocabulary (07-meta-store.md §3.15) has no
 * `table.navGroup` op — nav placement is generator-owned — so the select is
 * rendered disabled with an explanatory caption instead of staging an op the
 * server would 422.
 */
import { Badge, FormField, Input, KeyValueList, MonoText, Select, Switch, Tag } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { IconPicker } from './IconPicker.js';
import { tableDisplayLabel, titleCase, type EffectiveTable } from './model.js';
import { overrideKey, type RemapBuffer } from './useRemapBuffer.js';

const NAV_GROUPS = ['workspace', 'library', 'planning', 'people', 'account'] as const;

export interface TableInspectorProps {
  table: EffectiveTable;
  buffer: RemapBuffer;
  /** Field-level 422 message keyed to this table, if the last save failed here. */
  fieldError?: string | undefined;
}

export function TableInspector({ table, buffer, fieldError }: TableInspectorProps) {
  const labelKey = overrideKey({ op: 'table.label', tableName: table.id, value: { label: '' } });
  const excludeKey = overrideKey({ op: 'table.exclude', tableName: table.id, value: { excluded: true } });

  const labelEntry = buffer.get(labelKey);
  const staged =
    labelEntry !== null && labelEntry.item.op === 'table.label' ? labelEntry.item.value : null;
  const stagedLabel = staged?.label ?? '';
  const stagedIcon = staged?.icon ?? null;

  const excludeEntry = buffer.get(excludeKey);
  const excluded =
    excludeEntry !== null && excludeEntry.item.op === 'table.exclude'
      ? excludeEntry.item.value.excluded
      : table.excluded === true;

  /** `table.label` requires `label`; icon-only edits reuse the display label. */
  const stageLabelOp = (nextLabel: string, nextIcon: string | null) => {
    if (nextLabel === '' && nextIcon === null) {
      buffer.drop(labelKey);
      return;
    }
    buffer.stage({
      op: 'table.label',
      tableName: table.id,
      value: {
        label: nextLabel === '' ? tableDisplayLabel(table) : nextLabel,
        ...(nextIcon === null ? {} : { icon: nextIcon }),
      },
    });
  };

  const semantics = table.semantics;

  return (
    <div className="flex flex-col gap-5" data-testid="table-inspector">
      <header className="flex items-center gap-2">
        <h3 className="text-section text-fg">{tableDisplayLabel(table)}</h3>
        <MonoText className="text-[11px] text-fg-subtle">{table.id}</MonoText>
        {table.system ? <Badge tone="neutral">{t('studio.remap.table.system', 'System')}</Badge> : null}
      </header>

      <FormField
        label={t('studio.remap.table.labelOverride', 'Display label')}
        helper={t('studio.remap.table.labelHelper', 'Inferred: {name}').replace(
          '{name}',
          titleCase(table.name),
        )}
        {...(fieldError === undefined ? {} : { error: fieldError })}
      >
        <Input
          value={stagedLabel !== '' ? stagedLabel : (table.label ?? '')}
          placeholder={titleCase(table.name)}
          onChange={(event) => stageLabelOp(event.target.value, stagedIcon ?? table.icon ?? null)}
        />
      </FormField>

      <div className="flex flex-col gap-1.5">
        <span className="text-body-sm font-medium text-fg">{t('studio.remap.table.icon', 'Icon')}</span>
        <IconPicker
          value={stagedIcon ?? table.icon ?? null}
          onChange={(icon) => stageLabelOp(stagedLabel !== '' ? stagedLabel : (table.label ?? ''), icon)}
        />
      </div>

      <FormField
        label={t('studio.remap.table.navGroup', 'Nav group')}
        helper={t(
          'studio.remap.table.navGroupHelper',
          'Nav placement is decided by the generator — a table.navGroup override is not in the v1 vocabulary.',
        )}
      >
        <Select disabled defaultValue="workspace">
          {NAV_GROUPS.map((group) => (
            <option key={group} value={group}>
              {titleCase(group)}
            </option>
          ))}
        </Select>
      </FormField>

      <label className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-body-sm font-medium text-fg">
            {t('studio.remap.table.include', 'Include in generated app')}
          </span>
          <span className="text-[11.5px] text-fg-muted">
            {t('studio.remap.table.includeHelper', 'Excluded tables get no pages and disappear from nav.')}
          </span>
        </span>
        <Switch
          checked={!excluded}
          aria-label={t('studio.remap.table.include', 'Include in generated app')}
          onCheckedChange={(checked) => {
            if (checked) buffer.drop(excludeKey);
            else buffer.stage({ op: 'table.exclude', tableName: table.id, value: { excluded: true } });
          }}
        />
      </label>

      <section className="flex flex-col gap-2">
        <h4 className="text-body-sm font-semibold text-fg">
          {t('studio.remap.table.shape', 'Table shape (classified)')}
        </h4>
        <KeyValueList
          items={[
            {
              label: t('studio.remap.table.role', 'Role'),
              value: semantics === null ? t('studio.remap.table.unclassified', 'Not classified') : semantics.role,
            },
            {
              label: t('studio.remap.table.kind', 'Kind'),
              value: table.kind,
            },
            {
              label: t('studio.remap.table.hierarchy', 'Hierarchy'),
              value:
                semantics?.hierarchy == null
                  ? '—'
                  : t('studio.remap.table.selfFk', 'Self-reference via {column}').replace(
                      '{column}',
                      semantics.hierarchy.parentColumn,
                    ),
            },
            {
              label: t('studio.remap.table.polymorphic', 'Polymorphic pairs'),
              value:
                semantics === null || semantics.polymorphic.length === 0
                  ? '—'
                  : semantics.polymorphic.map((p) => `${p.typeColumn}/${p.idColumn}`).join(', '),
            },
            {
              label: t('studio.remap.table.rows', 'Row estimate'),
              value: table.rowCountEstimate === null ? '—' : String(table.rowCountEstimate),
            },
          ]}
        />
        <p className="text-[11.5px] text-fg-muted">
          {t(
            'studio.remap.table.shapeHelper',
            'Classification is recomputed on every introspection; overrides layer on top and survive regeneration.',
          )}
        </p>
        {semantics !== null ? <Tag mono>{semantics.role}</Tag> : null}
      </section>
    </div>
  );
}
