import type { Endpoint } from './endpoints.js';

export const queryApi = async <TPayload, TResponse>(
    endpoint: Endpoint<TPayload, TResponse>,
    queryParams: Record<string, string | undefined> = {},
    contentType: string = 'application/json'
): Promise<TResponse> => {
    const cleanedParams = {...queryParams};
    for (const key in cleanedParams) {
        if (cleanedParams[key] === undefined) {
            delete cleanedParams[key];
        }
    }
    const url = `${endpoint.path}?${new URLSearchParams(cleanedParams as Record<string, string>).toString()}`;

    return await fetchWrapper(url, {
        method: endpoint.method,
        headers: {
            'Content-Type': contentType,
        },
    });
};

export const mutateApi = async <TPayload, TResponse>(
    endpoint: Endpoint<TPayload, TResponse>,
    payload: TPayload | null,
    contentType: string = 'application/json'
): Promise<TResponse> => {
    const options: RequestInit = {
        method: endpoint.method,
        headers: {
            'Content-Type': contentType,
        },
    };
    if (payload != null && contentType === 'application/json') {
        options.body = JSON.stringify(payload);
    }

    return await fetchWrapper(endpoint.path, options);
};

const fetchWrapper = async <TResponse>(url: string, options: RequestInit) => {
    const rawResponse = await fetch(url, options);

    const json = await rawResponse.json() as unknown;

    if (!rawResponse.ok) {
        throw new Error(`HTTP error! status: ${rawResponse.status}`);
        // TODO - throw a full featured dto instead?
        //const errorDto = (json ?? {}) as ErrorResponseDto;
    }

    return json as TResponse;
};