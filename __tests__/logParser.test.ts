import {
  cleanLog,
  stripTimestamps,
  extractFileReferences,
  extractErrorExcerpt,
  parseLog,
} from '../src/parser/logParser';

const ESC = '\u001b';

describe('cleanLog', () => {
  it('strips GitHub timestamps from every line', () => {
    const raw =
      '2024-01-02T03:04:05.1234567Z line one\n' +
      '2024-01-02T03:04:06.7654321Z line two';
    expect(stripTimestamps(raw)).toBe('line one\nline two');
  });

  it('strips ANSI colour codes', () => {
    const raw = `${ESC}[31mError:${ESC}[0m something broke`;
    expect(cleanLog(raw)).toBe('Error: something broke');
  });

  it('normalizes CRLF line endings', () => {
    expect(cleanLog('a\r\nb')).toBe('a\nb');
  });
});

describe('extractFileReferences', () => {
  it('extracts TypeScript compiler references (path:line:col)', () => {
    const log =
      'src/index.ts:12:5 - error TS2554: Expected 1 arguments, but got 0.';
    const refs = extractFileReferences(log);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ path: 'src/index.ts', line: 12, column: 5 });
  });

  it('extracts Python traceback references', () => {
    const log =
      'Traceback (most recent call last):\n' +
      '  File "app/main.py", line 42, in <module>\n' +
      "    requests.get(url, verify=False)\n" +
      'TypeError: get() got an unexpected keyword argument';
    const refs = extractFileReferences(log);
    expect(refs.map((r) => r.path)).toContain('app/main.py');
    expect(refs.find((r) => r.path === 'app/main.py')?.line).toBe(42);
  });

  it('ignores files inside node_modules / vendor directories', () => {
    const log =
      'node_modules/lodash/index.js:5:1 boom\n' +
      'vendor/pkg/file.go:7:2 boom\n' +
      'src/real.ts:3:1 boom';
    const refs = extractFileReferences(log);
    expect(refs.map((r) => r.path)).toEqual(['src/real.ts']);
  });

  it('ranks more frequently referenced files first', () => {
    const log =
      'src/a.ts:1:1 err\nsrc/b.ts:2:2 err\nsrc/b.ts:3:3 err\nsrc/b.ts:9 err';
    const refs = extractFileReferences(log);
    expect(refs[0].path).toBe('src/b.ts');
  });

  it('strips absolute runner workspace prefixes', () => {
    const log =
      '/home/runner/work/myrepo/myrepo/src/util.ts:8:4 - error TS2339';
    const refs = extractFileReferences(log);
    expect(refs[0].path).toBe('src/util.ts');
  });
});

describe('extractErrorExcerpt', () => {
  it('keeps context around error lines and drops unrelated noise', () => {
    const log = [
      'Installing dependencies',
      'added 200 packages',
      'some unrelated chatter',
      'error TS2554: Expected 1 arguments, but got 0.',
      '  at src/index.ts:12:5',
      'unrelated trailing line',
    ].join('\n');
    const excerpt = extractErrorExcerpt(log);
    expect(excerpt).toContain('error TS2554');
    expect(excerpt).toContain('src/index.ts:12:5');
  });

  it('falls back to the log tail when no error signal is present', () => {
    const log = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    const excerpt = extractErrorExcerpt(log);
    expect(excerpt).toContain('line 199');
    expect(excerpt).not.toContain('line 0');
  });
});

describe('parseLog', () => {
  it('produces cleaned text, an excerpt, and file references together', () => {
    const raw =
      '2024-01-02T03:04:05.1234567Z FAIL src/math.test.ts\n' +
      '2024-01-02T03:04:06.1234567Z   ● adds numbers\n' +
      '2024-01-02T03:04:07.1234567Z     TypeError: add is not a function\n' +
      '2024-01-02T03:04:08.1234567Z       at src/math.ts:3:10';
    const parsed = parseLog(raw);
    expect(parsed.cleaned).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(parsed.errorExcerpt).toContain('TypeError');
    expect(parsed.fileReferences.map((r) => r.path)).toContain('src/math.ts');
  });
});
