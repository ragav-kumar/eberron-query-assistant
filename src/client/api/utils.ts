import { Endpoint } from '../../contract/helpers.js';

type EmptyParams = Record<never, never>;
type PathParams = Record<string, string>;
type QueryParams = Record<string, string | undefined>;
type EndpointParams<TPathParams extends PathParams, TQueryParams extends QueryParams> =
    TPathParams & Partial<TQueryParams>;

/**
 * fetch() for GET endpoints
 */
export function queryApi<TPayload, TResponse>(
    endpoint: Endpoint<TPayload, TResponse, EmptyParams, EmptyParams>,
    params?: EndpointParams<EmptyParams, EmptyParams>,
): Promise<TResponse>;
export function queryApi<
    TPayload,
    TResponse,
    TPathParams extends PathParams,
    TQueryParams extends QueryParams,
>(
    endpoint: Endpoint<TPayload, TResponse, TPathParams, TQueryParams>,
    params: EndpointParams<TPathParams, TQueryParams>,
): Promise<TResponse>;
export async function queryApi<
    TPayload,
    TResponse,
    TPathParams extends PathParams,
    TQueryParams extends QueryParams,
>(
    endpoint: Endpoint<TPayload, TResponse, TPathParams, TQueryParams>,
    params: EndpointParams<TPathParams, TQueryParams> = {} as EndpointParams<TPathParams, TQueryParams>,
): Promise<TResponse> {
    const url = buildEndpointUrl(endpoint, params);

    return await fetchWrapper(url, {
        method: endpoint.method,
        headers: endpoint.headers,
    });
}

/**
 * fetch() for POST and PUT endpoints (at present, we have no concept of DELETE)
 */
export function mutateApi<TPayload, TResponse>(
    endpoint: Endpoint<TPayload, TResponse, EmptyParams, EmptyParams>,
    payload: TPayload | null,
    params?: EndpointParams<EmptyParams, EmptyParams>,
): Promise<TResponse>;
export function mutateApi<
    TPayload,
    TResponse,
    TPathParams extends PathParams,
    TQueryParams extends QueryParams,
>(
    endpoint: Endpoint<TPayload, TResponse, TPathParams, TQueryParams>,
    payload: TPayload | null,
    params: EndpointParams<TPathParams, TQueryParams>,
): Promise<TResponse>;
export async function mutateApi<
    TPayload,
    TResponse,
    TPathParams extends PathParams,
    TQueryParams extends QueryParams,
>(
    endpoint: Endpoint<TPayload, TResponse, TPathParams, TQueryParams>,
    payload: TPayload | null,
    params: EndpointParams<TPathParams, TQueryParams> = {} as EndpointParams<TPathParams, TQueryParams>,
): Promise<TResponse> {
    const options: RequestInit = {
        method: endpoint.method,
        headers: endpoint.headers,
    };
    if (payload != null) {
        options.body = endpoint.headers['Content-Type'] === 'application/json'
            ? JSON.stringify(payload)
            : String(payload);
    }

    return await fetchWrapper(buildEndpointUrl(endpoint, params), options);
}

const buildEndpointUrl = <
    TPayload,
    TResponse,
    TPathParams extends PathParams,
    TQueryParams extends QueryParams,
>(
    endpoint: Endpoint<TPayload, TResponse, TPathParams, TQueryParams>,
    params: EndpointParams<TPathParams, TQueryParams>,
): string => {
    let path = endpoint.path;
    const remainingParams = {...params} as Record<string, string | undefined>;

    for (const key of endpoint.pathParams) {
        const value = remainingParams[key];
        if (value === undefined) {
            throw new Error(`Missing path param: ${key}`);
        }
        path = path.replace(`:${key}`, encodeURIComponent(value));
        delete remainingParams[key];
    }

    const cleanedParams = {...remainingParams};
    for (const key in cleanedParams) {
        if (cleanedParams[key] === undefined) {
            delete cleanedParams[key];
        }
    }
    const query = new URLSearchParams(cleanedParams as Record<string, string>).toString();
    return query.length > 0 ? `${path}?${query}` : path;
};

const fetchWrapper = async <TResponse>(url: string, options: RequestInit) => {
    const rawResponse = await fetch(url, options);
    const rawBody = await rawResponse.text();
    const responseType = rawResponse.headers.get('Content-Type') ?? '';
    const body = rawBody.length === 0
        ? null
        : responseType.includes('application/json')
            ? JSON.parse(rawBody) as unknown
            : rawBody;

    if (!rawResponse.ok) {
        throw new Error(`HTTP error! status: ${rawResponse.status}`);
        // TODO - throw a full featured dto instead?
        //const errorDto = (json ?? {}) as ErrorResponseDto;
    }

    return body as TResponse;
};
