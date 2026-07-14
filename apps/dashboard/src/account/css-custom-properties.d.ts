// The sanctioned no-style-prop escape hatch passes CSS custom properties through the
// style attribute (02-design-system.md §8). React's CSSProperties doesn't type `--*`
// keys by default; this augmentation admits exactly those (mirrors
// packages/ui/src/types/css-custom-properties.d.ts).
import 'react';

declare module 'react' {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}
