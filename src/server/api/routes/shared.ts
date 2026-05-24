import { IncomingMessage, ServerResponse } from 'node:http';
import { HTTPMethod } from 'find-my-way';

import { AppContext } from '@server/app.js';

export type RouteParams = Record<string, string | undefined>;

export interface RouteHandlerArgs {
    context: AppContext;
    pathParams: RouteParams;
    queryParams: Record<string, string>;
    request: IncomingMessage,
    response: ServerResponse,
}

export type RouteHandler = (args: RouteHandlerArgs) => Promise<void> | void;

export interface RouteDefinition {
    handler: RouteHandler;
    method: HTTPMethod;
    path: string;
}
