import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';
import { joinClassNames } from '@/client/utils.js';

type ButtonVariant = 'primary' | 'danger' | 'secondary';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: ReactNode;
    variant?: ButtonVariant | undefined;
}

export const Button = ({children, className, type = 'button', variant = 'primary', ...props}: ButtonProps) => (
    <button
        {...props}
        className={joinClassNames(styles.button, styles[variant], className)}
        type={type}
    >
        {children}
    </button>
);
