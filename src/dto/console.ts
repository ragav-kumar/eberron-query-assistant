import { ConsoleLevel } from '../types.js';

export interface ConsoleEntryDto {
    id: string;
    level: ConsoleLevel;
    message: string;
    timestamp: string;
    /** When set, identifies the message shape. Consecutive entries sharing the same template are collapsed in the console UI rather than appended. */
    template?: string;
}
