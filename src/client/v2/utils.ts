export const joinClassNames = (...classes: (string | null | undefined)[]): string =>
    classes.filter(Boolean).join(' ');