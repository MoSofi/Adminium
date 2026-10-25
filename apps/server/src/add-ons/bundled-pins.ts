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
  { key: 'barcode-labels', version: '1.0.14', integrity: 'sha512-AekDg4d4aBSbUE9TR1eQSaMUuqHyWsP45ZgWClSqanwFhcvBhDizqvk7SaeB0KqUtJA10E3TcZCKo8p/D2nbuA==' },
  { key: 'design-studio', version: '1.0.14', integrity: 'sha512-p2pb3OItVvIghUFKKoo4LbC3WfrRl9MveHf0orVf1QNCLs+Fn9g2A59rkYYs01V8ko4mW/B+bENU/veYHpNyUQ==' },
  { key: 'holiday-calendars', version: '1.0.14', integrity: 'sha512-l7eGXSGxo+LxobDsxYfYuzNmCweHTj7yafufgbdG5UsxNieqyWo+Gq2jn3cfTU12P8BDKDGunjbQhBJ03Iq/sw==' },
  { key: 'import-canva', version: '1.0.14', integrity: 'sha512-Mn2EtTfS+GUppKXm2xtg+GYDNvXiaNDsqYrA/nsRN5SnFLxjL+c4FrqcsbsyTN4xoFr/WU1IH/VqfgDynxNgQA==' },
  { key: 'inventory', version: '1.0.14', integrity: 'sha512-7Rx6j8Va/WDz3Q8Bj88x5rdsOZd1XzNR1qqDF5Dr+Nof8Ys4pSu4GuUBT3iFQd1jA8+Ca2NOUhf8mFnosWvgKA==' },
  { key: 'invoices', version: '1.0.14', integrity: 'sha512-5jf4HxWPX8pqKmzqmUnNVV1nTyou6ghfr5W2k9SywBBH2dWoNDsPrplvDug5licWypYL/VeWj6sN15Vx5p1Aeg==' },
  { key: 'offers', version: '1.0.14', integrity: 'sha512-RyKBTEOGKLNs3H3sSuGevFlJD3h2WNzlC9uyf21u+p9Y4AIzxhz4xAR2iZ7/y8i4segFciKhywgrwS/bTBCVMA==' },
  { key: 'payments-paypal', version: '1.0.14', integrity: 'sha512-pZmvibAHzr1Ma+jNZW3ZeXBwnof0GOUpP4APBF42ZMx3EEraa374ZvtAXAW++X+9oTT8hM/b6bxDUmu4oNbydQ==' },
  { key: 'payments-stripe', version: '1.0.14', integrity: 'sha512-OWhwwemHV6kmZSEUGq+oHjOItrtJrGHtXBJHbnaEtG/97YlFazHXNkt4E83MCMXrhpDdserdsrRTGpzxVmNnbA==' },
  { key: 'personalizer', version: '1.0.14', integrity: 'sha512-DvGdm8gGz4JVGv5YcYvCcKLwXuB5+Yy4vqOoYLr7H3MLYzkNCKJhV9+6h+5Efmxxbmx3qg8WPFQzAqvUYn6k/A==' },
  { key: 'shipping-dhl', version: '1.0.14', integrity: 'sha512-zUcL7onnvis4+b608DAxlHfoAzGNsE8/0uwiSXYUzXzX7tVxBpfVfaH5X3WRh8vsXdBWhQgsr1F5XTfOPHOQnQ==' },
];
