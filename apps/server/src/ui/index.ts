// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@adminiumjs/adminium/ui`: what a project's `pages/*.tsx` and
 * `widgets/*.tsx` import.
 *
 * This file is public API, so it stays small, and every change to it goes in
 * the release notes. It has two halves:
 *
 * - `definePage` and `defineWidget`, plain functions that return what they
 *   are given, typed so an editor can check a page's settings;
 * - the UI kit: components and hooks the dashboard provides. They are not
 *   implemented here. The dashboard publishes them on the host runtime global
 *   (`@adminium/add-on-contracts/runtime`) before it loads a project bundle,
 *   and this module hands them out. So a page renders with the dashboard's own
 *   React and components, and a bundle carries none of them.
 *
 * `adminium build` bundles this module into each page and widget. Imported
 * anywhere else (a unit test, say), the helpers work, and a kit component or
 * hook throws when it is used, saying that only the dashboard provides it.
 */

import type {
  ChangeEventHandler,
  ComponentType,
  InputHTMLAttributes,
  MouseEventHandler,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { hasAddOnRuntime, requireAddOnRuntime, type ProjectUiExport } from '@adminium/add-on-contracts/runtime';

// ─── Pages and widgets ──────────────────────────────────────────────────────

/** The sidebar groups a page can sit in. */
export type NavGroup = 'workspace' | 'library' | 'planning' | 'people' | 'account';

export interface PageDefinition {
  /** The page's name, in the sidebar and the top bar. */
  title: string;
  /** A Lucide icon name in kebab-case, such as `chart-line`. Default `file`. */
  icon?: string;
  /**
   * Where the page sits in the sidebar. The default is the end of the
   * workspace group. `hidden` leaves it out of the sidebar; its URL,
   * `/p/<file name>`, still opens it.
   */
  nav?: { group?: NavGroup; order?: number; hidden?: boolean };
  /** The page body. The top bar and the page's margins come from the dashboard. */
  component: ComponentType<PageComponentProps>;
}

export interface PageComponentProps {
  /** The page's address: its file name. */
  slug: string;
}

/** A table cell: `{ "name": "flagged", …, "widget": "project.flag-cell" }` in a page file. */
export interface CellWidgetDefinition<V = unknown> {
  kind: 'cell';
  component: ComponentType<CellWidgetProps<V>>;
}

// A project's rows are untyped unless the project types them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRecord = Record<string, any>;

export interface CellWidgetProps<V = unknown> {
  /** This cell's value. */
  value: V;
  /** The whole row. */
  record: AnyRecord;
  column: { name: string; label: string };
}

/** A dashboard card: `{ "widget": "project.sales-card", … }` in a dashboard's layout. */
export interface CardWidgetDefinition {
  kind: 'card';
  /** Shown above the card when its layout item sets no `title`. */
  title?: string;
  component: ComponentType<CardWidgetProps>;
}

export interface CardWidgetProps {
  /** The layout item's `config`, as the page file has it. */
  config: AnyRecord;
  /** The rows of the item's `config.binding`, when it has one. */
  data: unknown;
}

export type WidgetDefinition = CellWidgetDefinition | CardWidgetDefinition;

/** `export default definePage({ … })` in `pages/<slug>.tsx`. */
export function definePage(definition: PageDefinition): PageDefinition {
  return definition;
}

/** `export default defineWidget({ … })` in `widgets/<name>.tsx`; its id is `project.<name>`. */
export function defineWidget<V = unknown>(definition: CellWidgetDefinition<V>): CellWidgetDefinition<V>;
export function defineWidget(definition: CardWidgetDefinition): CardWidgetDefinition;
export function defineWidget(definition: WidgetDefinition): WidgetDefinition {
  return definition;
}

// ─── Layout ─────────────────────────────────────────────────────────────────

export type Space = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface PageProps {
  /** Replaces the page's title in the top bar. */
  title?: string;
  /** A line under the title in the top bar. */
  description?: string;
  /** Buttons for the top bar's right side. */
  actions?: ReactNode;
  children?: ReactNode;
}

export interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Controls at the end of the card's header. */
  actions?: ReactNode;
  /** Default true. False lets a table or a chart reach the card's edges. */
  padded?: boolean;
  children?: ReactNode;
}

export interface StackProps {
  /** Default `column`. */
  direction?: 'column' | 'row';
  /** Default `md`. */
  gap?: Space;
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  justify?: 'start' | 'center' | 'end' | 'between';
  wrap?: boolean;
  children?: ReactNode;
}

