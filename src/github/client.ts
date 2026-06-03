/**
 * Octokit factory. Kept tiny so it can be mocked in tests.
 */
import * as github from '@actions/github';

export type Octokit = ReturnType<typeof github.getOctokit>;

export function createOctokit(token: string): Octokit {
  return github.getOctokit(token);
}
