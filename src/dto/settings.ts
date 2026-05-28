/**
 * Discriminated union representing one user-configurable setting.
 *
 * Each variant carries type metadata (label, section, constraints) alongside
 * the setting's current value so the client can render the correct input
 * component without any per-key hardcoding.
 *
 * `settingType` is the discriminant. The shapes map to input components:
 *   'string'   → StringInput (plain text)
 *   'password' → PasswordInput (masked with show/hide toggle)
 *   'number'   → NumberInput (with optional min/max constraints from DTO)
 *   'boolean'  → BooleanInput (checkbox)
 *   'textarea' → TextareaInput (resizable textarea)
 *   'array'    → ArrayInput (one entry per line, serialised as string[])
 *   'url'      → UrlInput (<input type="url">, validates URL format)
 *   'path'     → PathInput (plain text, validates non-empty and basic path syntax)
 */
export type SettingType = 'string' | 'password' | 'number' | 'boolean' | 'textarea' | 'array' | 'url' | 'path';

interface BaseSettingDto {
    /** Matches the camelCase key name in settingKeys.ts. */
    key: string;
    settingType: SettingType;
    /** Short human-readable label shown above the field. */
    label: string;
    /**
     * Groups related settings under a shared heading in the modal.
     * The UI renders one SettingsSection per unique section value.
     */
    section: string;
    /** Optional explanatory text rendered below the label. */
    description?: string;
}

export interface StringSettingDto extends BaseSettingDto {
    settingType: 'string';
    value: string;
    /** Forwarded to the input element as the HTML placeholder attribute. */
    placeholder?: string;
}

export interface PasswordSettingDto extends BaseSettingDto {
    settingType: 'password';
    value: string;
}

export interface NumberSettingDto extends BaseSettingDto {
    settingType: 'number';
    value: number;
    /** Minimum allowed value, forwarded to the input and used for client-side validation. */
    min?: number;
    /** Maximum allowed value, forwarded to the input and used for client-side validation. */
    max?: number;
}

export interface BooleanSettingDto extends BaseSettingDto {
    settingType: 'boolean';
    value: boolean;
}

export interface TextareaSettingDto extends BaseSettingDto {
    settingType: 'textarea';
    value: string;
}

export interface ArraySettingDto extends BaseSettingDto {
    settingType: 'array';
    value: string[];
}

export interface UrlSettingDto extends BaseSettingDto {
    settingType: 'url';
    value: string;
    /** Forwarded to the input element as the HTML placeholder attribute. */
    placeholder?: string;
}

export interface PathSettingDto extends BaseSettingDto {
    settingType: 'path';
    value: string;
    /** Forwarded to the input element as the HTML placeholder attribute. */
    placeholder?: string;
}

export type SettingDto =
    | StringSettingDto
    | PasswordSettingDto
    | NumberSettingDto
    | BooleanSettingDto
    | TextareaSettingDto
    | ArraySettingDto
    | UrlSettingDto
    | PathSettingDto;
