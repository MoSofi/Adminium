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
  { key: 'barcode-labels', version: '1.0.25', integrity: 'sha512-iQMgHRndgrmM8jcbZ96ja3QH1oyGxHsCHQotbWs1lXjIIud+EKoxYkcJ0pfuGxZqBM7yNB9uPP6nSyVcd+Ms4Q==' },
  { key: 'customiser', version: '1.0.25', integrity: 'sha512-L96vaeBtSQAGpVGxWP7BtktIHd6jed0hA7n8EQMoIpU0YxBgrq35pm64SZeTDzxh0Op5t4dTPLjlAoynut0ERw==' },
  { key: 'design-studio', version: '1.0.25', integrity: 'sha512-Mf9rwPupf0OuTWzP9VrSJvFcdzqWziO/bGhjS9LcuXVIoT8/PYAVhxVq967LTPSSuJDCGhTV273gr6Hz5AOXjQ==' },
  { key: 'forms', version: '1.0.25', integrity: 'sha512-xreP+YNKydH6uUNBMPO9Oy/h/SiSZnwf2QveS7jfhzw032jchkmg+U8F+ORlsgsPYCaEaqtb+uuCpfpt1KDC3g==' },
  { key: 'holiday-calendars', version: '1.0.25', integrity: 'sha512-aCYRBWKJbaT8FLFspcKwx5TWTZ2urx6+hfrhNoGwtIHG4knzK4OyNdM+gOO7UYuTLgNL4WtYX9JG6mjduQlAMw==' },
  { key: 'import-canva', version: '1.0.25', integrity: 'sha512-FdgAv0bTSY6nTbzm8ieLR9VvxM6H/9l/7THx043CVH8LkJ1DIkg39qeGI7Nko4eaViinZOGV0vJYsL0SQ4qIZQ==' },
  { key: 'inventory', version: '1.0.25', integrity: 'sha512-YXas56YFcWQybiOX39ueLndcG4nxcoJ+Ggk0KceDZxJEFZKpR/KHuY0z/WYRftOsJ7QleeSewQ18EERgep0aCw==' },
  { key: 'invoices', version: '1.0.25', integrity: 'sha512-X5O/1bFAwNeVsl0sLC0phRfS9zPdXLFrRrVM17vcTmq82uHxcGHgXcOXI4t71k2kMQ8qqz/xDhebvFk1UFI7Kw==' },
  { key: 'offers', version: '1.0.25', integrity: 'sha512-1dMdp9Kmxpuvl/Z8idYn9OCj+3Y8y8MzgFNFVGOp77FQ2ppi2FtwJ3s0pNBqFdkrHkKDvCWYdVGYehBzOvVeew==' },
  { key: 'payments-paypal', version: '1.0.25', integrity: 'sha512-XYAXNmpZHukhkUDKNqk8yfnl5MNNH+tvTCdPBsoD3iKIwDehB9+C5qYakcRqGyNEMx5EKAzYHexqWSmezpW88g==' },
  { key: 'payments-stripe', version: '1.0.25', integrity: 'sha512-CBpuQu7bQ9Lz3hGlZWUjJtwGBX0zMRpxcsTo9stVugsaQ64KFi9XxvKQ8hJ/5sRGyBWNkGQJ2aYCSua+DkkpZw==' },
  { key: 'personalizer', version: '1.0.25', integrity: 'sha512-dBhlTdubBlHPxQlWYLKyUySXWf47gHOCVguUZNuv34ykZFqXrY0L4SW8ULnEplBW9MsGNh2KD+qc9mj0RE1uIw==' },
  { key: 'shipping-dhl', version: '1.0.25', integrity: 'sha512-kXyhrbCXwzGLmlGeTLjw7pqfHgC+IKtXOCA2XmXneSlS81G3KmLpnc1tfk4Gi3EU252ysl7CPi+Y3TEeCNKEFA==' },
];
