/**
 * Prompt engineering: turns the collected context (dependency change, error
 * excerpt, source files) into a chat-completion message pair that asks the
 * model for a strict JSON patch.
 */
import { CandidateFile, DependencyChange, ParsedLog } from '../types';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface PromptInput {
  repo: string;
  dependencyChange: DependencyChange | null;
  parsedLog: ParsedLog;
  files: CandidateFile[];
}

export const SYSTEM_PROMPT = [
  'You are Smart Dependency Updater, an expert software engineer that fixes',
  'code broken by dependency upgrades. A dependency was bumped to a new version',
  'in a pull request and the CI pipeline now fails because the library changed',
  'its API (renamed/removed/relocated functions, changed signatures, new',
  'required arguments, moved exports, etc.).',
  '',
  'Your job: read the failing CI log and the current source files, then rewrite',
  'ONLY the code needed so it works with the NEW version of the dependency.',
  '',
  'Hard rules:',
  '- Adapt the code to the new API. Do NOT downgrade or pin the dependency back.',
  '- Change as little as possible. Preserve behaviour, style, and formatting.',
  '- Only edit files you were given. Never invent file paths.',
  '- Return the COMPLETE new content of each file you change (not a diff).',
  '- If the log does not give you enough information to fix it confidently, set',
  '  "unableToFix" to true and explain what is missing in "reason".',
  '',
  'Respond with a single JSON object and nothing else, matching this schema:',
  '{',
  '  "summary": string,            // one or two sentences on what you changed',
  '  "unableToFix": boolean,       // true if you cannot fix it confidently',
  '  "reason": string,             // required when unableToFix is true',
  '  "changes": [                  // empty when unableToFix is true',
  '    { "path": string, "content": string }  // full new file content',
  '  ]',
  '}',
].join('\n');

function renderDependency(change: DependencyChange | null): string {
  if (!change) {
    return 'Dependency change: could not be determined from the PR metadata.';
  }
  const parts = [`- name: ${change.name}`];
  if (change.fromVersion) parts.push(`- from version: ${change.fromVersion}`);
  if (change.toVersion) parts.push(`- to version: ${change.toVersion}`);
  if (change.ecosystem) parts.push(`- ecosystem: ${change.ecosystem}`);
  if (change.manifest) parts.push(`- manifest: ${change.manifest}`);
  return `Dependency change:\n${parts.join('\n')}`;
}

function renderFiles(files: CandidateFile[]): string {
  if (files.length === 0) {
    return 'No source files could be retrieved.';
  }
  return files
    .map((file) => {
      const note = file.truncated ? ' (truncated)' : '';
      return [
        `### File: ${file.path}${note}`,
        '```',
        file.content,
        '```',
      ].join('\n');
    })
    .join('\n\n');
}

export function buildMessages(input: PromptInput): ChatMessage[] {
  const user = [
    `Repository: ${input.repo}`,
    '',
    renderDependency(input.dependencyChange),
    '',
    'Failing CI log (cleaned excerpt):',
    '```',
    input.parsedLog.errorExcerpt || '(no excerpt extracted)',
    '```',
    '',
    'Current source files that the errors point to:',
    '',
    renderFiles(input.files),
    '',
    'Produce the JSON patch now.',
  ].join('\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}
