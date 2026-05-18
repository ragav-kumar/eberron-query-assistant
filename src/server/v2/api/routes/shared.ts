import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HTTPMethod } from 'find-my-way';

export type RouteParams = Record<string, string | undefined>;

export type RouteHandler = (
    request: IncomingMessage,
    response: ServerResponse,
    params: RouteParams,
) => void;

export interface RouteDefinition {
    handler: RouteHandler;
    method: HTTPMethod;
    path: string;
}
