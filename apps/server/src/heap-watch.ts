// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How full this process's JavaScript heap is, said in the log.
 *
 * ─── WHY ───────────────────────────────────────────────────────────────────
 *
 * Node.js gives a process on a small machine a heap of about 259 MB, whatever
 * the machine's memory beyond that (V8's floor: a quarter of the memory, but
 * never under 256 MB of old space). That is the heap a 1 GB server, or a
 * container capped at 384 MB, gets. The engine itself holds about 240 MB once
 * it has started (0.3.32: mostly its request and payload schemas), so such a
 * server starts with ~16 MB to spare; the code compiled as screens are used
 * and one large answer later, it stops with "JavaScript heap out of memory"
 * and nothing said before. Measured in plan 70 (A8): no store grew, the heap
 * was simply full.
 *
 * So the server says it: once a minute after start, and then every five
 * minutes, it compares the heap in use with the heap allowed, and warns (at
 * most hourly) when less than {@link HEAP_HEADROOM_MB} is left twice in a row,
 * naming the setting that gives it more. An hourly `memory` line records the
 * heap and the process size, so a crash can be read back from the log.
 *
 * In a container the process can be stopped before its heap is full: the
 * container's memory limit (its cgroup) counts the whole process, and a 512 MB
 * heap in a 768 MB container leaves little for the rest. So the watch also
 * reads that limit, when there is one, and warns when the process comes within
 * {@link containerHeadroomMb} of it, a share of the limit rather than a fixed
 * number, so a small container and a large one are each warned in time.
 *
 * Process-wide: a meta relocation rebuilds the server, never this.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getHeapStatistics } from 'node:v8';

/**
 * Less than this left between the heap in use and the heap allowed is a
 * warning. Node's "heap allowed" (`heap_size_limit`) counts the young
 * generation's room too (48 MB on a 64-bit Node 22 at full size), while the
 * process stops when the OLD generation is full: `--max-old-space-size=256`
 * reports 304 MB allowed, and a server with 239 MB in use has 17 MB, not 65,
 * before it stops. So the margin is that 48 MB and 48 MB more.
 */
export const HEAP_HEADROOM_MB = 96;
/** How long after start the first look waits, so start-up garbage is not counted. */
export const HEAP_FIRST_LOOK_MS = 60_000;
/** How often the heap is looked at. */
export const HEAP_LOOK_EVERY_MS = 5 * 60_000;
/** How often the `memory` line is written, and the warning at most repeated. */
export const HEAP_LOG_EVERY_MS = 60 * 60_000;

const MB = 1024 * 1024;

/**
 * The heap ceiling to suggest next: the next power of two (512 MB at least) above
 * what Node allows now plus some room — 512 from the ~259 MB Node picks on a 1 GB
 * machine, 1024 from the image's own 512.
 */
export function nextHeapMb(limitMb: number): number {
  let next = 512;
  while (next <= limitMb + 128) next *= 2;
  return next;
}

export interface HeapReading {
  /** The heap in use, in MB. */
  usedMb: number;
  /** The most the heap may grow to, in MB (`--max-old-space-size` and the young generation). */
  limitMb: number;
  /** The whole process's resident size, in MB. */
  rssMb: number;
  /** The memory limit of the container (cgroup) the process runs in, in MB; null when there is none. */
  containerLimitMb?: number | null | undefined;
}

/** Where Linux shows the cgroups. */
export const CGROUP_ROOT = '/sys/fs/cgroup';
/** A limit this large is cgroup v1's way of saying "none". */
const NO_LIMIT_BYTES = 2 ** 60;

/**
 * The memory limit of this process's cgroup, in MB, or null when there is none
 * (no container, an unlimited one, or not Linux).
 *
 * cgroup v2 (Docker on current Linux, systemd's `MemoryMax`): `memory.max` in
 * the process's own group, else at the root (a container sees its own group
 * there). cgroup v1: `memory.limit_in_bytes` the same two ways. `root` and
 * `selfCgroup` are for tests.
 */
export function readContainerLimitMb(root: string = CGROUP_ROOT, selfCgroup: string = '/proc/self/cgroup'): number | null {
  const read = (path: string): string | null => {
    try {
      return readFileSync(path, 'utf8').trim();
    } catch {
      return null;
    }
  };
  const groups = (read(selfCgroup) ?? '').split('\n').map((line) => line.split(':'));
  const v2 = groups.find((parts) => parts[0] === '0' && parts[1] === '')?.[2];
  const v1 = groups.find((parts) => (parts[1] ?? '').split(',').includes('memory'))?.[2];
  const candidates = [
    ...(v2 === undefined || v2 === '/' ? [] : [join(root, v2, 'memory.max')]),
    join(root, 'memory.max'),
    ...(v1 === undefined || v1 === '/' ? [] : [join(root, 'memory', v1, 'memory.limit_in_bytes')]),
    join(root, 'memory', 'memory.limit_in_bytes'),
  ];
  for (const path of candidates) {
    const value = read(path);
    if (value === null) continue;
    if (value === 'max') return null;
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) continue;
    return bytes >= NO_LIMIT_BYTES ? null : Math.round(bytes / MB);
  }
  return null;
}

