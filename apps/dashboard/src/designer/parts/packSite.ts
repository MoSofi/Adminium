// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A folder dropped on the message box, packed into a zip the page sends as a site template.
 *
 * The browser hands a dropped folder over as entries to walk; they are read here and packed into
 * a zip without compressing (stored), names in UTF-8. What can be said at once is said before
 * anything is read or sent: too many entries, too many bytes. The server's judge decides the rest,
 * exactly as for a zip the person made.
 */

/** As the server's limits: entries seen, and the zip's size. */
export const SITE_MAX_ENTRIES = 1000;
export const SITE_MAX_ZIP_BYTES = 25 * 1024 * 1024;

export class PackRefusal extends Error {
  override readonly name = 'PackRefusal';
  constructor(readonly reason: 'too-many' | 'too-large' | 'unreadable') {
    super(reason);
  }
}

/** The folder in a drop, if the drop is one folder; null when it is files. */
export function droppedFolder(items: DataTransferItemList | undefined): FileSystemDirectoryEntry | null {
  if (items === undefined) return null;
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry?.isDirectory === true) return entry as FileSystemDirectoryEntry;
  }
  return null;
}

const entriesOf = (dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> =>
  new Promise((resolve, reject) => {
    const reader = dir.createReader();
    const all: FileSystemEntry[] = [];
    // A reader gives its entries a batch at a time, until a batch comes back empty.
    const next = (): void =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    next();
  });

const fileOf = (entry: FileSystemFileEntry): Promise<File> => new Promise((resolve, reject) => entry.file(resolve, reject));

/** Every file under a dropped folder, by its path inside it; refused at once past the limits. */
export async function readFolder(dir: FileSystemDirectoryEntry): Promise<{ path: string; file: File }[]> {
  const files: { path: string; file: File }[] = [];
  let seen = 0;
  let bytes = 0;
  const walk = async (folder: FileSystemDirectoryEntry, prefix: string): Promise<void> => {
    for (const entry of await entriesOf(folder)) {
      seen += 1;
      if (seen > SITE_MAX_ENTRIES) throw new PackRefusal('too-many');
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory) await walk(entry as FileSystemDirectoryEntry, `${path}/`);
      else if (entry.isFile) {
        const file = await fileOf(entry as FileSystemFileEntry);
        bytes += file.size;
        if (bytes > SITE_MAX_ZIP_BYTES) throw new PackRefusal('too-large');
        files.push({ path, file });
      }
    }
  };
  try {
    await walk(dir, '');
  } catch (error) {
    if (error instanceof PackRefusal) throw error;
    throw new PackRefusal('unreadable');
  }
  return files;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 a zip stores. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Files packed as one zip, stored (not compressed), every name in UTF-8. */
export async function packZip(files: readonly { path: string; file: Blob }[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const { path, file } of files) {
    const name = encoder.encode(path);
    const data = new Uint8Array(await file.arrayBuffer());
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x800, true);
    local.setUint16(8, 0, true);
    local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x800, true);
    central.setUint16(14, 0x21, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    directory.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = directory.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, new Uint8Array(end.buffer)].map((part) => part.slice().buffer), { type: 'application/zip' });
}
