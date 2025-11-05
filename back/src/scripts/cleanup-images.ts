#!/usr/bin/env bun
// AI : Background job to cleanup scheduled image deletions
// Run this via cron: bun run cleanup-images

import { executePendingDeletions } from '../lib/imageCleanup';

async function main() {
  console.log('[Image Cleanup] Starting scheduled deletion job...');
  console.log(`[Image Cleanup] Current time: ${new Date().toISOString()}`);

  try {
    const result = await executePendingDeletions();
    console.log(`[Image Cleanup] Job complete: ${result.deleted} deleted, ${result.failed} failed`);

    if (result.failed > 0) {
      console.error(`[Image Cleanup] Warning: ${result.failed} deletions failed. Check logs for details.`);
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error('[Image Cleanup] Fatal error during cleanup:', error);
    process.exit(1);
  }
}

main();