export interface GridProps {
  /** Equal columns. Default 2. Narrow screens get one column. */
  columns?: 1 | 2 | 3 | 4 | 6;
  /** Default `md`. */
  gap?: Space;
  children?: ReactNode;
}

// ─── Inputs ─────────────────────────────────────────────────────────────────

export interface ButtonProps {
  children?: ReactNode;
  /** Default `secondary`. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  /** Default `md`. */
  size?: 'sm' | 'md' | 'lg';
  /** A Lucide icon name, drawn before the label. */
  icon?: string;
  /** Shows a spinner and blocks clicks. */
  loading?: boolean;
  disabled?: boolean;
  /** Default `button`. */
  type?: 'button' | 'submit' | 'reset';
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** The accessible name, for a button with only an icon. */
  'aria-label'?: string;
}

export interface FieldProps {
  /** A visible label; the field is named by it. */
  label?: ReactNode;
  /** A line under the field. */
  hint?: ReactNode;
  /** Marks the field invalid and shows the message under it. */
  error?: ReactNode;
}

export interface InputProps
  extends FieldProps,
    Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'style' | 'className' | 'children'> {
  onChange?: ChangeEventHandler<HTMLInputElement>;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends FieldProps,
    Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'style' | 'className'> {
  /** The choices; plain strings are their own labels. `children` options work too. */
  options?: readonly (SelectOption | string)[];
  onChange?: ChangeEventHandler<HTMLSelectElement>;
}

export interface SwitchProps {
  label?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  id?: string;
}

// ─── Data ───────────────────────────────────────────────────────────────────

export interface DataTableColumn<R extends AnyRecord = AnyRecord> {
  /** The row key this column shows. */
  key: string;
  label: string;
  /** How the value is formatted when `render` is absent. Default `text`. */
  type?: 'text' | 'number' | 'money' | 'percent' | 'date' | 'datetime' | 'boolean';
  /** For `money`: an ISO 4217 code. Default the database's currency, or USD. */
  currency?: string;
  align?: 'start' | 'end';
  /** Draws the cell yourself. */
  render?: (record: R) => ReactNode;
  /** Default true: the header sorts the rows on the page. */
  sortable?: boolean;
}

export interface DataTableProps<R extends AnyRecord = AnyRecord> {
  columns: readonly DataTableColumn<R>[];
  rows: readonly R[] | undefined;
  /** The key that identifies a row. Default `id`. */
  rowKey?: string | ((record: R) => string);
  /** Makes rows clickable. */
  onRowClick?: (record: R) => void;
  /** Shows a loading state instead of the rows. */
  loading?: boolean;
  /** Shown when there are no rows. */
  empty?: ReactNode;
  /** Default `comfortable`. */
  density?: 'comfortable' | 'compact';
}

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** A change in percent, drawn as a pill: 12.5 → "+12.5%". */
  delta?: number;
  /** Treat a fall as good news (costs, churn). */
  invertDelta?: boolean;
  /** A line under the value. */
  hint?: ReactNode;
  /** A Lucide icon name. */
  icon?: string;
}

export interface GeneratedPageProps {
  /**
   * A page as `pages/<slug>.json` holds it, such as the constant
   * `adminium eject` writes: databases by key, no ids.
   */
  page: Readonly<AnyRecord>;
}

// ─── Feedback and icons ─────────────────────────────────────────────────────

export interface ToastOptions {
  /** Default `success`. */
  tone?: 'success' | 'info' | 'warning' | 'error';
  description?: string;
  /** Milliseconds; `null` keeps it until it is closed. */
  duration?: number | null;
}

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** A Lucide icon name. */
  icon?: string;
  actions?: ReactNode;
}

