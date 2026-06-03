import { parseAiResult } from '../src/ai/openai';
import { buildMessages, SYSTEM_PROMPT } from '../src/ai/prompt';
import { parseLog } from '../src/parser/logParser';

describe('parseAiResult', () => {
  it('parses a well-formed JSON patch', () => {
    const raw = JSON.stringify({
      summary: 'Renamed the removed helper.',
      unableToFix: false,
      changes: [{ path: 'src/a.ts', content: 'export const x = 1;\n' }],
    });
    const result = parseAiResult(raw);
    expect(result.unableToFix).toBe(false);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].path).toBe('src/a.ts');
  });

  it('strips ```json fences before parsing', () => {
    const raw =
      '```json\n' +
      JSON.stringify({
        summary: 'ok',
        unableToFix: false,
        changes: [{ path: 'a.ts', content: 'x' }],
      }) +
      '\n```';
    expect(parseAiResult(raw).changes).toHaveLength(1);
  });

  it('treats invalid JSON as unable-to-fix', () => {
    const result = parseAiResult('not json at all');
    expect(result.unableToFix).toBe(true);
    expect(result.reason).toMatch(/valid JSON/i);
  });

  it('treats an empty changes array as unable-to-fix', () => {
    const result = parseAiResult(
      JSON.stringify({ summary: '', unableToFix: false, changes: [] }),
    );
    expect(result.unableToFix).toBe(true);
  });

  it('drops malformed change entries', () => {
    const result = parseAiResult(
      JSON.stringify({
        summary: 'partial',
        unableToFix: false,
        changes: [{ path: 'a.ts' }, { path: 'b.ts', content: 'ok' }],
      }),
    );
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].path).toBe('b.ts');
  });
});

describe('buildMessages', () => {
  it('includes the system prompt, dependency info, error excerpt, and files', () => {
    const parsedLog = parseLog('error TS2554 at src/index.ts:1:1');
    const messages = buildMessages({
      repo: 'octo/demo',
      dependencyChange: {
        name: 'lodash',
        fromVersion: '4.17.20',
        toVersion: '5.0.0',
        ecosystem: 'npm',
      },
      parsedLog,
      files: [{ path: 'src/index.ts', content: 'const x = 1;', truncated: false }],
    });

    expect(messages[0].content).toBe(SYSTEM_PROMPT);
    expect(messages[1].content).toContain('octo/demo');
    expect(messages[1].content).toContain('lodash');
    expect(messages[1].content).toContain('5.0.0');
    expect(messages[1].content).toContain('src/index.ts');
    expect(messages[1].content).toContain('const x = 1;');
  });

  it('handles a missing dependency change gracefully', () => {
    const messages = buildMessages({
      repo: 'octo/demo',
      dependencyChange: null,
      parsedLog: parseLog('some error'),
      files: [],
    });
    expect(messages[1].content).toContain('could not be determined');
  });
});
