# Frontend Rules

## Scope
- This file is primarily relevant during `Development`, and secondarily during `Review` when evaluating or making small scoped client changes.
- All user-requested changes will target the v2 client, `/src/client/v2`.
- During the V2 transition, treat new user-requested client behavior changes as targeting V2 unless the user explicitly says otherwise.
- No repo-local V1 client implementation remains in this repository.
- Do not use removed, archived, or external historical V1 client implementation as a design reference for V2 client work.
- If legacy client compatibility analysis ever requires consulting historical V1 client code outside this repo, disclose the specific reference and why it was needed.

## React and TypeScript
- Use React with TypeScript.
- Use functional components and React hooks. Do not introduce class components.
- Prefer `const` arrow-function components, hooks, and helpers over classic `function` declarations.
- Prefer `interface` for object-shaped props and context contracts, and keep prop types close to the component that uses them.
- Name the props interface for a component `Foo` as `FooProps`.

## Client Structure
- Prefer the shortest readable import path. Use the `@/` path alias for internal imports when it shortens the import; otherwise relative imports are fine.
- Every component that is not conceptually part of `App` belongs in the `components` folder.
- Keep a component as standalone sibling files (component + stylesheet) as long as it spans no more than those two files. Move it into a folder with a barrel `index` when it acquires a third file.
- A folder with a barrel `index` should share one stylesheet across the folder rather than having per-file stylesheets.
- Keep simple one-off render helpers private to the module instead of promoting them into shared utilities too early.
- Prefer CSS Modules for component-scoped styles, with a nearby `*.module.css` file and `styles.foo` access.
- Prefer color tokens from `/src/client/v2/themes.css` instead of component-local hex values or one-off RGB literals. Add to the shared theme file first when a new reusable color is needed.
- Use shared utilities like `joinClassNames` for conditional class assembly instead of inline string building.
- Prefer barrel exports such as local `index.ts` files when they simplify a component family or API surface without hiding ownership.
- All API interactions must happen within `/src/client/v2/api`. Build custom API hooks around `queryApi`, `mutateApi`, contract definitions, and stable query-key exports.
- Prefer colocated context modules that expose both the context object and a dedicated hook for consuming it.

## Testing and Verification
- Until the user explicitly declares the V2 client ready for a unit test suite, do not add, update, request, or run client unit tests.
- During that temporary transition, only add or update client unit tests when the user specifically asks for them in the current task.
- When a client task depends on automated test acceptance, execute `npm run test`.
- Treat any test failure whose reason is not `Not implemented.` as a blocking acceptance failure.
- Treat a `Not implemented.` failure as blocking when the failing test is affected by the current task.
- When a client change affects the local web app, use browser or API smoke coverage during verification unless the user confirms the UI is already running.
