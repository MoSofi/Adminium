// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The UI kit's larger parts: `TextArea`, and three that are code of their
 * own — `Board`, `ImportWizard` and `MapView`.
 *
 * Each of the three is loaded when it is first drawn, through a dynamic
 * `import()`: a project page that uses none of them pays for none of them.
 * What shows meanwhile is the place the part will take, never a spinner over
 * the whole page. A part that cannot be loaded says so in its place and
 * leaves the rest of the page as it is.
 */

import { Component, Suspense, lazy, type ReactElement, type ReactNode } from 'react';
import { FormField, Skeleton, Textarea as UiTextarea } from '@adminium/ui';
import type { BoardProps, ImportWizardProps, MapViewProps, TextAreaProps } from '@adminium/server/ui';

import { MentionTextarea } from '@adminium/widgets/mentions';

import { t } from '../../i18n/t.js';

export function TextArea({ label, hint, error, autoResize = false, rows = 3, mentions = false, onValueChange, ...props }: TextAreaProps): ReactNode {
  const invalid = error !== undefined && error !== null && error !== false;
  const { value, defaultValue: _defaultValue, onChange: _onChange, ...box } = props;
  const control: ReactElement = mentions ? (
    <MentionTextarea {...box} rows={rows} autoResize={autoResize} error={invalid} value={typeof value === 'string' ? value : ''} onChange={(stored) => onValueChange?.(stored)} />
  ) : (
    <UiTextarea {...props} rows={rows} autoResize={autoResize} error={invalid} className="w-full" />
  );
  if (label === undefined) return control;
  return (
    <FormField label={label} helper={hint} error={error}>
      {control}
    </FormField>
  );
}

const BoardPart = lazy(() => import('./board-part.js'));
const ImportPart = lazy(() => import('./import-part.js'));
const MapPart = lazy(() => import('./map-part.js'));

/** A part whose code did not arrive: said in its place, with the rest of the page left alone. */
class PartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <p role="alert" className="rounded-[10px] border border-border bg-surface px-3 py-2.5 text-body-sm text-fg-muted">
        {t('project:kit.partFailed', 'This part of the page could not be loaded. Reload the page to try again.')}
      </p>
    );
  }
}

function part(height: string, children: ReactNode): ReactNode {
  return (
    <PartBoundary>
      <Suspense fallback={<Skeleton className={`w-full rounded-[10px] ${height}`} />}>{children}</Suspense>
    </PartBoundary>
  );
}

export function Board(props: BoardProps): ReactNode {
  return part('h-64', <BoardPart {...props} />);
}

export function ImportWizard(props: ImportWizardProps): ReactNode {
  return part('h-80', <ImportPart {...props} />);
}

export function MapView(props: MapViewProps): ReactNode {
  return part('h-80', <MapPart {...props} />);
}
