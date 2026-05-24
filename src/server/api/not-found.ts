import type { ServerResponse } from 'node:http';
import { writeGenericJson } from './response.js';

export const writeNotFound = (response: ServerResponse): void => {
    writeGenericJson(response, 404, {error: 'Unknown API route.'});
};
