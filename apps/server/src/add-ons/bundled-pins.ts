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
  { key: 'barcode-labels', version: '1.0.19', integrity: 'sha512-0AvJFS2xCCQ2C52C9PDPeYXdTTulFPNRp0Z8Iryo5GHvh7GfdMuWphSKt5GaErSGD3OXjngrTq4YQ0S1kVvd8w==' },
  { key: 'customiser', version: '1.0.19', integrity: 'sha512-/9Y5CjlQws9hFPIvT00XvwdRdGUf6yZ96Y14W7Wep3vrTVxRpXGdePo3LImk3wMVKK8JCrd76L6QPT0lIZPYmQ==' },
  { key: 'design-studio', version: '1.0.19', integrity: 'sha512-xykirewhr8/gsY0YdtaVylFYBdWcR31TF53mEgQxdBvlEFnBSGwyM0n0XC5vYlA+Om/fRR92w4jgzch+gb8cyQ==' },
  { key: 'forms', version: '1.0.19', integrity: 'sha512-FHghYFIMvYLC0qIKvNEd9hgg7j5r+xgAtnO8+H5n5xMoufmhy3cDxjFGR7SQx9eO0QYjuXwh7N/+sWey3e/PgQ==' },
  { key: 'holiday-calendars', version: '1.0.19', integrity: 'sha512-Nt9DNGFKcDdbQZgrxS76f4YgQWqABhUTLao+3FCFcAoAfWxc+wTTOD15pRuMZinPD25WnWOyGw5G1azE1a4/Nw==' },
  { key: 'import-canva', version: '1.0.19', integrity: 'sha512-xX2Hk794wFkAQIyC7k10MvVU6aJu6mB/uHQzi89jWSgPStJ4kBxVGqKrqi7PmLjppkdv11AFHXrN9tU9ZDxtNw==' },
  { key: 'inventory', version: '1.0.19', integrity: 'sha512-hixs96m1sXHIBP0CfinVvn+sFG8E27craDC+GnBuFgJe8bKAtFuJ0GQhQ05ILlXznGD0EpehQPYkLANBWCfERw==' },
  { key: 'invoices', version: '1.0.19', integrity: 'sha512-PVXD4ZrwkHZhEE2VwBrzC5zy//DzR5VZo5BnTg9DShsIAb0EHQdsfIC1LGUY+Xb5K1IyfcDpdHXsggc7/Wx8Aw==' },
  { key: 'offers', version: '1.0.19', integrity: 'sha512-8gu/SwXGjL8kr0YG12Wcrd5ke7ZvMvK49Ti/tFZW5owPL1C1XzpS7L3hFMiJ0F5jQ4vSXtJHpFaBw1Kbn90VUQ==' },
  { key: 'payments-paypal', version: '1.0.19', integrity: 'sha512-lw0S2F9rfrKii5bjKuTWeiU2aF/OFOBbAD2jUu836YnPqUFXSJ9x3JOtaAFXGsRYolAdKiADzY6Tz9QRhINTHg==' },
  { key: 'payments-stripe', version: '1.0.19', integrity: 'sha512-BkKfwXeSaHbz+q0VMbdqbvgv4KJy9oKiPcGYG8FJYYmdakVjtMsZ0MtDY7l0WdxevLryLq0uJbSLQCJIJzMG3A==' },
  { key: 'personalizer', version: '1.0.19', integrity: 'sha512-7X9sEEf9f20noGBIgRhhvYnxS2dx1bEycitXkOD6XOYHijRwbu84zLY6q+Fz+FhfQhaCx/oJRVbvVTZpbZvTtQ==' },
  { key: 'shipping-dhl', version: '1.0.19', integrity: 'sha512-uB1sFpTpV5d4m7r0+ZZcv7Yr8SpGgPyexzxA0IXIke7gvQSYCtT83MZNoemOcl7/bANEXB/vgF1b9UrEs1E+9Q==' },
];
