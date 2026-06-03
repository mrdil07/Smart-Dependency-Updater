/**
 * Downloads the logs of a failed workflow run and flattens them into a single
 * string for the parser.
 */
import AdmZip from 'adm-zip';
import { Octokit } from './client';
import { logger } from '../logger';

/**
 * GitHub returns workflow-run logs as a zip archive of per-step `.txt` files.
 * We concatenate them, labelling each section with its entry name.
 */
export async function downloadRunLogs(
  octokit: Octokit,
  owner: string,
  repo: string,
  runId: number,
): Promise<string> {
  try {
    const res = await octokit.rest.actions.downloadWorkflowRunLogs({
      owner,
      repo,
      run_id: runId,
    });

    // Octokit follows the 302 redirect and returns the zip as an ArrayBuffer.
    const buffer = Buffer.from(res.data as ArrayBuffer);
    const zip = new AdmZip(buffer);

    const sections: string[] = [];
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (!entry.entryName.endsWith('.txt')) continue;
      const text = entry.getData().toString('utf8');
      if (text.trim().length === 0) continue;
      sections.push(`===== ${entry.entryName} =====\n${text}`);
    }

    return sections.join('\n\n');
  } catch (error) {
    logger.warning(
      `Failed to download logs for run ${runId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return '';
  }
}
