import type { Endpoint } from '@/contracts.v2.js';

/**
 * fetch() for GET endpoints
 */
export const queryApi = async <TPayload, TResponse>(
    endpoint: Endpoint<TPayload, TResponse>,
    params: Record<string, string | undefined> = {},
): Promise<TResponse> => {
    const url = buildEndpointUrl(endpoint, params);

    return await fetchWrapper(url, {
        method: endpoint.method,
        headers: endpoint.headers,
    });
};

/**
 * fetch() for POST and PUT endpoints (at present, we have no concept of DELETE)
 */
export const mutateApi = async <TPayload, TResponse>(
    endpoint: Endpoint<TPayload, TResponse>,
    payload: TPayload | null,
    params: Record<string, string | undefined> = {},
): Promise<TResponse> => {
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
};

const buildEndpointUrl = <TPayload, TResponse>(
    endpoint: Endpoint<TPayload, TResponse>,
    params: Record<string, string | undefined>,
): string => {
    let path = endpoint.path;
    const remainingParams = {...params};

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
