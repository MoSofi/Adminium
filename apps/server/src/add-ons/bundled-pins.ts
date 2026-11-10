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
  { key: 'barcode-labels', version: '1.0.26', integrity: 'sha512-Sx5EsKfWwVIbciAG4vjmUSE+0w9Km2PrAwobM5cqtx/ixJcUPNMThournRcAzw0pkM7SS8wI0q6/29bmacJGQA==' },
  { key: 'customiser', version: '1.0.26', integrity: 'sha512-f9lVkp6F3xtv48FkfWzHKhMwqqjHmM3pAXlRq7XvuGPW4ryhUXLBifuigNabAG6tLB8tzMF7QaKvzcG4WTm5rg==' },
  { key: 'design-studio', version: '1.0.26', integrity: 'sha512-C+m9DDVOPJWo0mKW1G5P+ETcH7W99SOXZSQ/QC+KRh/ODT1sI1WXsToh+uYGQaPZu+fq5pAjpXrXQtWEkGRduA==' },
  { key: 'forms', version: '1.0.26', integrity: 'sha512-oQVTiz9V2MilxYqqAifVfqDFXExfVNKz/xyglaF3ifP/80ajqwIDvc4F1wHPpwQ9e04exbhidTpkg1kA0YkbLA==' },
  { key: 'holiday-calendars', version: '1.0.26', integrity: 'sha512-zj7PP6JSyFNPCdjGolnhARi0z/SwxvDhwiGU9hD9j5nfsPuNj1cVje8osNrhbd6kUJSns56CLNyNbiGq2s0mpQ==' },
  { key: 'import-canva', version: '1.0.26', integrity: 'sha512-r7XM+VR9467bl20xsLhr+/sqREQ5wJ3cwV6I8jWKTfkYO4qRCHj/Nl4+Macu68FiseOH+YqYgKH73cHNgQeUSw==' },
  { key: 'inventory', version: '1.0.26', integrity: 'sha512-f0BmYlAvhKSIuOwLfLXVYE3S6NlQ7+MiwP59gcSTbBNfXz4nf2foB5undG8hMZ0/LdHp5WFA/bJlZZELTfxK4g==' },
  { key: 'invoices', version: '1.0.26', integrity: 'sha512-Q6ROpu6KsUyxCzbNyCDE3vnFlD4oaUs5bxdRbbNIrwvvRdoNGMRNg1yb9tlS0dkPNP13fHYCWmdF7p7j9kkFYg==' },
  { key: 'offers', version: '1.0.26', integrity: 'sha512-eomxpuFCHtx6/0MDdUZdaa3thYytsmrJys+yLsR6lpQmsSkt4H5NIGHRT7PAZnNHxAmaEL/KTPQw1/UPBuTLgg==' },
  { key: 'payments-paypal', version: '1.0.26', integrity: 'sha512-HDhrRrGYhhggXvF9JXlPG9EshgbIgF7Gq2XcEEipaVBluKW7CH02vZZ+JAk/wk6KNShbrty0oMEjomigmLuOag==' },
  { key: 'payments-stripe', version: '1.0.26', integrity: 'sha512-k5COKAuTT2GRiAjAd6PCCp/jVyVGWOG4XStCtMXO9BSsjHmcpmE83SkqRTym1sZ++yuG1zo+vy8SKCy58J07qg==' },
  { key: 'personalizer', version: '1.0.26', integrity: 'sha512-0jDUWJHUN5UWubjjYp0/aa8TlQeBprdfu+oLb096HuW/6az5/Y90iT2HHqLLdhggR7MF97YkoHaQ463tDZXRDw==' },
  { key: 'shipping-dhl', version: '1.0.26', integrity: 'sha512-HMolOa0RqkCrQgegOD5PzXgyARDYvRuGU0mDrbTimFJE6lXpWtHX8X2M9VUsFOVejqggI4jXKZiG8cWZnU94fw==' },
];
