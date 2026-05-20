export const DEFAULT_V2_SERVER_HOST = '127.0.0.1';
export const DEFAULT_V2_SERVER_PORT = 3001;
export const V2_SERVER_PORT_ENV = 'EQA_V2_SERVER_PORT';

export const resolveV2ServerPort = (
    env: NodeJS.ProcessEnv = process.env,
): number => {
    const rawPort = env[V2_SERVER_PORT_ENV];
    if (rawPort == null || rawPort.trim().length === 0) {
        return DEFAULT_V2_SERVER_PORT;
    }

    const parsedPort = Number.parseInt(rawPort, 10);
    if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
        throw new Error(`Invalid ${V2_SERVER_PORT_ENV} value: ${rawPort}`);
    }

    return parsedPort;
};
