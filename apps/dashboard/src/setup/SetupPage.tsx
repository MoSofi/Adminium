/**
 * `/setup` route component (M10-T04): resolves the server's password policy,
 * then renders the wizard. The "is setup still open?" decision lives in the
 * route guard (../app/router.tsx), not here — by the time this renders, the
 * guard has already established that setup is required.
 */
import { useSuspenseQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { FirstRunWizard } from './FirstRunWizard.js';
import { setupStateQuery } from './setupApi.js';

export function SetupPage(): ReactNode {
  const { data } = useSuspenseQuery(setupStateQuery());
  return <FirstRunWizard passwordMinLength={data.passwordMinLength} />;
}
