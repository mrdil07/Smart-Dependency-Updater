/**
 * Action entry point. Reads config and runs the remediation workflow,
 * surfacing any unexpected failure through `core.setFailed`.
 */
import * as core from '@actions/core';
import { getConfig } from './config';
import { run } from './remediation/orchestrator';

async function main(): Promise<void> {
  try {
    await run(getConfig());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Smart Dependency Updater failed: ${message}`);
  }
}

void main();
