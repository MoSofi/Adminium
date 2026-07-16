import { EmptyState } from '@adminium/ui';

/**
 * TRACK OPS — the per-widget empty body shared by the eighteen §13 ops cards.
 *
 * WHY A WIDGET RENDERS AN EMPTY STATE AT ALL, given WidgetFrame already has one
 * (04 §4): the frame's empty state fires when `isEmptyData(payload, contract)`
 * says the whole payload is empty. A widget still reaches its own render for the
 * cases the shared predicate cannot see — a `record` payload whose row is
 * present but unusable, a `['record', 'static']` widget whose contract makes it
 * *never* frame-empty by design (a config-only instance is legitimate, so the
 * frame must not swallow it), a list that filtered down to nothing. This is the
 * body for those. Every caller passes copy that came from its own config, so the
 * strings stay host-translated (the family convention) rather than hardcoded
 * here.
 */
export interface OpsEmptyProps {
  title: string;
  body?: string | undefined;
  testId?: string | undefined;
}

export function OpsEmpty({ title, body, testId }: OpsEmptyProps) {
  return (
    <EmptyState
      compact
      preset="no-data"
      data-testid={testId}
      title={title}
      {...(body === undefined ? {} : { body })}
    />
  );
}
