// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio role gate: Studio routes require role ≥ Admin. Editors and viewers
 * keep the shell and get the `forbidden` system state inside the content
 * outlet — never a blank screen. (The server independently guards every
 * Studio API with `system:connections:manage` and friends.)
 */
import { useSuspenseQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { bootstrapQuery, holdsSystemAction, type SystemAction } from '../app/bootstrap.js';
import { StatePage } from '../states/StatePage.js';

// The predicate itself lives in a leaf (`./studioAccess.js`) so a non-Studio
// surface can ask the question without importing this module's `StatePage`.
// Re-exported here because every existing caller reads it from the guard.
import { hasStudioAccess } from './studioAccess.js';

export { hasStudioAccess };

/**
 * `requires` narrows the gate to the one `system:` key the surface's routes
 * check, for screens the Admin role alone does not open (Roles needs
 * `roles.manage`, API keys `api-keys.manage`). With it the role test is not
 * consulted at all: a custom role holding the key gets in, an Admin without it
 * gets the `forbidden` state rather than a page whose every request 403s.
 */
export function StudioGuard({ children, requires }: { children: ReactNode; requires?: SystemAction }) {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const allowed =
    requires === undefined ? hasStudioAccess(bootstrap.roles) : holdsSystemAction(bootstrap, requires);
  if (!allowed) {
    return <StatePage stateId="forbidden" fullPage={false} />;
  }
  return <>{children}</>;
}
