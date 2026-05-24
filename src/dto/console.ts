import { ConsoleLevel } from '../types.js';

export interface ConsoleEntryDto {
    id: string;
    level: ConsoleLevel;
    message: string;
    timestamp: string;
}
