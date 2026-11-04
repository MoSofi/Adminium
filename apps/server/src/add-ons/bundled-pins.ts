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
  { key: 'barcode-labels', version: '1.0.16', integrity: 'sha512-s8mkkvRKLl0X7IyMMKl01JGUg0tQSJdARksRNPpKn2Um99Jr5HL/+gIv8+c73tRiATkJLZT+ragLyKqY2XJ3Vg==' },
  { key: 'customiser', version: '1.0.16', integrity: 'sha512-TkEHRSl0QraAIvwAquzcpvD/N2kvBBIsDJAbWATEOJR4JS5OW8wSW8anXXUPPRhYlE/bG+Y/dh/XBLpdwCfr9Q==' },
  { key: 'design-studio', version: '1.0.16', integrity: 'sha512-vaaZwyYnACQR8W4FdEo2IHSAsPWT4cz3HBfpu5gEFJH7+OEui4vNGPazhjnimublD1PbLdSMjfNDUZ1qmle6Nw==' },
  { key: 'forms', version: '1.0.16', integrity: 'sha512-KQYlxoIhr+I05wTE0VHQw0UumRqoyQ6HiqL/WO7mSy5oBlP3y2uMp1j4XmkGzSAGRFIJUgYtUuLyBChi404HrA==' },
  { key: 'holiday-calendars', version: '1.0.16', integrity: 'sha512-yvJ0GaOQpEfpuzOk9KoF6oPPViyOrn64JkzhPOfCeHZ+rtWEfpoFFegejKvj2KY9E8r2YQrm8VkeGB2VoYzIVQ==' },
  { key: 'import-canva', version: '1.0.16', integrity: 'sha512-Ychlv9NV0YAfYlbeFsdYCT57emuUPw5El2JLv8z2xaf5e00Ysy/qBgKhUcsAQM+nEBOlNUsULfSYgtQ2bWAFbA==' },
  { key: 'inventory', version: '1.0.16', integrity: 'sha512-s3rP/qpvo1CIaoGoLJrOs+drYFttomkj6zmXKOd4OtMd26Ng54d5rWGe42vlCH0tWlvFDMe/nsqaX5YuDNWlaA==' },
  { key: 'invoices', version: '1.0.16', integrity: 'sha512-r9Kf7oH2ahTfS5JWr+xRhBjCNiY/m+bCBgtQk3AP20eEpAnn8uTJhPW4dSuEWP31de2JBI+jwncbmbi+mFenTA==' },
  { key: 'offers', version: '1.0.16', integrity: 'sha512-KtfYMAD4AnUbJ6JAx/Vq2zFUz7q58T0y6F7pwK/kRu5uYSwCQbC6eBZgbASqB7kPyYRqST1JUQG8d6BHNL9cjw==' },
  { key: 'payments-paypal', version: '1.0.16', integrity: 'sha512-/ckUeG6BcF1c1Lz8B1pxxmkmXQWLOhEmu8tz/HDNmuEnj/Dj8UWTcS7QM8WPmXZ6gNBWtGBa8U0c1CmTcAb8bA==' },
  { key: 'payments-stripe', version: '1.0.16', integrity: 'sha512-5fm4RI5tzPIwHjArNIphcHNyVnNplzikB7xwEvHEiKdUEjkydIw1yPIh8LFrspS8ElJE0h/IjcSFfBXaH9R0hg==' },
  { key: 'personalizer', version: '1.0.16', integrity: 'sha512-EdEnytndfCxTpKViPL3sZ+nyGCgGPLfXLu+3VsfKxA/SJmeRu8lc39t5xEHKq1GeGKgETM/qiZ9Vtj6rPq+7mg==' },
  { key: 'shipping-dhl', version: '1.0.16', integrity: 'sha512-8jUC33J5KHxvYm+E4r+PGPwHqKAF6bciLCYeyzFTBfuGdn1M5cNclmDwTJzDZshbGHY0YtT+/hXa9LPGcHi26w==' },
];
