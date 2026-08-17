// SPDX-License-Identifier: AGPL-3.0-only
// The sanctioned no-style-prop escape hatch passes CSS custom properties through the
// style attribute (02-design-system.md §8). React's CSSProperties doesn't type `--*`
// keys by default; this augmentation admits exactly those. Same pattern as
// packages/ui and packages/charts.
import 'react';

declare module 'react' {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}
