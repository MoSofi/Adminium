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
  { key: 'barcode-labels', version: '1.0.34', integrity: 'sha512-Dkp3XGDkEhebxqywUTu76Dol40FM6aQeQA/e6LxZ/SqRkCv1UuME/GwBRM1We/p/Uv8ICKeJ+I3LHzJz2wCcUQ==' },
  { key: 'customiser', version: '1.0.34', integrity: 'sha512-W3wU1ozi0jEy4xw/ja9WRwe0gtbs3q3sh646XkiBY7QeIEG8pJACCKENGi6sAnDRcecmwsGnSPbsAon4Y9ty2A==' },
  { key: 'design-studio', version: '1.0.34', integrity: 'sha512-/SHcrh00sJE/Rdqx4htXkOP/zSp5cAvVWxdxObQWA2tuTW7cUO5eXCAF+HEbcaQNARLYlZKO+9loND9BNKJt4Q==' },
  { key: 'forms', version: '1.0.34', integrity: 'sha512-AMW3iHEYYuRMAJTrLL4NqqlZruYwUk+Kf2v7QFI5dtUT0oD8bfMCrap66W/PY0v1t7VSXxb1nKGsXzZcaoA8qg==' },
  { key: 'holiday-calendars', version: '1.0.34', integrity: 'sha512-9WCLqlUjagno4aBI84JthzDUvVx+9qWVBMJCe6/jetvu8wFQCkJtWfljYltGfrqXdaBEela7ZzKiI6o0O9/vKg==' },
  { key: 'import-canva', version: '1.0.34', integrity: 'sha512-i1GVu/dMNluhM/Hj/KbQIidfFpmRjDhd382wPEBMl1eBPEchoP3ASx9rpmEAY3eObrzsoABzU2X9n0kskXLAqA==' },
  { key: 'inventory', version: '1.0.34', integrity: 'sha512-tUmkfjYWH9LCdTHFFRmt/cvY0aImO7ZCo8BYDd47CM46CAhjNY38VgKlUVKxXa58gwdMvgC39CAtpopzPGYkDg==' },
  { key: 'invoices', version: '1.0.34', integrity: 'sha512-c25VnjEA5fSuVKNictr22ZfKHnQaW/dLztaeSzOm5aUr6OeO5qPZWgC4MPJ2bbKD/NxY4uQbtu115l9yfgOcbQ==' },
  { key: 'live-chat', version: '1.0.34', integrity: 'sha512-zfEogx2aBjYLc2ptgKRtj1WqD3up8ZuXQ9fBlXA3WkWAIecnyK4zy84herAHvl/Fgya4A7qbBgqT8fMN6/htjw==' },
  { key: 'offers', version: '1.0.34', integrity: 'sha512-RBUOa96O7l/i0rMg7TPC32Z1CIzyze1cVO/cY7CkEK9G9J3QVIe+D0rAvR5OKiHMg8MYJcMclt3Krl8BiBn0ow==' },
  { key: 'pages', version: '1.0.34', integrity: 'sha512-s/OqAvsuRyKqgUAnktl/nGm99njPcwthgarYHSfmWxeA6mN4py9aScHqIcuGc7646I3FT33qytRo6JuGpifpGQ==' },
  { key: 'payments-paypal', version: '1.0.34', integrity: 'sha512-Mz2F/kE0phIY0eXAeNcx0Dhtp4R/fSn0aOAfslfTG/+zEXw4h1keVV/U4o1n0LO+z7VxB6YgjZQfbFJD2pprwQ==' },
  { key: 'payments-square', version: '1.0.34', integrity: 'sha512-f4Y4mo1ilGrB1R+SYlGQ/PPfiveM4yTAGB+6/ioTcNA0YoD+TP0cqgtu0ys4y8Dy294khy2kn64WMlbiKgMQLw==' },
  { key: 'payments-stripe', version: '1.0.34', integrity: 'sha512-xNGKZ4YGq18q8CAS4CuaFS+YMQtk9ESZgY1LEA4DfRQi+jDzN8Q6HxdiVyheS94DZPoeGStiY17hewohqkOaOA==' },
  { key: 'personalizer', version: '1.0.34', integrity: 'sha512-kfOARoF+gmSm1Bqkr9ntVNZHaI8HgAswi3RYu9QuBOpG/kYGG3yLW3do85v+areQ449NjQm/f+qx/CDfIEoCyw==' },
  { key: 'shipping-dhl', version: '1.0.34', integrity: 'sha512-KTkCYJfAJ+sGP0EdqRtqdF8gGsnuV5TN7kZl7Xs71s68K2SY8YsQk+qd130olRGLP3WE+EsjI4SmE0CJFiqyHg==' },
];
