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
  { key: 'barcode-labels', version: '1.0.17', integrity: 'sha512-wd+3864kt8AalTEOJP9ThLBuIpoSB54LjrazlKSh94YsKp6Qee8K9brnq7NF5/7bDFPIAHeFGO0gu86stVwadQ==' },
  { key: 'customiser', version: '1.0.17', integrity: 'sha512-G0fcoC6t663a7jlYb+S8ZYLfwntmCmaC0M9Thw015RaPxNERW3GtXCadjHWSzJaiIgNcxvs4ftLX/A69KcCt4Q==' },
  { key: 'design-studio', version: '1.0.17', integrity: 'sha512-dXY4aC+uHXG1y6v4Jh7zplXxQXMG5DefQztEbEBgkVKg9IcMIj9tuQdEzPboMLSeuYBCfgTMAgd1zOgGuwlT4g==' },
  { key: 'forms', version: '1.0.17', integrity: 'sha512-MSEW5VjcV6cvLEfhKmZzkXS9AoenvIsBKiGYTPulQ28wHjDols8C8DW9UngXAmaINcLwo8Mq/xOiHEsufnYVCw==' },
  { key: 'holiday-calendars', version: '1.0.17', integrity: 'sha512-egm51UBaXW8JcCsBkuThnXmXQvae5rP2zetLNE1rPnDem5JWAADV0/QJjxYisOVyaE1Yj6BRdLotyJF7pMUpaw==' },
  { key: 'import-canva', version: '1.0.17', integrity: 'sha512-YKGFA482J2bnI56AdNzO8D2cvjCtbu0T5+RrxVWtKL0CYSqz/o+E0NShSAkGT94CGXxeoMKElLQoJAUTKhpKYQ==' },
  { key: 'inventory', version: '1.0.17', integrity: 'sha512-Eu4YH/1KZe0Ai11K8PJyU6rsB4FUg7ZbFIt6XW/1YLFcOFth97OJ2LXruciSucXs3l6j/5RURwNqcrcLrpTVGw==' },
  { key: 'invoices', version: '1.0.17', integrity: 'sha512-u6bFbBpBru1FK/9LBAT1GJTDjkJmGWBNgMqSB2ce1yz3B4Obp09pZAK7sb2RCNPMDrIGCSMuCqcMHEsBrf9FxA==' },
  { key: 'offers', version: '1.0.17', integrity: 'sha512-+ABEAawIJ1HWfLLRbGCF3p/Lhm3JQS1r51s/jp/CWEUarn2DpRaitI2LGpHnEUHf8XkUjdRFBtOMDYqeZ4ckSg==' },
  { key: 'payments-paypal', version: '1.0.17', integrity: 'sha512-pIuGC7IxXXZ0kMquZ6MaGsTLGFehTae+a6olZefOEHwM2oat176HGua0smFYtd2G767Nqe2l+cOEJJ0JRnxwFw==' },
  { key: 'payments-stripe', version: '1.0.17', integrity: 'sha512-1ZV3zDYAyUZgGGVcCD7Xmq+02TO9nX64eFpaSCKf5O6OOO9bmgDC327x3H1hO17sJAPdeLtDsqOphFXjGw3FXw==' },
  { key: 'personalizer', version: '1.0.17', integrity: 'sha512-yjqUnLK366g6zAaxA1gR3qsASrcp2e81yWNE0aiBT6SMgppnv2K3D3707RBTlhbzPLuQYCTmmWI7cvALO8HJ8A==' },
  { key: 'shipping-dhl', version: '1.0.17', integrity: 'sha512-01OKLiajWXt33TYLMaaQWPwMQHzxuL1zV/Xul2bOv3UgSPPHp/7zCOtGIxGLLEkihD7fwxXc61W16XqDzlpeWg==' },
];
