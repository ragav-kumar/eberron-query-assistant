import { ReactNode } from 'react';
import styles from './SettingsModal.module.css';

interface SettingsSectionProps {
    heading: string;
    children: ReactNode;
}

/** Groups related settings under a labeled section heading. */
export const SettingsSection = ({ heading, children }: SettingsSectionProps) => (
    <section className={styles.section}>
        <h2 className={styles.sectionHeading}>{heading}</h2>
        {children}
    </section>
);
