/**
 * Reads and validates the action inputs into a strongly-typed config object.
 */
import * as core from '@actions/core';

export interface ActionConfig {
  githubToken: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiBaseUrl?: string;
  maxAttempts: number;
  manualLabel: string;
  dependencyAuthors: string[];
  branchPrefixes: string[];
  maxFiles: number;
  prNumberInput?: number;
  dryRun: boolean;
  commitAuthorName: string;
  commitAuthorEmail: string;
}

function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parsePositiveInt(raw: string, fallback: number): number {
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < 1) {
    return fallback;
  }
  return value;
}

export function getConfig(): ActionConfig {
  const githubToken = core.getInput('github-token', { required: true });
  const openaiApiKey = core.getInput('openai-api-key', { required: true });

  const prNumberRaw = core.getInput('pr-number');
  const prNumberInput = prNumberRaw
    ? parsePositiveInt(prNumberRaw, 0) || undefined
    : undefined;

  const openaiBaseUrl = core.getInput('openai-base-url').trim();

  return {
    githubToken,
    openaiApiKey,
    openaiModel: core.getInput('openai-model') || 'gpt-4o',
    openaiBaseUrl: openaiBaseUrl.length > 0 ? openaiBaseUrl : undefined,
    maxAttempts: parsePositiveInt(core.getInput('max-attempts'), 3),
    manualLabel: core.getInput('manual-label') || 'needs-manual-fix',
    dependencyAuthors: parseList(
      core.getInput('dependency-authors') ||
        'dependabot[bot],renovate[bot],dependabot,renovate',
    ),
    branchPrefixes: parseList(
      core.getInput('branch-prefixes') ||
        'dependabot/,renovate/,deps/,dependabot-',
    ),
    maxFiles: parsePositiveInt(core.getInput('max-files'), 6),
    prNumberInput,
    dryRun: core.getBooleanInput('dry-run'),
    commitAuthorName:
      core.getInput('commit-author-name') || 'smart-dependency-updater[bot]',
    commitAuthorEmail:
      core.getInput('commit-author-email') ||
      '41898282+github-actions[bot]@users.noreply.github.com',
  };
}
