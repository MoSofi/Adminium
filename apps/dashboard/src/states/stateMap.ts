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
  Plus,
  RefreshCw,
  ServerCrash,
  UserPlus,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';

import type { SystemStateId } from '../app/query.js';

export type StateTone = 'accent' | 'warn' | 'danger' | 'neutral';

export interface SystemStateSpec {
  id: SystemStateId;
  /** Giant mono numeral behind the glyph ('404'); absent for code-less states. */
  code?: string;
  icon: LucideIcon;
  tone: StateTone;
  title: string;
  body: string;
  primary?: { label: string; icon: LucideIcon };
  secondary?: string;
  /** `db-unreachable` renders the diagnostics readout (host/status/hint). */
  diagnostics?: { host: string; status: string; hint: string };
  /** `offline` additionally shows the fixed top banner. */
  banner?: string;
}

export const SYSTEM_STATES: Record<SystemStateId, SystemStateSpec> = {
  'not-found': {
    id: 'not-found',
    code: '404',
    icon: Compass,
    tone: 'neutral',
    title: 'Page not found',
    body: "We couldn't find that page. It may have been moved or the link is broken.",
    primary: { label: 'Back to dashboard', icon: ArrowLeft },
    secondary: 'Contact support',
  },
  forbidden: {
    id: 'forbidden',
    code: '403',
    icon: Lock,
    tone: 'warn',
    title: 'You don’t have access',
    body: 'This dashboard is restricted. Ask a workspace admin to grant you access.',
    primary: { label: 'Request access', icon: UserPlus },
    secondary: 'Go back',
  },
  error: {
    id: 'error',
    code: '500',
    icon: ServerCrash,
    tone: 'danger',
    title: 'Something went wrong',
    body: 'An unexpected error occurred on our end. Our team has been notified.',
    primary: { label: 'Try again', icon: RefreshCw },
    secondary: 'Status page',
  },
  'db-unreachable': {
    id: 'db-unreachable',
    icon: Database,
    tone: 'danger',
    title: 'Database unreachable',
    body: "We couldn't connect to prod-db. Your dashboards will resume once the connection is restored.",
    primary: { label: 'Retry connection', icon: RefreshCw },
    secondary: 'Edit connection',
    diagnostics: {
      host: 'db.acme.internal:5432',
      status: 'connection timed out (10s)',
      hint: 'allowlist 52.9.14.2, then retry',
    },
  },
  maintenance: {
    id: 'maintenance',
    icon: Activity,
    tone: 'accent',
    title: 'Scheduled maintenance',
    body: 'Adminium is undergoing maintenance and will be back shortly. Thanks for your patience.',
    primary: { label: 'View status', icon: Activity },
  },
  'rate-limited': {
    id: 'rate-limited',
    code: '429',
    icon: Gauge,
    tone: 'warn',
    title: 'Rate limit reached',
    body: 'Too many requests in a short time. Wait a few minutes and try again.',
    primary: { label: 'Try again', icon: RefreshCw },
    secondary: 'Go back',
  },
  offline: {
    id: 'offline',
    icon: WifiOff,
    tone: 'warn',
    title: "You're offline",
    body: 'Check your internet connection. Adminium will reconnect automatically when you’re back.',
    primary: { label: 'Retry now', icon: RefreshCw },
    banner: "You're offline — trying to reconnect…",
  },
  'expired-link': {
    id: 'expired-link',
    icon: Link2Off,
    tone: 'warn',
    title: 'This link has expired',
    body: 'Magic sign-in links expire after 10 minutes. Request a fresh one to continue.',
    primary: { label: 'Send a new link', icon: Mail },
    secondary: 'Back to sign in',
  },
  'expired-session': {
    id: 'expired-session',
    icon: LogOut,
    tone: 'warn',
    title: 'Your session expired',
    body: 'For your security you were signed out after a period of inactivity. Sign in to pick up where you left off.',
    primary: { label: 'Sign in again', icon: LogIn },
  },
  'empty-no-sources': {
    id: 'empty-no-sources',
    icon: Inbox,
    tone: 'accent',
    title: 'No data sources yet',
    body: 'Connect a PostgreSQL database and Adminium will generate your first admin dashboard.',
    primary: { label: 'Connect a database', icon: Plus },
    secondary: 'Import sample data',
  },
  'read-only': {
    id: 'read-only',
    icon: Eye,
    tone: 'accent',
    title: 'Read-only mode',
    body: 'You have Viewer access to this workspace. You can explore dashboards, but editing and destructive actions are disabled.',
    primary: { label: 'Request edit access', icon: UserPlus },
    secondary: 'Got it',
  },
  suspended: {
    id: 'suspended',
    code: '402',
    icon: Lock,
    tone: 'warn',
    title: 'This workspace is suspended',
    body: 'This workspace has been suspended by an administrator. Your data is preserved — contact the workspace owner to restore access.',
    primary: { label: 'Contact owner', icon: Mail },
    secondary: 'Go back',
  },
};
