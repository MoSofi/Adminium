// SPDX-License-Identifier: AGPL-3.0-only
/**
 * §9's "5 MB × 5 rotation" and the stdout/stderr piping.
 *
 * These run against a REAL temp directory rather than a mocked `node:fs`. The
 * bugs worth catching here — an off-by-one that drops the newest archive, a
 * rename chain that overwrites itself, a size counter that drifts from the file
 * — are all bugs in how the code uses the filesystem, and a mock that returns
 * whatever the implementation asked for would reproduce every one of them
 * faithfully. The directory is a few kilobytes and the suite is milliseconds.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  archivePath,
  createDesktopLogging,
  createMemoryLogSink,
  MAIN_LOG_FILENAME,
  pipeStreamToLog,
  RotatingFileLog,
  SERVER_LOG_FILENAME,
  type ReadableLike,
} from './logging.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adminium-logs-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const logFile = (): string => join(dir, 'adminium-server.log');
const read = (path: string): string => readFileSync(path, 'utf8');

describe('archivePath', () => {
  it('inserts the index before the extension', () => {
    expect(archivePath('/logs/adminium-server.log', 2)).toBe('/logs/adminium-server.2.log');
  });

  it('appends when there is no extension', () => {
    expect(archivePath('/logs/serverlog', 1)).toBe('/logs/serverlog.1');
  });

  it('is not fooled by a dot in a parent directory', () => {
    expect(archivePath('/home/ava/.adminium/server', 1)).toBe('/home/ava/.adminium/server.1');
  });
});

describe('RotatingFileLog', () => {
  it('creates the directory and appends timestamped lines', () => {
    const log = new RotatingFileLog({ file: join(dir, 'nested', 'deep', 'a.log') });
    log.write('hello');

    const contents = read(join(dir, 'nested', 'deep', 'a.log'));
    expect(contents).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z hello\n$/);
  });

  it('does not double the newline on an already-terminated line', () => {
    const log = new RotatingFileLog({ file: logFile() });
    log.write('from a stream\n');

    expect(read(logFile()).endsWith('from a stream\n')).toBe(true);
    expect(read(logFile())).not.toContain('\n\n');
  });

  it('rotates once the live file would exceed maxBytes', () => {
    const log = new RotatingFileLog({ file: logFile(), maxBytes: 120, maxFiles: 3 });

    log.write('x'.repeat(50));
    expect(existsSync(archivePath(logFile(), 1))).toBe(false);

    log.write('y'.repeat(50));
    // 2 × (~28 stamp + 50 + 1) ≈ 158 > 120, so the second write rotated first.
    expect(existsSync(archivePath(logFile(), 1))).toBe(true);
    expect(read(archivePath(logFile(), 1))).toContain('x'.repeat(50));
    expect(read(logFile())).toContain('y'.repeat(50));
  });

  it('never lets the live file exceed maxBytes across many writes', () => {
    const maxBytes = 200;
    const log = new RotatingFileLog({ file: logFile(), maxBytes, maxFiles: 4 });

    for (let index = 0; index < 60; index += 1) log.write(`line ${String(index)} ${'.'.repeat(20)}`);

    expect(statSync(logFile()).size).toBeLessThanOrEqual(maxBytes);
  });

  it('keeps exactly maxFiles files and drops the oldest', () => {
    const log = new RotatingFileLog({ file: logFile(), maxBytes: 60, maxFiles: 3 });

    for (let index = 0; index < 20; index += 1) log.write(`entry-${String(index)}`);

    // live + .1 + .2 == 3.
    expect(existsSync(logFile())).toBe(true);
    expect(existsSync(archivePath(logFile(), 1))).toBe(true);
    expect(existsSync(archivePath(logFile(), 2))).toBe(true);
    expect(existsSync(archivePath(logFile(), 3))).toBe(false);
  });

  it('shifts archives so .1 is always the newest', () => {
    const log = new RotatingFileLog({ file: logFile(), maxBytes: 60, maxFiles: 3 });

    log.write('oldest');
    log.write('middle');
    log.write('newest');

    expect(read(archivePath(logFile(), 1))).toContain('middle');
    expect(read(archivePath(logFile(), 2))).toContain('oldest');
    expect(read(logFile())).toContain('newest');
  });

  it('writes an oversized line whole rather than truncating it', () => {
    // A stack trace longer than the budget is exactly the line you opened the
    // log to read.
    const log = new RotatingFileLog({ file: logFile(), maxBytes: 50, maxFiles: 3 });
    const huge = 'E'.repeat(500);
    log.write(huge);

    expect(read(logFile())).toContain(huge);
  });

  it('resumes an existing file instead of truncating it', () => {
    // The relaunch-after-crash case: the previous run's log IS the crash report.
    new RotatingFileLog({ file: logFile() }).write('from the run that crashed');
    const reopened = new RotatingFileLog({ file: logFile() });
    reopened.write('from the run after');

    const contents = read(logFile());
    expect(contents).toContain('from the run that crashed');
    expect(contents).toContain('from the run after');
    expect(reopened.size).toBe(Buffer.byteLength(contents));
  });

  describe('recentLines', () => {
    it('returns the tail, oldest first', () => {
      const log = new RotatingFileLog({ file: logFile() });
      for (const line of ['a', 'b', 'c']) log.write(line);

      const lines = log.recentLines(2);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('b');
      expect(lines[1]).toContain('c');
    });

    it('survives rotation — the excerpt outlives the file it came from', () => {
      const log = new RotatingFileLog({ file: logFile(), maxBytes: 60, maxFiles: 2 });
      log.write('the reason it crashed');
      log.write('noise');

      expect(log.recentLines(5).join('\n')).toContain('the reason it crashed');
    });

    it('is bounded by tailLines', () => {
      const log = new RotatingFileLog({ file: logFile(), tailLines: 3 });
      for (let index = 0; index < 50; index += 1) log.write(String(index));

      const lines = log.recentLines();
      expect(lines).toHaveLength(3);
      expect(lines[2]).toContain('49');
    });

    it('returns everything when asked for more than it has', () => {
      const log = new RotatingFileLog({ file: logFile() });
      log.write('only');
      expect(log.recentLines(100)).toHaveLength(1);
    });
  });
});

describe('createMemoryLogSink', () => {
  it('keeps a tail and says it has no file', () => {
    const sink = createMemoryLogSink(2);
    sink.write('a');
    sink.write('b');
    sink.write('c');

    expect(sink.recentLines()).toEqual(['b', 'c']);
    expect(sink.path).toContain('no log file');
  });
});

/** A `Readable` that only does what {@link pipeStreamToLog} uses. */
interface FakeStream extends ReadableLike {
  emit(event: 'data', chunk: Buffer | string): void;
  emit(event: 'end'): void;
}

