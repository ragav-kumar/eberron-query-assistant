import packageJson from '../package.json' with { type: 'json' };
// This file is v1 only. Delete during the v1 purge.
export const getAppVersion = (): string => packageJson.version;
