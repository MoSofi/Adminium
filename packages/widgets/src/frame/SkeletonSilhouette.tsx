import { Skeleton } from '@adminium/ui';

import type { WidgetSkeleton } from '../registry/types.js';

/**
 * Per-family skeleton silhouettes for the WidgetFrame `skeleton` state and
 * for lazy-chunk Suspense fallbacks (04 §4). Built from the ui `Skeleton`
 * shimmer; the container carries `aria-busy` (individual bones are
 * aria-hidden per ui convention).
 */
export interface SkeletonSilhouetteProps {
  variant: WidgetSkeleton;
}

export function SkeletonSilhouette({ variant }: SkeletonSilhouetteProps) {
  return (
    <div
      aria-busy="true"
      data-skeleton-variant={variant}
      className="flex min-h-20 flex-col gap-3 p-4 compact:gap-2 compact:p-3"
    >
      {variant === 'card' && (
        <>
          <div className="flex items-center gap-3">
            <Skeleton rounded="lg" width={36} height={36} />
            <Skeleton height={12} width="40%" />
          </div>
          <Skeleton height={28} width="55%" />
          <Skeleton height={10} width="70%" />
        </>
      )}
      {variant === 'chart' && (
        <>
          <Skeleton height={12} width="35%" />
          <div className="flex flex-1 items-end gap-2">
            <Skeleton height={48} className="flex-1" />
            <Skeleton height={80} className="flex-1" />
            <Skeleton height={64} className="flex-1" />
            <Skeleton height={96} className="flex-1" />
            <Skeleton height={72} className="flex-1" />
          </div>
          <Skeleton height={8} width="90%" />
        </>
      )}
      {variant === 'table' && (
        <>
          <Skeleton height={12} width="60%" />
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <Skeleton height={12} width="25%" />
              <Skeleton height={12} className="flex-1" />
              <Skeleton height={12} width="15%" />
            </div>
          ))}
        </>
      )}
      {variant === 'list' && (
        <>
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <Skeleton rounded="full" width={32} height={32} />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton height={12} width="60%" />
                <Skeleton height={10} width="40%" />
              </div>
              <Skeleton height={10} width={48} />
            </div>
          ))}
        </>
      )}
      {variant === 'block' && <Skeleton rounded="lg" className="min-h-24 flex-1" />}
    </div>
  );
}