function fakeStream(): FakeStream {
  const dataHandlers: Array<(chunk: Buffer | string) => void> = [];
  const endHandlers: Array<() => void> = [];
  return {
    on(event: 'data' | 'end', listener: (chunk?: Buffer | string) => void): unknown {
      if (event === 'data') dataHandlers.push(listener as (chunk: Buffer | string) => void);
      else endHandlers.push(listener as () => void);
      return this;
    },
    emit(event: 'data' | 'end', chunk?: Buffer | string): void {
      if (event === 'end') {
        for (const handler of [...endHandlers]) handler();
        return;
      }
      for (const handler of [...dataHandlers]) handler(chunk ?? '');
    },
  } as FakeStream;
}

describe('pipeStreamToLog', () => {
  it('writes one record per line, prefixed', () => {
    const sink = createMemoryLogSink();
    const stream = fakeStream();
    pipeStreamToLog(stream, sink, '[server:out]');

    stream.emit('data', 'first\nsecond\n');

    expect(sink.recentLines()).toEqual(['[server:out] first', '[server:out] second']);
  });

  it('holds a partial line until its newline arrives', () => {
    // A 4 KB pipe read can end mid-JSON. Writing each chunk as a "line" shreds
    // long stack traces across records exactly when they are being read.
    const sink = createMemoryLogSink();
    const stream = fakeStream();
    pipeStreamToLog(stream, sink, '[server:err]');

    stream.emit('data', '{"msg":"half');
    expect(sink.recentLines()).toEqual([]);

    stream.emit('data', ' of a line"}\n');
    expect(sink.recentLines()).toEqual(['[server:err] {"msg":"half of a line"}']);
  });

  it('flushes an unterminated final line on end — the dying-mid-write case', () => {
    const sink = createMemoryLogSink();
    const stream = fakeStream();
    pipeStreamToLog(stream, sink, '[server:err]');

    stream.emit('data', 'Segmentation fault');
    stream.emit('end');

    expect(sink.recentLines()).toEqual(['[server:err] Segmentation fault']);
  });

  it('does not write anything twice if end fires after a complete line', () => {
    const sink = createMemoryLogSink();
    const stream = fakeStream();
    pipeStreamToLog(stream, sink, '[out]');

    stream.emit('data', 'done\n');
    stream.emit('end');

    expect(sink.recentLines()).toEqual(['[out] done']);
  });

  it('handles CRLF and skips blank lines', () => {
    const sink = createMemoryLogSink();
    const stream = fakeStream();
    pipeStreamToLog(stream, sink, '[out]');

    stream.emit('data', 'a\r\n\r\nb\r\n');

    expect(sink.recentLines()).toEqual(['[out] a', '[out] b']);
  });

  it('accepts Buffer chunks', () => {
    const sink = createMemoryLogSink();
    const stream = fakeStream();
    pipeStreamToLog(stream, sink, '[out]');

    stream.emit('data', Buffer.from('from a buffer\n', 'utf8'));

    expect(sink.recentLines()).toEqual(['[out] from a buffer']);
  });
});

describe('createDesktopLogging', () => {
  it('creates the two §9 logs side by side', () => {
    const logging = createDesktopLogging({ logsDir: dir });

    expect(logging.server.path).toBe(join(dir, SERVER_LOG_FILENAME));
    expect(logging.main.path).toBe(join(dir, MAIN_LOG_FILENAME));
    expect(logging.logsDir).toBe(dir);

    logging.main.write('main line');
    logging.server.write('server line');

    expect(read(logging.main.path)).toContain('main line');
    expect(read(logging.server.path)).toContain('server line');
    // Split so the server's pino firehose cannot bury the shell's own narration.
    expect(read(logging.main.path)).not.toContain('server line');
  });
});
