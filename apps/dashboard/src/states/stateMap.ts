// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The 12 system states (09-generated-app.md §6.1). Eleven variants carry the
 * copy verbatim from System States.dc.html; `suspended` is the new
 * cloud-dunning state specced in §6.1 (ia-mapping §2D gap).
 */
import {
  Activity,
  ArrowLeft,
  Compass,
  Database,
  Eye,
  Gauge,
  Inbox,
  Link2Off,
  Lock,
  LogIn,
  LogOut,
  Mail,
  PauseCircle,
  Plus,
  RefreshCw,
  ServerCrash,
  UserPlus,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';

import type { SystemStateId } from '../app/query.js';

export type StateTone = 'accent' | 'warn' | 'danger' | 'neutral';

/**
 * A user-visible string: its bundle key plus the en-US source text.
 *
 * Both travel together because `t(key, fallback)` degrades to the fallback
 * before `initDashboardI18n()` runs (and in unit tests that never boot i18n),
 * so a bare key would render as `states.notFound.title` on screen. Typing these
 * as objects rather than strings is deliberate: every render site has to go
 * through `t()`, because a `Msg` is not a `ReactNode`.
 */
export interface Msg {
  key: string;
  /** en-US source text — the fallback, and what the bundles are authored from. */
  en: string;
}

export interface SystemStateSpec {
  id: SystemStateId;
  /** Giant mono numeral behind the glyph ('404'); absent for code-less states. */
  code?: string;
  icon: LucideIcon;
  tone: StateTone;
  title: Msg;
  body: Msg;
  primary?: { label: Msg; icon: LucideIcon };
  secondary?: Msg;
  /** `db-unreachable` renders the diagnostics readout (host/status/hint). */
  diagnostics?: { host: string; status: Msg; hint: Msg };
  /** `offline` additionally shows the fixed top banner. */
  banner?: Msg;
}

export const SYSTEM_STATES: Record<SystemStateId, SystemStateSpec> = {
  'not-found': {
    id: 'not-found',
    code: '404',
    icon: Compass,
    tone: 'neutral',
    title: { key: 'states.notFound.title', en: 'Page not found' },
    body: { key: 'states.notFound.body', en: "We couldn't find that page. It may have been moved or the link is broken." },
    primary: { label: { key: 'states.notFound.primary', en: 'Back to dashboard' }, icon: ArrowLeft },
    secondary: { key: 'states.notFound.secondary', en: 'Contact support' },
  },
  forbidden: {
    id: 'forbidden',
    code: '403',
    icon: Lock,
    tone: 'warn',
    title: { key: 'states.forbidden.title', en: 'You don’t have access' },
    body: { key: 'states.forbidden.body', en: 'This dashboard is restricted. Ask a workspace admin to grant you access.' },
    primary: { label: { key: 'states.forbidden.primary', en: 'Request access' }, icon: UserPlus },
    secondary: { key: 'states.forbidden.secondary', en: 'Go back' },
  },
  error: {
    id: 'error',
    code: '500',
    icon: ServerCrash,
    tone: 'danger',
    title: { key: 'states.error.title', en: 'Something went wrong' },
    // NOT "on our end / our team has been notified". There is no vendor behind
    // this screen: v1 is self-hosted, so "our end" IS the reader's own server
    // and nobody was told anything. The old copy also implied the failure had
    // been phoned home, which is the opposite of what happened — it went to the
    // server log, which is exactly where the reference below points.
    body: {
      key: 'states.error.body',
      en: 'Adminium hit an unexpected error handling this request. The details are in the server log.',
    },
    primary: { label: { key: 'states.error.primary', en: 'Try again' }, icon: RefreshCw },
    // NO secondary. The comp's "Status page" assumed a hosted product; v1 ships
    // self-hosted (17-deferred-monetization.md), where the instance IS the
    // reader's own server and there is no status page to send them to. It was
    // wired to nothing and could not honestly be wired to anything, so the CTA
    // row is one button and the reference below it carries the recovery path.
  },
  'db-unreachable': {
    id: 'db-unreachable',
    icon: Database,
    tone: 'danger',
    title: { key: 'states.dbUnreachable.title', en: 'Database unreachable' },
    body: { key: 'states.dbUnreachable.body', en: "We couldn't connect to prod-db. Your dashboards will resume once the connection is restored." },
    primary: { label: { key: 'states.dbUnreachable.primary', en: 'Retry connection' }, icon: RefreshCw },
    secondary: { key: 'states.dbUnreachable.secondary', en: 'Edit connection' },
    diagnostics: {
      host: 'db.acme.internal:5432',
      status: { key: 'states.dbUnreachable.diag.status', en: 'connection timed out (10s)' },
      hint: { key: 'states.dbUnreachable.diag.hint', en: 'allowlist 52.9.14.2, then retry' },
    },
  },
  maintenance: {
    id: 'maintenance',
    icon: Activity,
    tone: 'accent',
    title: { key: 'states.maintenance.title', en: 'Scheduled maintenance' },
    body: { key: 'states.maintenance.body', en: 'Adminium is undergoing maintenance and will be back shortly. Thanks for your patience.' },
    primary: { label: { key: 'states.maintenance.primary', en: 'View status' }, icon: Activity },
  },
  'rate-limited': {
    id: 'rate-limited',
    code: '429',
    icon: Gauge,
    tone: 'warn',
    title: { key: 'states.rateLimited.title', en: 'Rate limit reached' },
    body: { key: 'states.rateLimited.body', en: 'Too many requests in a short time. Wait a few minutes and try again.' },
    primary: { label: { key: 'states.rateLimited.primary', en: 'Try again' }, icon: RefreshCw },
    secondary: { key: 'states.rateLimited.secondary', en: 'Go back' },
  },
  offline: {
    id: 'offline',
    icon: WifiOff,
    tone: 'warn',
    title: { key: 'states.offline.title', en: "You're offline" },
    body: { key: 'states.offline.body', en: 'Check your internet connection. Adminium will reconnect automatically when you’re back.' },
    primary: { label: { key: 'states.offline.primary', en: 'Retry now' }, icon: RefreshCw },
    banner: { key: 'states.offline.banner', en: "You're offline — trying to reconnect…" },
  },
  'expired-link': {
    id: 'expired-link',
    icon: Link2Off,
    tone: 'warn',
    title: { key: 'states.expiredLink.title', en: 'This link has expired' },
    body: { key: 'states.expiredLink.body', en: 'Magic sign-in links expire after 10 minutes. Request a fresh one to continue.' },
    primary: { label: { key: 'states.expiredLink.primary', en: 'Send a new link' }, icon: Mail },
    secondary: { key: 'states.expiredLink.secondary', en: 'Back to sign in' },
  },
  'expired-session': {
    id: 'expired-session',
    icon: LogOut,
    tone: 'warn',
    title: { key: 'states.expiredSession.title', en: 'Your session expired' },
    body: { key: 'states.expiredSession.body', en: 'For your security you were signed out after a period of inactivity. Sign in to pick up where you left off.' },
    primary: { label: { key: 'states.expiredSession.primary', en: 'Sign in again' }, icon: LogIn },
  },
  'empty-no-sources': {
    id: 'empty-no-sources',
    icon: Inbox,
    tone: 'accent',
    title: { key: 'states.emptyNoSources.title', en: 'No data sources yet' },
    body: { key: 'states.emptyNoSources.body', en: 'Connect a PostgreSQL database and Adminium will generate your first admin dashboard.' },
    primary: { label: { key: 'states.emptyNoSources.primary', en: 'Connect a database' }, icon: Plus },
    secondary: { key: 'states.emptyNoSources.secondary', en: 'Import sample data' },
  },
  'read-only': {
    id: 'read-only',
    icon: Eye,
    tone: 'accent',
    title: { key: 'states.readOnly.title', en: 'Read-only mode' },
    body: { key: 'states.readOnly.body', en: 'You have Viewer access to this workspace. You can explore dashboards, but editing and destructive actions are disabled.' },
    primary: { label: { key: 'states.readOnly.primary', en: 'Request edit access' }, icon: UserPlus },
    secondary: { key: 'states.readOnly.secondary', en: 'Got it' },
  },
  suspended: {
    id: 'suspended',
    code: '402',
    icon: Lock,
    tone: 'warn',
    title: { key: 'states.suspended.title', en: 'This workspace is suspended' },
    body: { key: 'states.suspended.body', en: 'This workspace has been suspended by an administrator. Your data is preserved — contact the workspace owner to restore access.' },
    primary: { label: { key: 'states.suspended.primary', en: 'Contact owner' }, icon: Mail },
    secondary: { key: 'states.suspended.secondary', en: 'Go back' },
  },
  /**
   * An admin PAUSED the connection this page reads from (meta wave 0019).
   *
   * Tone `accent`, not `danger`: nothing failed and nothing is lost — somebody
   * switched the source off on purpose, which is closer to `read-only` than to
   * `db-unreachable`. The copy says so, and says where the switch is, because
   * the reader is usually not the person who flipped it.
   *
   * No `primary`. "Retry" is the reflex here and it is exactly wrong: the
   * answer will not change until a human resumes the connection, so a retry
   * button would be a control that cannot work. `secondary` goes back, which
   * is the only move the reader actually has. (`StateHero` omits a button that
   * is absent from `StatePage`'s action maps — see the `suspended` note there.)
   */
  'connection-paused': {
    id: 'connection-paused',
    icon: PauseCircle,
    tone: 'accent',
    title: { key: 'states.connectionPaused.title', en: 'This connection is paused' },
    body: {
      key: 'states.connectionPaused.body',
      en: 'An admin paused the database behind this page, so it is not loading data right now. Nothing has been deleted — it comes back as soon as the connection is resumed in Studio → Data connections.',
    },
    secondary: { key: 'states.connectionPaused.secondary', en: 'Go back' },
  },
};
