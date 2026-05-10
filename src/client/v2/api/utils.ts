import type { Endpoint } from './endpoints.js';

export const queryApi = async <TResponse>(
    endpoint: Endpoint,
    queryParams: Record<string, string | undefined> = {}
): Promise<TResponse> => {
    const cleanedParams = { ...queryParams };
    for (const key in cleanedParams) {
        if (cleanedParams[key] === undefined) {
            delete cleanedParams[key];
        }
    }
    const url = `${endpoint.path}?${new URLSearchParams(cleanedParams as Record<string, string>).toString()}`;

    const rawResponse = await fetch(url, {
        method: endpoint.method,
        headers: {
            'Content-Type': 'application/json',
        },
    });

    const json = await rawResponse.json() as unknown;

    if (!rawResponse.ok) {
        throw new Error(`HTTP error! status: ${rawResponse.status}`);
        // TODO
        //const errorDto = (json ?? {}) as ErrorResponseDto;
    }

    return json as TResponse;
};

export const mutateApi = async <TPayload, TResponse>(
    endpoint: Endpoint,
    payload: TPayload | null
): Promise<TResponse> => {
    const options: RequestInit = {
        method: endpoint.method,
        headers: {
            'Content-Type': 'application/json',
        },
    };
    if (payload != null) {
        options.body = JSON.stringify(payload);
    }
    const rawResponse = await fetch(endpoint.path, options);

    const json = await rawResponse.json() as unknown;

    if (!rawResponse.ok) {
        throw new Error(`HTTP error! status: ${rawResponse.status}`);
        // TODO
        //const errorDto = (json ?? {}) as ErrorResponseDto;
    }

    return json as TResponse;
}