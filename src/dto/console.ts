import type { ConsoleLevel } from '../types.js';

export interface ConsoleEntry {
    id: string;
    level: ConsoleLevel;
    message: string;
    timestamp: string;
}
