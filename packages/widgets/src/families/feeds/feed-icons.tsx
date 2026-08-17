// SPDX-License-Identifier: AGPL-3.0-only
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  CreditCard,
  FilePlus2,
  GitCommitHorizontal,
  KeyRound,
  MessageSquare,
  Pencil,
  RefreshCw,
  Rocket,
  ShieldAlert,
  Trash2,
  UserPlus,
  Webhook,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Curated Lucide glyphs for feed event categories (annex §4 tone-tinted icon
 * tiles). Data carries a category/verb string; unknown values fall back to the
 * generic activity dot so a novel event type never crashes a row.
 */
const FEED_ICONS: Record<string, ReactNode> = {
  created: <FilePlus2 />,
  updated: <Pencil />,
  deleted: <Trash2 />,
  commented: <MessageSquare />,
  approved: <CheckCircle2 />,
  invited: <UserPlus />,
  member: <UserPlus />,
  deployed: <Rocket />,
  release: <Rocket />,
  commit: <GitCommitHorizontal />,
  billing: <CreditCard />,
  payment: <CreditCard />,
  webhook: <Webhook />,
  api: <KeyRound />,
  auth: <KeyRound />,
  security: <ShieldAlert />,
  incident: <AlertTriangle />,
  error: <AlertTriangle />,
  system: <Zap />,
  sync: <RefreshCw />,
  mention: <Bell />,
  notification: <Bell />,
};

const FALLBACK: ReactNode = <GitCommitHorizontal />;

/** Resolve a feed category/verb string to a Lucide element (never null). */
export function feedIcon(name: string | undefined): ReactNode {
  if (name === undefined) return FALLBACK;
  return FEED_ICONS[name] ?? FALLBACK;
}
