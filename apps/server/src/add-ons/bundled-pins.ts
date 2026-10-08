// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The add-on packages this build bundles, by key, version and the hash of
 * each tarball: a copy of `scripts/release/add-ons-bundle.json`, held equal
 * to it by a test (`add-on-decide-trust.test.ts`). A package whose bytes are
 * listed here may run code that decides inside a save (`decide.ts`).
 *
 * It is a module, not a read of that file, because the server that runs is
 * built and packed without the repository's `scripts/` folder.
 */
import type { TrustedPackage } from './decide.js';

export const BUNDLED_PINS: readonly TrustedPackage[] = [
  { key: 'barcode-labels', version: '1.0.8', integrity: 'sha512-oOlnJfT8N9MkBbqAwzu00x34q964pG3LMp5dPUjILrVRErGbjHduGPjWIuweovoCy/GCEi3Qglv7AJdK0WAvuw==' },
  { key: 'design-studio', version: '1.0.8', integrity: 'sha512-zklVXP59UKzpsFkPmrPkbSG/tzhOk5uWperbxGzB0kzBXlyRKwWk8p6SZmoUuiwgDfrd2TQryJA1+SQEG4j1CA==' },
  { key: 'holiday-calendars', version: '1.0.8', integrity: 'sha512-AxzZqhXb3lET4l1SiXyJVtlIo7Q9+UhX7d4vtowZrc2UkrMGJQzbA9Bh/iZqj8eME8NJAZIPkpdC1WN3i3AQLw==' },
  { key: 'import-canva', version: '1.0.8', integrity: 'sha512-u3W5+n0LIWlgax7Mn7NN3Xvi4t0sYBP+ZwxqQpFvUCHuN7k0+eurYMeE1o50vwhQWcc6lXe3WcpR+/YyeGn3Xw==' },
  { key: 'inventory', version: '1.0.8', integrity: 'sha512-Tek9t9e6bxyS7LygsAMA2CGftZ8jOTp+bu9c236ywLjwOkCWWKYRMpUOjtrYXV+GIOet06FND8ekG5k6MBOb/A==' },
  { key: 'invoices', version: '1.0.8', integrity: 'sha512-Um7ZBVroDXJCRuI/sEgiU5wjLrKasj7s5mduO0PdOq6Dr3AlOBy3x+S2nWmBKv+ZoVfoXNJJu3/9C1+a4TQaEQ==' },
  { key: 'personalizer', version: '1.0.8', integrity: 'sha512-j9C/7Vn5RzmS0OW/JqofCLGNompFeMTed0RhL9lHgVG4JGfQ3iK0OZCq3dads67xeyUN0CX/prhLI7YpJX01nw==' },
  { key: 'shipping-dhl', version: '1.0.8', integrity: 'sha512-383ncUsLQXB1poEPbkScUbbLPXmSS7zQ0ZQMfWSFw7KM0QTxVS9PyGijSievWA0MQY92OB0hX1JK8qIpovSrXw==' },
];
