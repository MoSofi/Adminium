// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a page gets when the server runs a project with browser code
 * (49-developer-projects.md §6.3):
 *
 * - table cells drawn by the project's `cell` widgets, for any column whose
 *   spec names one (`widget: "project.flag-cell"`);
 * - the project's `card` widgets, for dashboard layout items that name one;
 * - the bridge the kit's `toast()` pushes through.
 *
 * Every page template is wrapped in {@link ProjectScope} when it loads
 * (`pages/templateLoaders.ts`), rather than the whole app shell: the tables and
 * dashboards that read these providers are all inside templates, and this
 * module stays out of the entry chunk (`scripts/check-entry-budget.mjs`). The
 * widgets themselves, and the code that loads them, are in `widgets.tsx`,
 * which loads the first time one is drawn. On a server with no project the
 * scope provides nothing, and a column that names a widget draws its value as
 * usual.
 */

import { useQuery } from '@tanstack/react-query';
import { Suspense, lazy, useMemo, type ComponentType, type ReactNode } from 'react';
import {
  CustomCellProvider,
  ExternalWidgetsProvider,
  defineWidget,
  widgetSharedConfigSchema,
  type CustomCellRenderer,
  type WidgetDefinition,
  type WidgetProps,
} from '@adminium/widgets';

import { bootstrapQuery } from '../app/bootstrap.js';
import type { PageTemplateComponent, PageTemplateProps } from '../pages/template-types.js';
import { projectOf, type ProjectClientWidget } from './bootstrapProject.js';
import { ProjectToastBridge } from './toastBridge.js';

const ProjectCell = lazy(async () => ({ default: (await import('./widgets.js')).ProjectCell }));

/** A card's `data` when its layout item has no binding (the frame would call `null` empty). */
export const NO_CARD_DATA: Readonly<Record<string, never>> = Object.freeze({});

const cardDefinitions = new Map<string, WidgetDefinition>();

/** One definition per built file, so a rebuild (a new URL) is a new widget. */
function cardDefinition(widget: ProjectClientWidget): WidgetDefinition {
  const cached = cardDefinitions.get(widget.module.url);
  if (cached !== undefined) return cached;
  const definition = defineWidget({
    id: widget.id,
    family: 'domain',
    component: lazy(async () => {
      const { ProjectCard } = await import('./widgets.js');
      return {
        default: function ProjectCardWidget(props: WidgetProps<Record<string, unknown>>) {
          return <ProjectCard widget={widget} config={props.config} data={props.data === NO_CARD_DATA ? null : props.data} />;
        },
      };
    }),
    configSchema: widgetSharedConfigSchema
      .extend(widget.title === null ? {} : { title: widgetSharedConfigSchema.shape.title.default(widget.title) })
      .loose(),
    dataContract: 'static',
    sizing: { minW: 2, minH: 2, defaultW: 4, defaultH: 4 },
    placement: 'grid',
    skeleton: 'card',
    demoData: () => NO_CARD_DATA,
    // Not read: `WidgetHost` shows no info popover for a host's own widget.
    descriptionKey: 'widgets.project.description',
  });
  cardDefinitions.set(widget.module.url, definition);
  return definition;
}

function plainValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function ProjectProviders({ widgets, children }: { widgets: readonly ProjectClientWidget[]; children: ReactNode }) {
  const byId = useMemo(() => new Map(widgets.map((widget) => [widget.id, widget])), [widgets]);

  const resolve = useMemo(
    () => (id: string) => {
      const widget = byId.get(id);
      return widget?.kind === 'card' ? cardDefinition(widget) : undefined;
    },
    [byId],
  );

  const renderCell = useMemo<CustomCellRenderer>(
    () => (column, row) => {
      const id = column.widget;
      if (id === undefined) return undefined;
      return (
        <Suspense fallback={<span className="truncate">{plainValue(row[column.name])}</span>}>
          <ProjectCell id={id} widget={byId.get(id) ?? null} column={column} row={row} />
        </Suspense>
      );
    },
    [byId],
  );

  return (
    <ExternalWidgetsProvider resolve={resolve}>
      <CustomCellProvider render={renderCell}>
        <ProjectToastBridge />
        {children}
      </CustomCellProvider>
    </ExternalWidgetsProvider>
  );
}

/** The project's cells, cards and toasts for everything below; nothing without a project. */
export function ProjectScope({ children }: { children: ReactNode }): ReactNode {
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const widgets = projectOf(bootstrap)?.client?.widgets;
  if (widgets === undefined) return children;
  return <ProjectProviders widgets={widgets}>{children}</ProjectProviders>;
}

const wrapped = new WeakMap<PageTemplateComponent, PageTemplateComponent>();

/** A template, rendered inside {@link ProjectScope}. One wrapper per template, so it never remounts. */
export function withProjectScope(Template: PageTemplateComponent): PageTemplateComponent {
  const existing = wrapped.get(Template);
  if (existing !== undefined) return existing;
  const Inner = Template as ComponentType<PageTemplateProps>;
  function ProjectScopedTemplate(props: PageTemplateProps) {
    return (
      <ProjectScope>
        <Inner {...props} />
      </ProjectScope>
    );
  }
  ProjectScopedTemplate.displayName = `ProjectScope(${Inner.displayName ?? Inner.name})`;
  wrapped.set(Template, ProjectScopedTemplate);
  return ProjectScopedTemplate;
}
