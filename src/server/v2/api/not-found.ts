import type { ServerResponse } from 'node:http';
import { writeJson } from './response.js';

export const writeNotFound = (response: ServerResponse): void => {
    writeJson(response, 404, {error: 'Unknown API route.'});
};
