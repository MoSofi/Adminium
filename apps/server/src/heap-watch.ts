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
 * Process-wide: a meta relocation rebuilds the server, never this.
 */
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
}

export function readHeap(): HeapReading {
  const stats = getHeapStatistics();
  return {
    usedMb: Math.round(stats.used_heap_size / MB),
    limitMb: Math.round(stats.heap_size_limit / MB),
    rssMb: Math.round(process.memoryUsage.rss() / MB),
  };
}

/** True when the heap has less than the headroom left. */
export function heapIsTight(reading: HeapReading, headroomMb: number = HEAP_HEADROOM_MB): boolean {
  return reading.limitMb - reading.usedMb < headroomMb;
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
    if (at - loggedAt >= HEAP_LOG_EVERY_MS) {
      loggedAt = at;
      log.info({ heapUsedMb: reading.usedMb, heapLimitMb: reading.limitMb, rssMb: reading.rssMb }, 'memory');
    }
    const tight = heapIsTight(reading);
    if (tight && tightBefore && at - warnedAt >= HEAP_LOG_EVERY_MS) {
      warnedAt = at;
      log.warn(
        { heapUsedMb: reading.usedMb, heapLimitMb: reading.limitMb, rssMb: reading.rssMb },
        `The server's JavaScript heap is nearly full: ${String(reading.usedMb)} MB in use of the ${String(reading.limitMb)} MB Node.js allows it, ` +
          `and it stops when the heap runs out. Give it more: set NODE_OPTIONS=--max-old-space-size=${String(nextHeapMb(reading.limitMb))} ` +
          `(and let the machine or container have at least ${String(nextHeapMb(reading.limitMb) + 512)} MB).`,
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