export interface IconProps {
  /** A Lucide icon name in kebab-case, such as `chart-line`. */
  name: string;
  /** Pixels. Default 16. */
  size?: 12 | 14 | 16 | 18 | 20 | 24;
  /** Names the icon for screen readers; without it the icon is decorative. */
  label?: string;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

/** A record's key: its primary key value, or `{ column: value }` for several columns. */
export type RecordId = string | number | Readonly<Record<string, string | number>>;

export interface RecordsQuery<R extends AnyRecord = AnyRecord> {
  /** Rows whose columns equal these values. */
  where?: Partial<R>;
  /** Words to look for in the table's text columns. */
  search?: string;
  /** The column to sort by; a leading `-` sorts descending. */
  orderBy?: string;
  /** 50 when unset, 200 at most. */
  limit?: number;
  offset?: number;
}

export interface QueryState {
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export interface RecordsResult<R> extends QueryState {
  data: R[] | undefined;
  /** How many rows match, when the database can say cheaply; otherwise null. */
  total: number | null;
}

export interface RecordResult<R> extends QueryState {
  /** Undefined while loading; null when there is no such record. */
  data: R | null | undefined;
}

export interface Mutation<R extends AnyRecord = AnyRecord> {
  create(values: Partial<R>): Promise<R>;
  update(id: RecordId, values: Partial<R>): Promise<R>;
  /**
   * Deletes the record. When other rows reference it, the call fails unless
   * `confirm` is set, and then the database's own rules for those rows apply.
   */
  remove(id: RecordId, options?: { confirm?: boolean }): Promise<void>;
  /** True while a call is running. */
  isPending: boolean;
  /** The last call's error, cleared by the next call. */
  error: Error | null;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  /** Role slugs, such as `super-admin` or `viewer`. */
  roles: string[];
}

export interface LinkProps {
  /** A path in this dashboard, such as `/p/orders`. */
  to: string;
  children?: ReactNode;
}

// ─── The kit, from the dashboard ────────────────────────────────────────────

/** The shapes the dashboard's kit object must have, name by name. */
export interface ProjectUiKit {
  Page: ComponentType<PageProps>;
  Card: ComponentType<CardProps>;
  Stack: ComponentType<StackProps>;
  Grid: ComponentType<GridProps>;
  Button: ComponentType<ButtonProps>;
  Input: ComponentType<InputProps>;
  Select: ComponentType<SelectProps>;
  Switch: ComponentType<SwitchProps>;
  DataTable: <R extends AnyRecord = AnyRecord>(props: DataTableProps<R>) => ReactNode;
  Stat: ComponentType<StatProps>;
  GeneratedPage: ComponentType<GeneratedPageProps>;
  toast: (message: string, options?: ToastOptions) => void;
  EmptyState: ComponentType<EmptyStateProps>;
  Icon: ComponentType<IconProps>;
  useRecords: <R extends AnyRecord = AnyRecord>(
    database: string,
    table: string,
    query?: RecordsQuery<R>,
  ) => RecordsResult<R>;
  useRecord: <R extends AnyRecord = AnyRecord>(
    database: string,
    table: string,
    id: RecordId | null | undefined,
  ) => RecordResult<R>;
  useMutation: <R extends AnyRecord = AnyRecord>(database: string, table: string) => Mutation<R>;
  useCurrentUser: () => CurrentUser;
  useNavigate: () => (to: string) => void;
  Link: ComponentType<LinkProps>;
}

// A compile error here means the kit and the runtime contract list different names.
const KIT_NAMES_MATCH: [ProjectUiExport] extends [keyof ProjectUiKit]
  ? [keyof ProjectUiKit] extends [ProjectUiExport]
    ? true
    : never
  : never = true;
void KIT_NAMES_MATCH;

const kit: Readonly<Record<string, unknown>> | undefined = hasAddOnRuntime() ? requireAddOnRuntime().ui : undefined;

/** A stand-in that says where the real thing lives, used or rendered. */
function outsideDashboard(name: string): () => never {
  return () => {
    throw new Error(
      `${name} from @adminiumjs/adminium/ui is provided by the Adminium dashboard, ` +
        'and this code is running outside it. Pages and widgets use it once `adminium build` bundles them.',
    );
  };
}

function take<K extends ProjectUiExport>(name: K): ProjectUiKit[K] {
  const value = kit?.[name];
  return (value === undefined ? outsideDashboard(name) : value) as ProjectUiKit[K];
}

export const Page = take('Page');
export const Card = take('Card');
export const Stack = take('Stack');
export const Grid = take('Grid');
export const Button = take('Button');
export const Input = take('Input');
export const Select = take('Select');
export const Switch = take('Switch');
export const DataTable = take('DataTable');
export const Stat = take('Stat');
export const GeneratedPage = take('GeneratedPage');
export const toast = take('toast');
export const EmptyState = take('EmptyState');
export const Icon = take('Icon');
export const useRecords = take('useRecords');
export const useRecord = take('useRecord');
export const useMutation = take('useMutation');
export const useCurrentUser = take('useCurrentUser');
export const useNavigate = take('useNavigate');
export const Link = take('Link');
