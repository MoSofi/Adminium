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
  { key: 'barcode-labels', version: '1.0.37', integrity: 'sha512-ryosgKH2bFt6bRDJk8fyYrsQ/Ny7UqBWm8eGwthXkFRuEbJ/R9ayNRg4b3okPZQw5B9hE9ph9GL9LqDfygSurQ==' },
  { key: 'customiser', version: '1.0.37', integrity: 'sha512-y48hXmrexmscjQz5UqfhvCGlFlA9OJgDolq8GVcz9G1Lvs+UJH0krqr0q4aC8RPOhkf/YuXt8KAqE3zCbSJXhA==' },
  { key: 'design-studio', version: '1.0.37', integrity: 'sha512-8QMAbiKemQLKRnxo7bpA8gV6kODs+GcNfu9RVokcSQZ75A4TGsbs6LUtE4+9mEU7Q6hcsTie3dk5ZHU6ptvrLA==' },
  { key: 'forms', version: '1.0.37', integrity: 'sha512-T52fT7N2/v7KyFmeE5QK47J43etThJQ46qQz64emwhha5JjGVrZlyDWdI78Jrg8BoPMvhJ9BbRcxJvnBw8tpkw==' },
  { key: 'holiday-calendars', version: '1.0.37', integrity: 'sha512-SVcQf3ma4QWmCLY7rLYmQU/puVvT7XmFlJnFDWk1Edn/JwFVHTBsTyQw886GtKrS1ixAotbZpfxJpscdjg+XWA==' },
  { key: 'import-canva', version: '1.0.37', integrity: 'sha512-meFICSj0k0APX1gQoPWbcmGcMUOv/oEkQYiTUUVsMqAHgfr8P1y7Doo7m76vuNxDAEeM+5YaFFpf+gZCpZnBnA==' },
  { key: 'inventory', version: '1.0.37', integrity: 'sha512-uhl49VzNkdFunCq14HZa8I58J9BFfCRGEr8e9MkBW/DQxzEnM3PsmTrt+WmAVjJz2d/4iopD8dBwMELRyGXINw==' },
  { key: 'invoices', version: '1.0.37', integrity: 'sha512-HhtNu4A/qozrU4ybjO9MEK75+4UvL9l4U5ZegLaQAxzSh2d0qZmLveWIRo/5G+kArKo9soF/t8qR7FtzBhli5A==' },
  { key: 'live-chat', version: '1.0.37', integrity: 'sha512-fhiYHbqkmyy6mtNrp93/iD8yCep5F+TMAAxbOOhk/mIzzNqFMt36lEP1cS8Ua9oyOL4/auh+lsrK+vQYQ0VsRA==' },
  { key: 'offers', version: '1.0.37', integrity: 'sha512-IyUhFttLolWG9fCUKMoTBWLIYmJ9EjtF7Zz1tXR+OGbmr5TK9Z2kVl5Suf61Dkxca+xcUBJyF986Rf5Phw4K+Q==' },
  { key: 'pages', version: '1.0.37', integrity: 'sha512-a0U3CiexJ8SVH7fwmUC3AMMfQlHDAd6CMfQylRak6hc15MIahk9Dsn/7UiK7dWnW17C6JiI7GFrZpJrR4Me2iA==' },
  { key: 'payments-paypal', version: '1.0.37', integrity: 'sha512-g1FIUxppdh5QRqF+cEchp0xc7yGcInGfRjy0FeBOrIFHFTpd3acrzM419EC+aHj5zp8UkFHdff0yj/tbGN4CmA==' },
  { key: 'payments-square', version: '1.0.37', integrity: 'sha512-LHTTId3seHYlvo/fJEQWA+akHfHIzHO5LRgM/ZpleN3PeFaBmT1IO1hKII/LP4uAznYfFT+gPJeVP/JArytp9g==' },
  { key: 'payments-stripe', version: '1.0.37', integrity: 'sha512-eoi9uRWCr2RTOOUMyG776xq3a5yMoLCE4GBibURdz/+0OgT1kYAb262ggr262fAGyufISWgtKIlgjUTr2IE65g==' },
  { key: 'personalizer', version: '1.0.37', integrity: 'sha512-5D80Y8qOSA6Rfozl3tAHjrmiNoZYzRpSLiaQOwSqi34jG2udkzRHn/Rog8xejB5tChaUtx5e6FjJzECkIUepyA==' },
  { key: 'shipping-dhl', version: '1.0.37', integrity: 'sha512-K7amV6gnWBiqO2WFgi570TJN1pYiFn4dVCMEJzmXFVpZ68+34fXybjyZmj5qAoVhxIFQ1egDq8lOc8R+wUywHA==' },
];
