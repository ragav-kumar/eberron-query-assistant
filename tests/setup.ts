import path from 'node:path';

// Tests must not depend on the developer's live runtime env or repo-local app DB path.
process.env.OPENAI_API_KEY = 'test-openai-api-key';
process.env.EQA_PARTY_ACTOR_UUIDS = 'Actor.test';
process.env.OPENAI_BASE_URL = 'https://example.invalid/v1';
process.env.OPENAI_CHAT_MODEL = 'test-chat-model';
process.env.OPENAI_EMBEDDING_MODEL = 'test-embedding-model';
process.env.EQA_APP_DB_PATH = path.resolve(process.cwd(), '.sanitized-test-do-not-open', 'app.sqlite');
process.env.EQA_V2_SERVER_HOST = '127.0.0.1';
process.env.EQA_V2_SERVER_PORT = '3001';
