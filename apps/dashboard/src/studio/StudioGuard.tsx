/**
 * Studio role gate (09 §8.1): Studio routes require role ≥ Admin. Editors
 * and viewers keep the shell and get the `forbidden` system state inside the
 * content outlet — never a blank screen. (The server independently guards
 * every Studio API with `system:connections:manage` and friends.)
 */
import { useSuspenseQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { bootstrapQuery } from '../app/bootstrap.js';
import { StatePage } from '../states/StatePage.js';

/** Role slugs granted Studio access (bootstrap `roles` payload). */
const STUDIO_ROLES = new Set(['admin', 'super-admin']);

export function hasStudioAccess(roles: readonly string[]): boolean {
  return roles.some((role) => STUDIO_ROLES.has(role));
}

export function StudioGuard({ children }: { children: ReactNode }) {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  if (!hasStudioAccess(bootstrap.roles)) {
    return <StatePage stateId="forbidden" fullPage={false} />;
  }
  return <>{children}</>;
}
