// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Review value-view rendering (06-llm-assist.md §10.3). Two things are pinned
 * here.
 *
 * The RTL-correctness of the relation direction arrow (acceptance #14
 * "RTL-correct in ar_EG"): the literal U+2192 is not a bidi-mirrored glyph, so
 * it must carry `rtl:-scale-x-100` to keep pointing from→to after the flex row
 * reverses under RTL.
 *
 * And the defensive narrowing every reader does. `llmValue`/`heuristicValue`
 * arrive as `unknown` — they are whatever the model returned, projected by
 * `@adminium/llm` `apply/diff.ts` — so each renderer's job is as much "degrade
 * to a readable fallback" as it is "draw the happy path". The malformed cases
 * below are the ones a chattier model actually produces: a scalar where an
 * object was expected, a half-filled record, an enum whose tone vocabulary
 * grew. None of them may crash the reviewer.
 *
 * No i18n instance is booted, so `t(key, fallback)` renders the fallback text —
 * which is what the assertions read.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  DiffValue,
  LocalizedField,
  RelationChips,
  WidgetPreview,
  hasLocalizedDetail,
  localizedFieldsOf,
  primaryText,
} from './valueViews.js';

describe('RelationChips — RTL arrow', () => {
  it('flips the → glyph under RTL', () => {
    const { container } = render(
      <RelationChips
        value={{
          fromTable: 'public.orders',
          fromColumns: ['product_id'],
          toTable: 'public.products',
          toColumns: ['id'],
          kind: 'many-to-one',
        }}
      />,
    );
    const arrow = [...container.querySelectorAll('span')].find((el) => el.textContent === '→');
    expect(arrow, 'the relation arrow span').toBeTruthy();
    expect(arrow?.className).toContain('rtl:-scale-x-100');
  });

  it('strips the schema and joins composite columns', () => {
    render(
      <RelationChips
        value={{
          fromTable: 'public.order_items',
          fromColumns: ['order_id', 'line_no'],
          toTable: 'analytics.lines',
          toColumns: ['order_id', 'line_no'],
        }}
      />,
    );
    expect(screen.getByText('order_items.order_id, line_no')).toBeTruthy();
    expect(screen.getByText('lines.order_id, line_no')).toBeTruthy();
  });

  it('degrades to a placeholder when the projection is not an object', () => {
    render(<RelationChips value="orders → products" />);
    expect(screen.getByText('No value')).toBeTruthy();
  });
});

describe('primaryText', () => {
  it('prefers en_US over whatever the model listed first', () => {
    expect(primaryText({ de_DE: 'Bestellungen', en_US: 'Orders' })).toBe('Orders');
  });

  it('falls back to the first locale when en_US is absent', () => {
    expect(primaryText({ de_DE: 'Bestellungen', fr_FR: 'Commandes' })).toBe('Bestellungen');
  });

  it('rejects anything that is not a flat string map', () => {
    expect(primaryText(null)).toBeNull();
    expect(primaryText('Orders')).toBeNull();
    // A nested bundle — the shape `label: { en_US: … }` has when it was not
    // unwrapped one level by the caller.
    expect(primaryText({ label: { en_US: 'Orders' } })).toBeNull();
  });

  it('is null for an empty bundle', () => {
    expect(primaryText({})).toBeNull();
  });
});

describe('hasLocalizedDetail', () => {
  it('is true only for the categories whose values carry per-locale text', () => {
    expect(hasLocalizedDetail('label')).toBe(true);
    expect(hasLocalizedDetail('group')).toBe(true);
    expect(hasLocalizedDetail('copy')).toBe(true);
    expect(hasLocalizedDetail('key')).toBe(false);
    expect(hasLocalizedDetail('enum')).toBe(false);
    expect(hasLocalizedDetail('widget')).toBe(false);
  });
});

describe('LocalizedField', () => {
  it('orders locales canonically, not by key order, with unknown locales last', () => {
    const { container } = render(
      <LocalizedField
        label="Label"
        value={{ zz_ZZ: 'Zzz', ar_EG: 'طلبات', en_US: 'Orders', de_DE: 'Bestellungen' }}
      />,
    );
    const locales = [...container.querySelectorAll('li')].map(
      (row) => row.querySelector('span, code, kbd')?.textContent ?? row.textContent,
    );
    expect([...container.querySelectorAll('li')].map((row) => row.firstElementChild?.textContent)).toEqual([
      'en_US',
      'de_DE',
      'ar_EG',
      'zz_ZZ',
    ]);
    expect(locales.length).toBe(4);
  });

  it('marks each row `dir="auto"` so an RTL string lays out on its own direction', () => {
    const { container } = render(<LocalizedField label="Label" value={{ ar_EG: 'طلبات' }} />);
    const text = container.querySelector('li span[dir="auto"]');
    expect(text?.textContent).toBe('طلبات');
  });

  it('renders nothing for a non-bundle or an empty bundle', () => {
    const notABundle = render(<LocalizedField label="Label" value={{ label: { en_US: 'x' } }} />);
    expect(notABundle.container.firstChild).toBeNull();
    const empty = render(<LocalizedField label="Label" value={{}} />);
    expect(empty.container.textContent).toBe('');
  });
});

