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
  { key: 'barcode-labels', version: '1.0.21', integrity: 'sha512-5sd5/YDn8yDlEFSdxy34t2cSDIC8WQUlJ5q8aBpRAs6DqJQoydSmyZvVzKCUy1Uou6bpKgRaifsBDFyfToSEWA==' },
  { key: 'customiser', version: '1.0.21', integrity: 'sha512-FX6jhT2QbHxTtshbNxM4/heRujR2v7Uv9TrBz2JRDXdcqkPhJlLFIKgHv7NpWRBhCfBH6HMBAX7K1beJCuB4sQ==' },
  { key: 'design-studio', version: '1.0.21', integrity: 'sha512-hcV9zA9ZwoUDUF3TJWVusAazfHdWefHyKTATZPrrM3gdFA/ePsVzlyuShXWbJkUQbw5nGVZlpk8D5qGCwIL3OQ==' },
  { key: 'forms', version: '1.0.21', integrity: 'sha512-SudgZPjErsVWI+b55sA/JcBq/OCeYN6Ye92QsEvLgDcpmos8/hnxYu1KUPA/XlH2eJMwjuNrPeiP5VrhJ3abug==' },
  { key: 'holiday-calendars', version: '1.0.21', integrity: 'sha512-8Da5nB+P9WQ/umCf4VrvNuwW0MejXOJgsr23yxdvaxtGWUx86n5iy8RhRAqibh+AqAJ60MUVOz30u+z4HQWNgQ==' },
  { key: 'import-canva', version: '1.0.21', integrity: 'sha512-zb2B9qk187aZLHSTNyQTJ3j7RX9vNup9Cbjz6nFOe0ZxW4c9Vq1gck13N1ulcRG9Gf2EH089mmIzPfRnjtSMaw==' },
  { key: 'inventory', version: '1.0.21', integrity: 'sha512-NytLdTTCl+SfapAyWpJXMo8FRIjdGG/Rx1GFPT8Vfg4iLCTvA+3RvQiLhuOGzOI/cdnTSETFp3A69gDl1jqDxA==' },
  { key: 'invoices', version: '1.0.21', integrity: 'sha512-7pRMdk4NtjtJhNJllMoSzwA8bn3nzGBK+yHRARcuym/lQLAsY+PBjY0WE6N/Az/5zQyeyHs9nZbmT+Anjt8eXA==' },
  { key: 'offers', version: '1.0.21', integrity: 'sha512-KBdBz29AZnOWf7jumhyULpfetYTJUhJLmN4VwHDrsVYgbM4+3hPjUeV99kxk3et1dqsSSSR41mx40jR0va2Lsg==' },
  { key: 'payments-paypal', version: '1.0.21', integrity: 'sha512-lUCtAcj4bwVOF5h1C+22aEqPvg5MujH2ID5BVy0NsTW7mCFRM92xblQ1QSgO7IyQ8yRIs+MqTe1ELvOibuLf+g==' },
  { key: 'payments-stripe', version: '1.0.21', integrity: 'sha512-XLqK2Ci8jlfriOlSb/klZtyRM7PJCP+T4FHiJ7x+rfQqyxd8lmiHNWhZj7UXXG3IawxnQJvdrVuJvoTutTyD+Q==' },
  { key: 'personalizer', version: '1.0.21', integrity: 'sha512-YErLF51H2R+uuomZDpjXOBg+KSg7c16O+rIzkb4ebTqVYV/OXSaxI9apwJ80mIL26w1fSlVwKtXfVyvKAgokKA==' },
  { key: 'shipping-dhl', version: '1.0.21', integrity: 'sha512-GXTFRSs1CZLNAjShlavUKHBMAI2zkyDAIfu6TfRFXrsrSUjMsvPFoATf2u8T4o/gM5ERo4qx/0bJAk/UA3YiTA==' },
];
