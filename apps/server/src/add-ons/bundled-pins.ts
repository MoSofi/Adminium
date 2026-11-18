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
  { key: 'barcode-labels', version: '1.0.30', integrity: 'sha512-zbsrk7A//7mjwsOUWyNZqCkoqv4km2HPdN+//iriXbcH1xL9IbpxR5tzJO+RFIl9Pyi+Tt1GGjwyGragyD5VoQ==' },
  { key: 'customiser', version: '1.0.30', integrity: 'sha512-xVUK3XtPXTmikzz/UlfMUBSujH3zGb46lZZFboMGzlb008STLjfPRgFp2YaQ0xwCMgAGSKaAnT9bA0hSZ+H9kw==' },
  { key: 'design-studio', version: '1.0.30', integrity: 'sha512-rogsNQPW2+K9NoewyyuyrdwFH9vPBXC81XmY3RyDdvPB6AZR1zduiUpt9Jc8JhNv4NaWADgfyAtvYKHE7rpQxw==' },
  { key: 'forms', version: '1.0.30', integrity: 'sha512-5y22tfrZMho+71pN5U/t2eYT3EkPSjg4KrwUIumXntvP7nRVY25MMl55NW92/Qn/8Vi9mofZ0I6bc6cNjM7dJQ==' },
  { key: 'holiday-calendars', version: '1.0.30', integrity: 'sha512-yUL1kzPOf28OkGch0ZIHUC9eMkawQyfzt3JQLwBoMMPr7Bote8sZJY6PzWpe94MqYQFFxAmxHEc/sdtjLPNnzg==' },
  { key: 'import-canva', version: '1.0.30', integrity: 'sha512-4UhBig28d6WxOQW380/4Al1cPGEcs0h3SlVQA/Ukq7jH7nNV0JpCY9j3J+fLSSaEuj2QgpRfiE3GKt/fg5z8Lg==' },
  { key: 'inventory', version: '1.0.30', integrity: 'sha512-wR1bJRx+q8twgwclU/z6j3LnkQwHWjBgePac+2/iH/yVsn2KvVLtCsTwbs/wqOaWZFXcMDwuGi6M1xPAcBcWXA==' },
  { key: 'invoices', version: '1.0.30', integrity: 'sha512-sUdcQzo4xsfAjmB+7HJZDxDgR73ERhybEEaqAoEjFznJXWfBDBIqk2isF7TokdU2ogXe4KBfzai6jVALsMwOsA==' },
  { key: 'live-chat', version: '1.0.30', integrity: 'sha512-jy8T1ogY9NH5itYZZXgnqRtGVVsc7lf8/ZE+Sm7CIFHrfa+A0tQwcwLaB+sKItKmOu7aZQJcmUOduSTx9NhqSw==' },
  { key: 'offers', version: '1.0.30', integrity: 'sha512-D5pzxc6CAAJByEQQqIkSeaEPaxZXJO5N1ml+GYacjsTZDk1DPeU6kIWwbEx+nwvxUU5GTZ2gPW55bI4JvYCg6Q==' },
  { key: 'payments-paypal', version: '1.0.30', integrity: 'sha512-CTtUxDbWPUPs8hlvL+v5QVlt87r6lvK4XpIeG7UuHonU8GKAUYkG+bLanB6x+wqpmzYRN88p/FgTmVC8DMPOaA==' },
  { key: 'payments-square', version: '1.0.30', integrity: 'sha512-SjerEOditazvsn6qUVophVd6388XNURHy+77s2sQD03PXJKjthg7GIxTbB1Q/VRCq6+UidMhb0o1GJ+LycC53Q==' },
  { key: 'payments-stripe', version: '1.0.30', integrity: 'sha512-enHXmD+w1F6ESPOk7W8tHp//oDJel6w4r/TvgBH9BcrZlub+W9SSiMIrpqz2I3GkyQIiN7US8eZqi9wwXwNlSw==' },
  { key: 'personalizer', version: '1.0.30', integrity: 'sha512-ow6RjVHJsDVUAAW9qWsRVF1vJ8QMc0zhkKwZzeW3NfTum5xpxJGNFDo7MjwIS7jDVtSvqgDpZBHJxuQjyq/lpA==' },
  { key: 'shipping-dhl', version: '1.0.30', integrity: 'sha512-QX7uvlxOaluv87xi6M1yIin7F56QES452p/Ba30nWc3v/tlPxq/r9e1R2L3u6xZTZf6dLW1oROfCAm7I/OPDaA==' },
];
