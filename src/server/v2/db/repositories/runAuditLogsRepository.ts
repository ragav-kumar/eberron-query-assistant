import { mapRunAuditLogRow } from '../mappers.js';
import type { V2Orm } from '../contract.js';
import type { RunAuditLog as StoredRunAuditLogRow } from '../schema.js';

import type { V2Loaders } from '../loaders.js';
import type { RepositoryDependencies } from './shared.js';

type RunAuditLogsRepository = V2Orm['runAuditLogs'];

export const createRunAuditLogsRepository = (
    { getDatabase }: RepositoryDependencies,
    loaders: Pick<V2Loaders, 'loadRunAuditLogs'>,
): RunAuditLogsRepository => {
    return {
        get: async (config, id) => {
            const database = await getDatabase(config);
            const row = database
                .prepare(`
                    SELECT id, run_id, kind, details, created_at
                    FROM run_audit_logs
                    WHERE id = ?
                `)
                .get(id) as StoredRunAuditLogRow | undefined;
            return row ? mapRunAuditLogRow(row) : null;
        },
        listByRun: async (config, runId) => {
            const database = await getDatabase(config);
            return loaders.loadRunAuditLogs(database, runId);
        },
        save: async (config, auditLog) => {
            const database = await getDatabase(config);
            database
                .prepare(`
                    INSERT INTO run_audit_logs (id, run_id, kind, details, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        run_id = excluded.run_id,
                        kind = excluded.kind,
                        details = excluded.details,
                        created_at = excluded.created_at
                `)
                .run(
                    auditLog.id,
                    auditLog.runId,
                    auditLog.kind,
                    auditLog.details,
                    auditLog.createdAt.toISOString(),
                );
        },
    };
};
