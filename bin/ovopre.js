#!/usr/bin/env node

import { runCli } from '../src/cli.js';

runCli(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ovopre error: ${message}`);
  process.exit(1);
});
