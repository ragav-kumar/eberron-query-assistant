// Migration files are for the v1 to v2 transition. These are the only files permitted to touch both codebases.
// These should be deleted during the v1 purge.

import { runMigrationCli } from './migrate-v1-to-v2.js';

void runMigrationCli();
