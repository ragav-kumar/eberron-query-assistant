// This file should be inspired by /src/client/v2/api/endpoints.ts and will eventually replace it.
// It is intended to be the canonical V2 transport contract for both client and server.
// This file has no interaction with the V1 client or server.
// For the V1/V2 split, V2 is stub-only at first:
// - any request to /api/v2/* should return a not-implemented error
// - do not infer real V2 behavior from V1 responses
// - this file should enumerate the intended V2 surface even before V2 is implemented
//
// Current intended JSON endpoints:
// - GET /api/v2/context
// - PUT /api/v2/context
// - GET /api/v2/logs
// - GET /api/v2/npcs
// - POST /api/v2/refresh
// - POST /api/v2/runs
// - GET /api/v2/console
//
// Current intended SSE endpoints:
// - GET /api/v2/console/events
// - GET /api/v2/runtime/events
//
// Behavioral notes for future V2 implementation:
// - refresh is a command endpoint, not a composite state response
// - refresh locks prompt submission until it completes
// - console progress streams over console SSE
// - runtime lock/busy state is exposed separately from console text via runtime SSE
// - runtime/events should emit the current authoritative runtime snapshot immediately on connect,
//   then continue streaming state changes so a separate GET /api/v2/runtime endpoint is unnecessary
// - prompt-generation commands belong under /api/v2/runs
