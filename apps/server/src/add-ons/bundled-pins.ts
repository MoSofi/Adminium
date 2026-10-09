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
  { key: 'barcode-labels', version: '1.0.10', integrity: 'sha512-ntRS+UK1X9U0xYKy3kJMgtBXOrqwgbhCbUwTPjd9aaQ/XEXXhZW7uVO2ix7YCaE8GQHB9iC4ZlWl3go8JaRubQ==' },
  { key: 'design-studio', version: '1.0.10', integrity: 'sha512-ox8fNesW+wnp2+JUw+aNuBjUukFIXim/uIRI4Tnqc4m8yIrxWFuVM9hFP0XKhHwqpSUET6bO8UFFb2I8+xkfhg==' },
  { key: 'holiday-calendars', version: '1.0.10', integrity: 'sha512-n2Sc8CYn0XIocSJ43NrKm1xAiobmEPYWe60PbfJwXhzY7LWMT+jrghvdvtpLqNEbtPjC4+jAIq/WhpdVTISg/Q==' },
  { key: 'import-canva', version: '1.0.10', integrity: 'sha512-Yok8R9jv/KN52V8Xy6WxfVEOsK6qxLxfPmC8A6NFERyEcdVINIJwx0GW6EGvqD0Vz6LJmt7oCtgyB+Wdefrbyw==' },
  { key: 'inventory', version: '1.0.10', integrity: 'sha512-PWOlDZwAfGnEfjBByd2hTzrDQSMS/3eikwgZ4vkZmH03slLKdZ7FReQe76OXIAZZdNVDpZda6b9VE2FGYkgr1g==' },
  { key: 'invoices', version: '1.0.10', integrity: 'sha512-v0sQfQBbcHsZ4ABR+RHfpGsUBnsD4rQ9rZTBxKAfWUGi980aygnBwPfW2aRZP2l1NTuTqeMQ1eEiZPlK6Ttgpg==' },
  { key: 'offers', version: '1.0.10', integrity: 'sha512-jJB0Mi5dNB2D4Q7bNm83HNHu37e1fQavqzUlHgB0T4QSDfS4319vY45p+cUs3/duKAgME50FTouaz6OH7HdAgQ==' },
  { key: 'personalizer', version: '1.0.10', integrity: 'sha512-OeCrF3o6sNGZ1bq4ldd29orIOfXL5BzywqVvjyHUPsLXYzWpS2YeRDy3U5hnD8O4LbizZkz2Np+0abOczB0Rhw==' },
  { key: 'shipping-dhl', version: '1.0.10', integrity: 'sha512-DxpAuS91L7uGWHb+rSrwaWUURr7/Dfzs+rNAeNfVF2Kr3HWW5NgctiBsWXy3FTF+BudywH87S8yd4jmGAL/Ovw==' },
];
