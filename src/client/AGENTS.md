# Frontend rules

## Scope
- This file is primarily relevant during `Development`, and secondarily during `Review` when evaluating or making small scoped client changes.
- All user-requested changes will target the v2 client, /src/client/v2.

## React And TypeScript
- Use React with TypeScript.
- Use functional components and React hooks. Do not introduce class components.
- Prefer `const` arrow-function components, hooks, and helpers over classic `function` declarations.
- Prefer `interface` for object-shaped props and context contracts, and keep prop types close to the component that uses them.

## Client Structure
- Prefer the shortest readable import path. Use the `@/` path alias for internal imports when it shortens the import; otherwise relative imports are fine.
- If a component only needs its own component file plus stylesheet, keep it as standalone sibling files instead of creating a folder. Use a component folder when the component owns additional files such as child components or other closely related modules.
- Keep simple one-off render helpers private to the module instead of promoting them into shared utilities too early.
- Prefer CSS Modules for component-scoped styles, with a nearby `*.module.css` file and `styles.foo` access.
- Prefer color tokens from `/src/client/v2/themes.css` instead of component-local hex values or one-off RGB literals. Add to the shared theme file first when a new reusable color is needed.
- Use shared utilities like `joinClassNames` for conditional class assembly instead of inline string building.
- Prefer barrel exports such as local `index.ts` files when they simplify a component family or API surface without hiding ownership.
- All api interactions must happen within `/src/client/v2/api`. Build custom api hooks around `queryApi`, `mutateApi`, contract definitions, and stable query-key exports.
- Prefer colocated context modules that expose both the context object and a dedicated hook for consuming it.

## Testing And Verification
- Until the user explicitly declares the V2 client ready for a unit test suite, do not add, update, request, or run client unit tests.
- During that temporary transition, only add or update client unit tests when the user specifically asks for them in the current task.
- When a client task depends on automated test acceptance, execute `npm run test`.
- Treat any test failure whose reason is not `Not implemented.` as a blocking acceptance failure.
- Treat a `Not implemented.` failure as blocking when the failing test is affected by the current task.
- When a client change affects the local web app, use browser or API smoke coverage during verification.
