/**
 * The remediation workflow: resolve the PR, validate it is a failing
 * dependency update, analyze the logs, ask the model for a fix, and push it —
 * stopping (with a label) when the attempt budget is exhausted or the model
 * cannot fix the failure.
 */
import * as core from '@actions/core';
import { ActionConfig } from '../config';
import { createOctokit } from '../github/client';
import {
  resolveContext,
  getPullRequest,
  isDependencyPr,
  getDependencyChange,
} from '../github/pr';
import { downloadRunLogs } from '../github/logs';
import { readFiles } from '../github/files';
import {
  getAttemptState,
  commitChanges,
  addComment,
  applyLabel,
  hasLabel,
  attemptMarker,
} from '../github/commit';
import { parseLog } from '../parser/logParser';
import { requestFix } from '../ai/openai';
import { logger } from '../logger';
import { CandidateFile, RemediationStatus } from '../types';

const BOT_SIGNATURE =
  '\n\n— 🤖 [Smart Dependency Updater](https://github.com/mrdil07/Smart-Dependency-Updater)';

interface Outcome {
  status: RemediationStatus;
  prNumber?: number;
  commitSha?: string;
  attempts: number;
}

function setOutputs(outcome: Outcome): void {
  core.setOutput('status', outcome.status);
  core.setOutput('pr-number', outcome.prNumber?.toString() ?? '');
  core.setOutput('commit-sha', outcome.commitSha ?? '');
  core.setOutput('attempts', outcome.attempts.toString());
  logger.info(`Outcome: ${outcome.status} (attempts: ${outcome.attempts})`);
}

