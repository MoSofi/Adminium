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
  { key: 'barcode-labels', version: '1.0.36', integrity: 'sha512-k0lOYOn3lL4dkG4atHHTlWeIJ08AY8fBoG3bROlUQSd7lzdE4KSQLEtt6BpdVS4eI29DunU+CyHeB78NH9RRUg==' },
  { key: 'customiser', version: '1.0.36', integrity: 'sha512-lCK0vR92v15qrjutDVOB83AilERGoD8GI5Z+QuuYBC6/uWBsfCRSkbcr68zhCgUy1U+jOgSeRuFUoU6Ho+V3Gg==' },
  { key: 'design-studio', version: '1.0.36', integrity: 'sha512-6xxEshPc4yA6FV0hkF+u1IOKbQ9b02RTM7dIn17iLzONKIJutrm0nBlq97wimOt9oP0EXNfMJQvRo2wcMTkbyg==' },
  { key: 'forms', version: '1.0.36', integrity: 'sha512-VmFBTz8yOvr6FFvl1ctHGZDE9kkqxL/NvaAoHHJPN/JC+/aDnp/23URaojPzkmzU7I2+XRPnKZ7PtDAzJL+JcA==' },
  { key: 'holiday-calendars', version: '1.0.36', integrity: 'sha512-fiS5UOjpKzg5zZFYqPvhnTJxEbXpasKSbATTSAVLmDjjEj3BcRuRdBeG8VJtHkZrQV1Qc37r8oNTlHkVXxBx3g==' },
  { key: 'import-canva', version: '1.0.36', integrity: 'sha512-F4JSqRZ5Lgin59merBvwRHmPnHT+Ewa5m798jTJMEuOTRQc+563R4ma9ISs0zG6tHH05x2PaMFm2IZZHxVd7Gg==' },
  { key: 'inventory', version: '1.0.36', integrity: 'sha512-X3l/kosuKY87Sk6Gw+8dx8dlKVVMcIKrXJDOuEdmjnigpHwGiqHS6l4TsODDekXOHg/g0pFwE41gnj/E5uTR3w==' },
  { key: 'invoices', version: '1.0.36', integrity: 'sha512-OsJRc2eEQxu+/LArwTYa+YQjRx43yIDGwSFMjfad7yrkZisFA9yL4xmJgY3nIh4yHDsdBteHUt46KPQLIfCpYg==' },
  { key: 'live-chat', version: '1.0.36', integrity: 'sha512-Smdm+X05764s1jHGpRxogdy3vI0YIYqUbYukxsoiqazDkM8ZKQTwNtPU/rmpJchqamR9kHlSEA9XwnKnyyXxYQ==' },
  { key: 'offers', version: '1.0.36', integrity: 'sha512-Ske0qHamAcYaOrdN51E3VVil6tmFiz3e5tIwbospBpqoWB2HdnCW29ns6FN0Wy1IG0I8cSN+CHwGBFDmaSLHcg==' },
  { key: 'pages', version: '1.0.36', integrity: 'sha512-SC/jLWp5mVD5wWqaeKIVziJ1mM80W8PxBaZlnGJznfrJSOLTH+CVV4p+MP56/9ttIMXXjFee3tow2GRXOuZ6rA==' },
  { key: 'payments-paypal', version: '1.0.36', integrity: 'sha512-ugY18WXsX+YF1AhpeKx5f+7jnwmvq6sfINOGJ3ecKl7K6CAWpiSl+CQVmBPTach/hh0jPNQ586ud6uKpdCe/Fw==' },
  { key: 'payments-square', version: '1.0.36', integrity: 'sha512-EbYXNHoMYUD3+XOvw6il7pjZN3UqU5RAB1GMAhlOL9ps6J5KCn+b88koXodyx9CkIWpE9031LYrnXxzDbYhVmg==' },
  { key: 'payments-stripe', version: '1.0.36', integrity: 'sha512-9E8ta17mWKobJdrA57fiJLwGaE/h/7jjYSmpxs7e+ivm5HPifZOF9yGUajL03FjZZsGxEaE7B5Q/Q/o7ZBs+wQ==' },
  { key: 'personalizer', version: '1.0.36', integrity: 'sha512-Tpax9McjkRE8sbmFDcFmzdzQ2KIU27k83hyCG0EjjmQbk3vTZzEhqotkyEc+1EzNiJG3h6ZXxyDrqzZ3WNP8Zg==' },
  { key: 'shipping-dhl', version: '1.0.36', integrity: 'sha512-NWx7A7+ywg2fKt7Lx95QEMSKsCpKJDl+yrVFpbOx+I6Hl5Js/z7R1P6U5hR3rNvLaR3GzHJluZrsHdUEVOTT5w==' },
];
