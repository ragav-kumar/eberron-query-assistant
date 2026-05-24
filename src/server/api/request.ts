import { IncomingMessage } from 'node:http';

const readRawBody = async (request: IncomingMessage): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }

    return chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks);
};

export const readText = async (request: IncomingMessage): Promise<string> => {
    const body = await readRawBody(request);
    return body.toString('utf8');
};

export const readJson = async <T>(request: IncomingMessage): Promise<T> => {
    const body = await readText(request);
    return (body.length === 0 ? {} : JSON.parse(body)) as T;
};