describe('DiffValue — absent and unknown', () => {
  it('renders the absent placeholder when one side of the diff has no value', () => {
    render(<DiffValue category="label" value={undefined} />);
    expect(screen.getByText('None')).toBeTruthy();
  });

  it('falls back for a category it has no renderer for', () => {
    // A category the model invented, or one `diff.ts` grew after this file.
    render(<DiffValue category="tenure" value={{ anything: 1 }} />);
    expect(screen.getByText('No value')).toBeTruthy();
  });
});

describe('DiffValue — label', () => {
  it('draws the icon glyph beside the primary label', () => {
    const { container } = render(
      <DiffValue category="label" value={{ label: { en_US: 'Orders', de_DE: 'Bestellungen' }, icon: 'box' }} />,
    );
    expect(screen.getByText('Orders')).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('draws no glyph when the suggestion carries no icon', () => {
    const { container } = render(<DiffValue category="label" value={{ label: { en_US: 'Orders' } }} />);
    expect(screen.getByText('Orders')).toBeTruthy();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('falls back when neither a label nor an icon survived narrowing', () => {
    render(<DiffValue category="label" value={{ label: 42 }} />);
    expect(screen.getByText('No value')).toBeTruthy();
  });

  it('shows the icon alone when only the icon changed', () => {
    const { container } = render(<DiffValue category="label" value={{ icon: 'box' }} />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.getByText('No value')).toBeTruthy();
  });
});

describe('DiffValue — key', () => {
  it('labels the display column and every natural-key column', () => {
    render(
      <DiffValue
        category="key"
        value={{ displayColumn: 'email', naturalKey: ['tenant_id', 'email'] }}
      />,
    );
    expect(screen.getByText('Display')).toBeTruthy();
    expect(screen.getByText('Key')).toBeTruthy();
    expect(screen.getByText('tenant_id')).toBeTruthy();
    // The display column is also part of the composite key here, so it is
    // chipped twice — once per role, not deduplicated across them.
    expect(screen.getAllByText('email')).toHaveLength(2);
  });

  it('dashes the halves the suggestion left empty', () => {
    render(<DiffValue category="key" value={{ naturalKey: [] }} />);
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('drops non-string entries from the natural key rather than rendering them', () => {
    render(<DiffValue category="key" value={{ displayColumn: 'name', naturalKey: ['sku', 7, null] }} />);
    expect(screen.getByText('sku')).toBeTruthy();
    expect(screen.queryByText('7')).toBeNull();
  });

  it('falls back for a scalar value', () => {
    render(<DiffValue category="key" value="email" />);
    expect(screen.getByText('No value')).toBeTruthy();
  });
});

describe('DiffValue — enum', () => {
  it('maps the llm tone vocabulary onto the badge tones and dots the terminal states', () => {
    const { container } = render(
      <DiffValue
        category="enum"
        value={{
          kind: 'workflow',
          order: ['open', 'paid', 'cancelled'],
          tones: { open: 'accent', paid: 'pos', cancelled: 'danger' },
          terminal: ['paid', 'cancelled'],
        }}
      />,
    );
    expect(screen.getByText('Workflow').getAttribute('data-tone')).toBe('accent');
    expect(screen.getByText('open').getAttribute('data-tone')).toBe('accent');
    expect(screen.getByText('paid').getAttribute('data-tone')).toBe('pos');
    expect(screen.getByText('cancelled').getAttribute('data-tone')).toBe('danger');
    // `dot` is what marks a terminal state; only the two terminal badges get one.
    const dotted = [...container.querySelectorAll('span[data-tone]')].filter(
      (badge) => badge.querySelector('span[aria-hidden="true"].bg-current') !== null,
    );
    expect(dotted.map((badge) => badge.textContent)).toEqual(['paid', 'cancelled']);
  });

  it('renders `muted` as the neutral tone and an unknown tone word as neutral too', () => {
    render(
      <DiffValue
        category="enum"
        value={{ kind: 'category', order: ['a', 'b'], tones: { a: 'muted', b: 'chartreuse' } }}
      />,
    );
    expect(screen.getByText('Category').getAttribute('data-tone')).toBe('neutral');
    expect(screen.getByText('a').getAttribute('data-tone')).toBe('neutral');
    expect(screen.getByText('b').getAttribute('data-tone')).toBe('neutral');
  });

  it('falls back to the tone keys when the suggestion carries no explicit order', () => {
    render(<DiffValue category="enum" value={{ tones: { draft: 'warn', live: 'pos' } }} />);
    expect(screen.getByText('draft').getAttribute('data-tone')).toBe('warn');
    expect(screen.getByText('live').getAttribute('data-tone')).toBe('pos');
    // No `kind` ⇒ no leading Workflow/Category badge.
    expect(screen.queryByText('Workflow')).toBeNull();
    expect(screen.queryByText('Category')).toBeNull();
  });

  it('renders an enum with neither order nor tones as just its kind', () => {
    const { container } = render(<DiffValue category="enum" value={{ kind: 'workflow' }} />);
    expect(container.querySelectorAll('span[data-tone]')).toHaveLength(1);
  });

  it('falls back for a scalar value', () => {
    render(<DiffValue category="enum" value={['open', 'paid']} />);
    expect(screen.getByText('No value')).toBeTruthy();
  });
});

describe('DiffValue — pii', () => {
  it('reads an explicit null as "this column is not PII"', () => {
    // `null` is the meaningful value here — the LLM clearing a heuristic PII
    // classification — so it must not share the "no value" placeholder.
    render(<DiffValue category="pii" value={null} />);
    expect(screen.getByText('Not PII')).toBeTruthy();
  });

  it('shows the kind and its masking rule', () => {
    render(<DiffValue category="pii" value={{ kind: 'email', masking: 'partial' }} />);
    expect(screen.getByText('email').getAttribute('data-tone')).toBe('warn');
    expect(screen.getByText('partial').getAttribute('data-tone')).toBe('warn');
  });

  it('renders a kind with no masking rule', () => {
    const { container } = render(<DiffValue category="pii" value={{ kind: 'phone' }} />);
    expect(screen.getByText('phone')).toBeTruthy();
    expect(container.querySelectorAll('span[data-tone]')).toHaveLength(1);
  });

  it('falls back for a scalar value', () => {
    render(<DiffValue category="pii" value="email" />);
    expect(screen.getByText('No value')).toBeTruthy();
  });
});

describe('DiffValue — template', () => {
  it('shows the template name and its rank', () => {
    render(<DiffValue category="template" value={{ template: 'crud-table', rank: 2 }} />);
    expect(screen.getByText('crud-table').getAttribute('data-tone')).toBe('accent');
    expect(screen.getByText('rank 2')).toBeTruthy();
  });

  it('omits the rank when the suggestion carries none', () => {
    render(<DiffValue category="template" value={{ template: 'crud-table' }} />);
    expect(screen.queryByText(/rank/)).toBeNull();
  });

  it('falls back for a scalar value', () => {
    render(<DiffValue category="template" value="crud-table" />);
    expect(screen.getByText('No value')).toBeTruthy();
  });
});

describe('DiffValue — group', () => {
  it('shows the label, its glyph and the table count', () => {
    const { container } = render(
      <DiffValue
        category="group"
        value={{ label: { en_US: 'Commerce' }, icon: 'box', tables: ['public.orders', 'public.products'] }}
      />,
    );
    expect(screen.getByText('Commerce')).toBeTruthy();
    expect(screen.getByText('2 tables')).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('counts zero tables rather than hiding the count', () => {
    render(<DiffValue category="group" value={{ label: { en_US: 'Commerce' } }} />);
    expect(screen.getByText('0 tables')).toBeTruthy();
  });

  it('falls back for a scalar value', () => {
    render(<DiffValue category="group" value="Commerce" />);
    expect(screen.getByText('No value')).toBeTruthy();
  });
});

describe('DiffValue — dashboard', () => {
  it('prefers the localized label over the domain key', () => {
    render(
      <DiffValue
        category="dashboard"
        value={{ label: { en_US: 'Sales overview' }, domain: 'sales', widgets: [{}, {}, {}] }}
      />,
    );
    expect(screen.getByText('Sales overview')).toBeTruthy();
    expect(screen.getByText('3 widgets')).toBeTruthy();
  });

  it('falls back to the domain key when no label was suggested', () => {
    render(<DiffValue category="dashboard" value={{ domain: 'sales', widgets: [] }} />);
    expect(screen.getByText('sales')).toBeTruthy();
    expect(screen.getByText('0 widgets')).toBeTruthy();
  });

  it('falls back again when the dashboard has neither', () => {
    render(<DiffValue category="dashboard" value={{ widgets: 'lots' }} />);
    expect(screen.getByText('No value')).toBeTruthy();
    // A non-array `widgets` counts as none rather than throwing.
    expect(screen.getByText('0 widgets')).toBeTruthy();
  });

  it('falls back for a scalar value', () => {
    render(<DiffValue category="dashboard" value={7} />);
    expect(screen.getByText('No value')).toBeTruthy();
  });
});

describe('DiffValue — widget', () => {
  it('composes the binding preview from the aggregation and the metric column', () => {
    render(
      <DiffValue
        category="widget"
        value={{
          widget: 'kpi-stat-card',
          span: 4,
          table: 'public.orders',
          metricColumn: 'total',
          agg: 'sum',
        }}
      />,
    );
    expect(screen.getByText('kpi-stat-card')).toBeTruthy();
    expect(screen.getByText('span 4')).toBeTruthy();
    expect(screen.getByText('orders · sum · total')).toBeTruthy();
  });

  it('prefers the dimension column, then the time column, when there is no metric', () => {
    const dimension = render(
      <WidgetPreview value={{ table: 'public.orders', agg: 'count', dimensionColumn: 'status' }} />,
    );
    expect(dimension.getByText('orders · count · status')).toBeTruthy();

    const time = render(<WidgetPreview value={{ table: 'public.orders', timeColumn: 'created_at' }} />);
    expect(time.getByText('orders · created_at')).toBeTruthy();
  });

  it('renders the table alone when no binding columns were suggested', () => {
    render(<WidgetPreview value={{ widget: 'data-grid', table: 'orders' }} />);
    expect(screen.getByText('orders')).toBeTruthy();
  });

  it('omits the source line entirely when there is no table', () => {
    render(<WidgetPreview value={{ widget: 'data-grid', span: 12 }} />);
    expect(screen.getByText('data-grid')).toBeTruthy();
    expect(screen.getByText('span 12')).toBeTruthy();
  });

  it('falls back for a scalar value', () => {
    render(<WidgetPreview value="kpi-stat-card" />);
    expect(screen.getByText('No value')).toBeTruthy();
  });
});

describe('DiffValue — copy', () => {
  it('renders the page subtitle', () => {
    render(<DiffValue category="copy" value={{ pageSubtitle: { en_US: 'Every order, newest first' } }} />);
    expect(screen.getByText('Every order, newest first')).toBeTruthy();
  });

  it('falls back when the copy bundle carries no subtitle', () => {
    render(<DiffValue category="copy" value={{ emptyState: { headline: { en_US: 'No orders yet' } } }} />);
    expect(screen.getByText('No value')).toBeTruthy();
  });

  it('falls back for a scalar value', () => {
    render(<DiffValue category="copy" value="Every order" />);
    expect(screen.getByText('No value')).toBeTruthy();
  });
});

describe('localizedFieldsOf', () => {
  it('expands label and description for a label suggestion, in display order', () => {
    const fields = localizedFieldsOf('label', {
      description: { en_US: 'Customer orders' },
      label: { en_US: 'Orders', de_DE: 'Bestellungen' },
    });
    expect(fields.map((field) => field.key)).toEqual(['label', 'description']);
    expect(fields[0]?.label).toBe('Label');
    expect(fields[1]?.label).toBe('Description');
    expect(fields[0]?.value).toEqual({ en_US: 'Orders', de_DE: 'Bestellungen' });
  });

  it('expands the same pair for a group suggestion', () => {
    expect(localizedFieldsOf('group', { label: { en_US: 'Commerce' } }).map((f) => f.key)).toEqual(['label']);
  });

  it('skips fields whose value is not a locale bundle', () => {
    // `label: 'Orders'` — a model that answered with a bare string.
    expect(localizedFieldsOf('label', { label: 'Orders', description: { en_US: 'x' } }).map((f) => f.key)).toEqual([
      'description',
    ]);
  });

  it('expands the subtitle and both empty-state strings for a copy suggestion', () => {
    const fields = localizedFieldsOf('copy', {
      pageSubtitle: { en_US: 'Every order, newest first' },
      emptyState: { headline: { en_US: 'No orders yet' }, guidance: { en_US: 'Import a CSV to start' } },
    });
    expect(fields.map((field) => field.key)).toEqual(['pageSubtitle', 'headline', 'guidance']);
    expect(fields.map((field) => field.label)).toEqual([
      'Page subtitle',
      'Empty-state headline',
      'Empty-state guidance',
    ]);
  });

  it('handles a copy suggestion with no empty state, and one whose empty state is a scalar', () => {
    expect(localizedFieldsOf('copy', { pageSubtitle: { en_US: 'x' } }).map((f) => f.key)).toEqual(['pageSubtitle']);
    expect(localizedFieldsOf('copy', { pageSubtitle: { en_US: 'x' }, emptyState: 'none' }).map((f) => f.key)).toEqual([
      'pageSubtitle',
    ]);
  });

  it('expands nothing for the categories with no localized text, or a scalar value', () => {
    expect(localizedFieldsOf('key', { displayColumn: 'email' })).toEqual([]);
    expect(localizedFieldsOf('label', 'Orders')).toEqual([]);
    expect(localizedFieldsOf('label', null)).toEqual([]);
  });
});
