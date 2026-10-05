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
  { key: 'barcode-labels', version: '1.0.7', integrity: 'sha512-U3atemfywOUlwXOs+1aCrNaC1ViJPGUxutKJt9iPRE0GAO7qtHCMSyoSs3X83LyG/Ex1ys0oT65VpJVr5wnPzw==' },
  { key: 'design-studio', version: '1.0.7', integrity: 'sha512-VNLfMRukz3AQPIiMB1F+9wAfth6V/Z1bDJPg3FZFSZfDQWnb03NACAiGsgTsfvCFTblRym5ZtSsUmO2rAGDm2Q==' },
  { key: 'holiday-calendars', version: '1.0.7', integrity: 'sha512-NwO3rDfRm65AuyiYAps6R83dyZx0/u1YJgDa+T6V5aWPTQwBYCRY2zcOCUYMuQjF6p/wN0DaenakvVKoyrU+QA==' },
  { key: 'import-canva', version: '1.0.7', integrity: 'sha512-9lAZVBNBNg2tc2e3GcJ4izXUWaaZSw/5AeG21v10A9o6je0Ah/tLbBkG4BgPXmmjlWJK0IHBounilvaidmzN0A==' },
  { key: 'invoices', version: '1.0.7', integrity: 'sha512-A4ktI198ftL5RgJaNz0kIU6O7RAt5prb/IUa8/Vj9madh2cuB2eswH+Zbo86FTWk3gH86FixR1sSJAFcJu3AVw==' },
  { key: 'personalizer', version: '1.0.7', integrity: 'sha512-hME/EpGm2DoBuA6gdzzqwUxsEe7Kh34q9CjBIjV6dl5JnRwiGipTOb8hQuTxAVH8euz/9PPBpFxmtpu+5r/33w==' },
  { key: 'shipping-dhl', version: '1.0.7', integrity: 'sha512-Sbu8erXXWbY4BbBa+f6ezg5JWAKc5iErKxGxO4zf5haMBURiYjYlMTAgcdEJ5T1YppU5VLkkmSPz6aaiBIy1sg==' },
];
