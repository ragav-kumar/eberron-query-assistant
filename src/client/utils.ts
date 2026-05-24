import { Children, Fragment, isValidElement, ReactElement, ReactNode } from 'react';

export const joinClassNames = (...classes: (string | null | undefined)[]): string =>
    classes.filter(Boolean).join(' ');

/**
 * Returns true when `node` is a Fragment element, narrowing the type to
 * expose its `props.children` safely.
 */
export const isFragment = (
    node: ReactNode,
): node is ReactElement<{ children?: ReactNode }> =>
    isValidElement(node) && node.type === Fragment;

/**
 * Returns the element children of `node` as a flat array if it is a Fragment;
 * otherwise wraps `node` in a single-element array. Non-element fragment children
 * (strings, numbers) are excluded. Always returns ReactElement[] so callers can
 * safely access .type and .props on every item.
 */
export const unwrapFragment = (node: ReactElement): ReactElement[] =>
    isFragment(node)
        ? Children.toArray(node.props.children).filter(isValidElement)
        : [node];