export function readHeap(): HeapReading {
  const stats = getHeapStatistics();
  return {
    usedMb: Math.round(stats.used_heap_size / MB),
    limitMb: Math.round(stats.heap_size_limit / MB),
    rssMb: Math.round(process.memoryUsage.rss() / MB),
    containerLimitMb: readContainerLimitMb(),
  };
}

/** True when the heap has less than the headroom left. */
export function heapIsTight(reading: HeapReading, headroomMb: number = HEAP_HEADROOM_MB): boolean {
  return reading.limitMb - reading.usedMb < headroomMb;
}

/** How close the process may come to its container's limit before a warning: an eighth of it, 64 MB at least. */
export function containerHeadroomMb(containerLimitMb: number): number {
  return Math.max(64, Math.round(containerLimitMb / 8));
}

/** True when the process has less than {@link containerHeadroomMb} left below its container's limit. */
export function containerIsTight(reading: HeapReading): boolean {
  const limit = reading.containerLimitMb;
  if (limit === null || limit === undefined) return false;
  return limit - reading.rssMb < containerHeadroomMb(limit);
}

/** The container limit to suggest next: the next 256 MB step at least 256 MB above the one it has. */
export function nextContainerMb(containerLimitMb: number): number {
  return Math.ceil((containerLimitMb + 256) / 256) * 256;
}

export interface HeapLog {
  info(fields: object, message: string): void;
  warn(fields: object, message: string): void;
}

export interface HeapWatchOptions {
  read?: () => HeapReading;
  now?: () => number;
  /** Test seam: schedules `run` after `ms` and every `every` ms after that; answers a stop. */
  schedule?: (run: () => void, ms: number, every: number) => () => void;
}

function realSchedule(run: () => void, ms: number, every: number): () => void {
  let interval: NodeJS.Timeout | undefined;
  const first = setTimeout(() => {
    run();
    interval = setInterval(run, every);
    interval.unref();
  }, ms);
  first.unref();
  return () => {
    clearTimeout(first);
    if (interval !== undefined) clearInterval(interval);
  };
}

let watching: (() => void) | null = null;

/** Starts the watch once per process; a second call (a relocated server) keeps the first. Answers a stop. */
export function watchHeap(log: HeapLog, options: HeapWatchOptions = {}): () => void {
  if (watching !== null) return watching;
  const read = options.read ?? readHeap;
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? realSchedule;
  let tightBefore = false;
  let warnedAt = Number.NEGATIVE_INFINITY;
  let loggedAt = Number.NEGATIVE_INFINITY;

  const look = (): void => {
    let reading: HeapReading;
    try {
      reading = read();
    } catch {
      return;
    }
    const at = now();
    const container = reading.containerLimitMb ?? null;
    const fields = { heapUsedMb: reading.usedMb, heapLimitMb: reading.limitMb, rssMb: reading.rssMb, ...(container === null ? {} : { containerLimitMb: container }) };
    if (at - loggedAt >= HEAP_LOG_EVERY_MS) {
      loggedAt = at;
      log.info(fields, 'memory');
    }
    const heapTight = heapIsTight(reading);
    const tight = heapTight || containerIsTight(reading);
    if (tight && tightBefore && at - warnedAt >= HEAP_LOG_EVERY_MS) {
      warnedAt = at;
      log.warn(
        fields,
        heapTight
          ? `The server's JavaScript heap is nearly full: ${String(reading.usedMb)} MB in use of the ${String(reading.limitMb)} MB Node.js allows it, ` +
              `and it stops when the heap runs out. Give it more: set NODE_OPTIONS=--max-old-space-size=${String(nextHeapMb(reading.limitMb))} ` +
              `(and let the machine or container have at least ${String(Math.max(nextHeapMb(reading.limitMb) + 512, container ?? 0))} MB).`
          : `The server is using ${String(reading.rssMb)} MB of the ${String(container)} MB its container may use, ` +
              `and the container stops it when that runs out. Give the container more memory: at least ${String(nextContainerMb(container ?? 0))} MB.`,
      );
    }
    tightBefore = tight;
  };

  const stop = schedule(look, HEAP_FIRST_LOOK_MS, HEAP_LOOK_EVERY_MS);
  watching = () => {
    stop();
    watching = null;
  };
  return watching;
}
