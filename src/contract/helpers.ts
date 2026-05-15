declare const endpointResponseType: unique symbol;
declare const endpointPayloadType: unique symbol;
declare const sseEventType: unique symbol;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH';
export type EndpointHeaders = Readonly<Record<string, string>>;
export type EmptyParams = Record<never, never>;

const defaultJsonHeaders: EndpointHeaders = {
    'Content-Type': 'application/json',
};

export interface Endpoint<
    TPayload,
    TResponse,
    TPathParams extends object = EmptyParams,
    TQueryParams extends object = EmptyParams,
> {
    transport: 'http';
    method: HttpMethod;
    path: string;
    pathParams: readonly (keyof TPathParams & string)[];
    queryParams: readonly (keyof TQueryParams & string)[];
    headers: EndpointHeaders;
    readonly [endpointPayloadType]?: TPayload;
    readonly [endpointResponseType]?: TResponse;
}

export interface SseEndpoint<TEvent> {
    transport: 'sse';
    method: 'GET';
    path: string;
    queryParams: readonly string[];
    readonly [sseEventType]?: TEvent;
}

export const defineEndpoint = <
    TPayload,
    TResponse,
    TPathParams extends object = EmptyParams,
>(
    endpoint: Omit<Endpoint<TPayload, TResponse, TPathParams>, 'headers' | 'pathParams' | 'queryParams' | 'transport'> & {
        headers?: EndpointHeaders;
        pathParams?: readonly (keyof TPathParams & string)[];
    },
): Endpoint<TPayload, TResponse, TPathParams> => ({
    ...endpoint,
    headers: endpoint.headers ?? defaultJsonHeaders,
    pathParams: endpoint.pathParams ?? [],
    queryParams: [],
    transport: 'http',
});

export const defineEndpointWithQuery = <
    TPayload,
    TResponse,
    TPathParams extends object = EmptyParams,
    TQueryParams extends object = EmptyParams,
>(
    endpoint: Omit<Endpoint<TPayload, TResponse, TPathParams, TQueryParams>, 'headers' | 'pathParams' | 'queryParams' | 'transport'> & {
        headers?: EndpointHeaders;
        pathParams?: readonly (keyof TPathParams & string)[];
        queryParams: readonly (keyof TQueryParams & string)[];
    },
): Endpoint<TPayload, TResponse, TPathParams, TQueryParams> => ({
    ...endpoint,
    headers: endpoint.headers ?? defaultJsonHeaders,
    pathParams: endpoint.pathParams ?? [],
    queryParams: endpoint.queryParams ?? [],
    transport: 'http',
});

export const defineSseEndpoint = <TEvent>(
    endpoint: Omit<SseEndpoint<TEvent>, 'queryParams' | 'transport' | 'method'> & {
        queryParams?: readonly string[];
    },
): SseEndpoint<TEvent> => ({
    ...endpoint,
    method: 'GET',
    queryParams: endpoint.queryParams ?? [],
    transport: 'sse',
});