/** Normalize content for no-op comparison (ignore trailing-newline drift). */
function normalize(content: string): string {
  return content.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

export async function run(config: ActionConfig): Promise<void> {
  const octokit = createOctokit(config.githubToken);

  const ctx = await resolveContext(octokit, config);
  if (!ctx) {
    setOutputs({ status: 'skipped', attempts: 0 });
    return;
  }

  const { owner, repo, prNumber, headRef, headSha } = ctx;

  const pr = await getPullRequest(octokit, owner, repo, prNumber);
  if (!isDependencyPr(pr, config)) {
    logger.info(`PR #${prNumber} is not a dependency update — skipping.`);
    setOutputs({ status: 'skipped', prNumber, attempts: 0 });
    return;
  }

  if (!ctx.failedRunId) {
    logger.info(`No failed CI run found for PR #${prNumber} — skipping.`);
    setOutputs({ status: 'skipped', prNumber, attempts: 0 });
    return;
  }

  // Enforce the attempt budget BEFORE doing any expensive work.
  const { count } = await getAttemptState(octokit, owner, repo, prNumber);
  if (count >= config.maxAttempts) {
    if (await hasLabel(octokit, owner, repo, prNumber, config.manualLabel)) {
      logger.info('Attempt budget exhausted and already labelled — skipping.');
      setOutputs({ status: 'skipped', prNumber, attempts: count });
      return;
    }
    await applyLabel(octokit, owner, repo, prNumber, config.manualLabel);
    await addComment(
      octokit,
      owner,
      repo,
      prNumber,
      `I made ${count} automatic fix attempt(s) but CI is still failing. ` +
        `I've reached the limit of \`${config.maxAttempts}\`, so I'm stopping ` +
        `and labelling this PR \`${config.manualLabel}\` for manual review.` +
        BOT_SIGNATURE,
    );
    setOutputs({ status: 'manual-intervention', prNumber, attempts: count });
    return;
  }

  // Collect and analyze the failing logs.
  const rawLog = await downloadRunLogs(
    octokit,
    owner,
    repo,
    ctx.failedRunId,
  );
  const parsed = parseLog(rawLog);

  if (!parsed.errorExcerpt && parsed.fileReferences.length === 0) {
    logger.warning('Could not extract any error context from the logs.');
    await addComment(
      octokit,
      owner,
      repo,
      prNumber,
      "I couldn't find actionable errors in the CI logs, so I can't propose a " +
        'fix automatically. Please check the failing job manually.' +
        BOT_SIGNATURE,
    );
    setOutputs({ status: 'skipped', prNumber, attempts: count });
    return;
  }

  const dependencyChange = await getDependencyChange(
    octokit,
    owner,
    repo,
    prNumber,
    pr.title,
  );

  // Gather the source files the errors point to (read at the PR head SHA).
  const candidatePaths = parsed.fileReferences
    .map((ref) => ref.path)
    .slice(0, config.maxFiles);

  const fileResults = await readFiles(
    octokit,
    owner,
    repo,
    candidatePaths,
    headSha,
  );

  if (fileResults.length === 0) {
    logger.warning('No readable source files matched the error references.');
    await addComment(
      octokit,
      owner,
      repo,
      prNumber,
      "I found failing tests but couldn't read the source files they point to, " +
        'so I cannot generate a fix automatically.' +
        BOT_SIGNATURE,
    );
    setOutputs({ status: 'skipped', prNumber, attempts: count });
    return;
  }

  const files: CandidateFile[] = fileResults.map((f) => ({
    path: f.path,
    content: f.content,
    truncated: f.truncated,
  }));

  logger.info(
    `Asking ${config.openaiModel} to fix ${files.length} file(s) ` +
      `for PR #${prNumber} (attempt ${count + 1}/${config.maxAttempts}).`,
  );

  const ai = await requestFix(
    {
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      baseUrl: config.openaiBaseUrl,
    },
    {
      repo: `${owner}/${repo}`,
      dependencyChange,
      parsedLog: parsed,
      files,
    },
  );

  // The model could not fix it: stop and ask for manual help.
  if (ai.unableToFix || ai.changes.length === 0) {
    const reason = ai.reason ? ` Reason: ${ai.reason}` : '';
    await applyLabel(octokit, owner, repo, prNumber, config.manualLabel);
    await addComment(
      octokit,
      owner,
      repo,
      prNumber,
      `I analyzed the failing CI logs but couldn't generate a confident fix ` +
        `for this dependency update.${reason} I've labelled this PR ` +
        `\`${config.manualLabel}\` for manual review.` +
        BOT_SIGNATURE,
    );
    setOutputs({ status: 'unable-to-fix', prNumber, attempts: count });
    return;
  }

  // Drop no-op rewrites (identical to current content).
  const realChanges = ai.changes.filter((change) => {
    const current = files.find((f) => f.path === change.path);
    return !current || normalize(current.content) !== normalize(change.content);
  });

  if (realChanges.length === 0) {
    logger.info('Model returned no effective changes.');
    await addComment(
      octokit,
      owner,
      repo,
      prNumber,
      'I analyzed the failure but the proposed change is identical to the ' +
        'current code, so there is nothing to commit.' +
        BOT_SIGNATURE,
    );
    setOutputs({ status: 'no-op', prNumber, attempts: count });
    return;
  }

  const fileList = realChanges.map((c) => `- \`${c.path}\``).join('\n');

  // Dry-run: report the proposal without pushing.
  if (config.dryRun) {
    logger.info('Dry-run enabled — not pushing a commit.');
    await addComment(
      octokit,
      owner,
      repo,
      prNumber,
      `**Dry run** — I analyzed the failing CI and would change:\n${fileList}\n\n` +
        `**Summary:** ${ai.summary || '(none provided)'}` +
        BOT_SIGNATURE,
    );
    setOutputs({ status: 'skipped', prNumber, attempts: count });
    return;
  }

  // Push the fix commit.
  const nextAttempt = count + 1;
  const depLabel = dependencyChange
    ? `${dependencyChange.name}${
        dependencyChange.toVersion ? `@${dependencyChange.toVersion}` : ''
      }`
    : 'dependency update';

  const commitSha = await commitChanges(
    octokit,
    owner,
    repo,
    headRef,
    headSha,
    realChanges,
    `fix: adapt code to ${depLabel} [smart-dependency-updater]\n\n${ai.summary}`,
    { name: config.commitAuthorName, email: config.commitAuthorEmail },
  );

  await addComment(
    octokit,
    owner,
    repo,
    prNumber,
    `I analyzed the failing CI logs and pushed a fix for this dependency ` +
      `update (attempt ${nextAttempt}/${config.maxAttempts}).\n\n` +
      `**Summary:** ${ai.summary || '(none provided)'}\n\n` +
      `**Files changed:**\n${fileList}\n\n` +
      `CI will re-run automatically. If it still fails, I'll try again ` +
      `(up to ${config.maxAttempts} attempts).` +
      BOT_SIGNATURE +
      attemptMarker(nextAttempt),
  );

  setOutputs({
    status: 'fixed',
    prNumber,
    commitSha,
    attempts: nextAttempt,
  });
}
