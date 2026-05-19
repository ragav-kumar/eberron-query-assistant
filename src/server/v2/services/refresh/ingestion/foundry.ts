import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createTaggedError, formatThrownValue, isRecord } from '@/errors.js';
import type { CorpusChunk, CorpusSource } from '@/types.js';

import type { FoundryExportMarker, RefreshRuntimePaths, SourceChangeSet } from '../types.js';
import { chunkText } from './chunking.js';

const SUPPORTED_FOUNDRY_EXPORT_SCHEMA_VERSION = '2.0.0';

type FoundryDeltaOperation =
    | {
        kind: 'upsert';
        recordId: string;
        source: CorpusSource;
        chunks: CorpusChunk[];
    }
    | {
        kind: 'delete';
        recordId: string;
    };

/**
 * Converts scheduled Foundry delta files into corpus source changes.
 *
 * Foundry exports already express explicit upsert/delete operations, so this
 * stage validates the NDJSON structure and normalizes each record into the
 * corpus source/chunk model.
 */
export const buildFoundrySourceChanges = async (
    paths: RefreshRuntimePaths,
    markers: FoundryExportMarker[],
    forceReingest: boolean,
): Promise<{
    appliedMarkers: FoundryExportMarker[];
    changeSet: SourceChangeSet;
}> => {
    const changes: SourceChangeSet['changes'] = [];

    for (const marker of markers) {
        const operations = await parseFoundryDeltaFile(paths, marker.filename);

        for (const operation of operations) {
            if (operation.kind === 'delete') {
                changes.push({
                    kind: 'delete',
                    sourceKey: operation.recordId,
                    sourceType: 'foundry',
                });
                continue;
            }

            changes.push({
                kind: 'upsert',
                chunks: operation.chunks,
                source: operation.source,
            });
        }
    }

    return {
        appliedMarkers: markers,
        changeSet: {
            ...(forceReingest ? { clearSourceType: 'foundry' as const } : {}),
            changes,
        },
    };
};

/**
 * Reads and validates one Foundry NDJSON export file before applying it.
 */
const parseFoundryDeltaFile = async (
    paths: RefreshRuntimePaths,
    filename: string,
): Promise<FoundryDeltaOperation[]> => {
    const recordsPath = path.join(paths.foundryExportDir, filename);
    const raw = await readFile(recordsPath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) {
        throw createTaggedError('invalid-foundry-ndjson', `${filename}: first line must contain a manifest envelope.`);
    }

    const marker = parseManifestEnvelope(filename, parseJsonLine(filename, lines[0] ?? '', 1));
    const operations = lines.slice(1).map((line, index) => parseOperationEnvelope(filename, line, index + 2, marker));
    const upsertCount = operations.filter(operation => operation.kind === 'upsert').length;
    const deleteCount = operations.filter(operation => operation.kind === 'delete').length;

    if (upsertCount !== marker.upsertCount) {
        throw createTaggedError(
            'invalid-foundry-ndjson',
            `${filename}: manifest.run.upsertCount expected ${marker.upsertCount} operation(s), found ${upsertCount}.`,
        );
    }

    if (deleteCount !== marker.deleteCount) {
        throw createTaggedError(
            'invalid-foundry-ndjson',
            `${filename}: manifest.run.deleteCount expected ${marker.deleteCount} operation(s), found ${deleteCount}.`,
        );
    }

    return operations;
};

const parseJsonLine = (filename: string, line: string, lineNumber: number): unknown => {
    try {
        return JSON.parse(line) as unknown;
    } catch (error) {
        throw createTaggedError('invalid-foundry-ndjson', `${filename}: invalid JSON on line ${lineNumber}: ${formatThrownValue(error)}.`);
    }
};

const parseManifestEnvelope = (filename: string, value: unknown): FoundryExportMarker => {
    if (!isRecord(value)) {
        throw createTaggedError('invalid-foundry-ndjson', `${filename}: first line must contain a manifest envelope object.`);
    }
    if (value.kind !== 'manifest') {
        throw createTaggedError('invalid-foundry-ndjson', `${filename}: first line kind must be manifest.`);
    }
    return parseManifest(filename, value.manifest);
};

const parseManifest = (filename: string, value: unknown): FoundryExportMarker => {
    if (!isRecord(value)) {
        throw createTaggedError('invalid-foundry-ndjson', `${filename}: manifest must contain an object.`);
    }
    if (value.schemaVersion !== SUPPORTED_FOUNDRY_EXPORT_SCHEMA_VERSION) {
        throw createTaggedError('invalid-foundry-ndjson', `${filename}: manifest.schemaVersion must be ${SUPPORTED_FOUNDRY_EXPORT_SCHEMA_VERSION}.`);
    }

    const run = value.run;
    if (!isRecord(run)) {
        throw createTaggedError('invalid-foundry-ndjson', `${filename}: manifest.run must contain an object.`);
    }

    const runId = run.runId;
    const generatedAt = run.generatedAt;
    const recordCount = run.recordCount;
    const upsertCount = run.upsertCount;
    const deleteCount = run.deleteCount;

    if (typeof runId !== 'string' || runId.length === 0) {
        throw createTaggedError('invalid-foundry-ndjson', `${filename}: manifest.run.runId must be a non-empty string.`);
    }
    if (typeof generatedAt !== 'string' || generatedAt.length === 0) {
        throw createTaggedError('invalid-foundry-ndjson', `${filename}: manifest.run.generatedAt must be a non-empty string.`);
    }
    if (typeof recordCount !== 'number' || !Number.isInteger(recordCount) || recordCount < 0) {
        throw createTaggedError('invalid-foundry-ndjson', `${filename}: manifest.run.recordCount must be a non-negative integer.`);
    }
    if (typeof upsertCount !== 'number' || !Number.isInteger(upsertCount) || upsertCount < 0) {
        throw createTaggedError('invalid-foundry-ndjson', `${filename}: manifest.run.upsertCount must be a non-negative integer.`);
    }
    if (typeof deleteCount !== 'number' || !Number.isInteger(deleteCount) || deleteCount < 0) {
        throw createTaggedError('invalid-foundry-ndjson', `${filename}: manifest.run.deleteCount must be a non-negative integer.`);
    }

    return {
        deleteCount,
        filename,
        generatedAt,
        recordCount,
        runId,
        schemaVersion: SUPPORTED_FOUNDRY_EXPORT_SCHEMA_VERSION,
        upsertCount,
    };
};

const parseOperationEnvelope = (
    filename: string,
    line: string,
    lineNumber: number,
    exportMarker: FoundryExportMarker,
): FoundryDeltaOperation => {
    const parsed = parseJsonLine(filename, line, lineNumber);

    if (!isRecord(parsed)) {
        throw createTaggedError('invalid-foundry-ndjson', `${filename}: operation on line ${lineNumber} must be an object.`);
    }

    if (parsed.kind === 'upsert') {
        if (!isRecord(parsed.record)) {
            throw createTaggedError('invalid-foundry-ndjson', `${filename}: upsert on line ${lineNumber} must contain record object.`);
        }

        const normalized = normalizeFoundryRecord(parsed.record, exportMarker);
        return {
            chunks: normalized.chunks,
            kind: 'upsert',
            recordId: normalized.source.sourceKey,
            source: normalized.source,
        };
    }

    if (parsed.kind === 'delete') {
        if (!isRecord(parsed.record)) {
            throw createTaggedError('invalid-foundry-ndjson', `${filename}: delete on line ${lineNumber} must contain record object.`);
        }

        const recordId = readRecordId(parsed.record);
        if (!recordId) {
            throw createTaggedError('invalid-foundry-ndjson', `${filename}: delete on line ${lineNumber} must contain record.recordId.`);
        }

        return {
            kind: 'delete',
            recordId,
        };
    }

    throw createTaggedError('invalid-foundry-ndjson', `${filename}: operation on line ${lineNumber} kind must be upsert or delete.`);
};

/**
 * Normalizes one Foundry record into a corpus source and chunk set.
 *
 * The export payload is flexible, so the normalization logic uses heuristics to
 * derive stable IDs, textual content, and citation metadata.
 */
const normalizeFoundryRecord = (
    parsed: Record<string, unknown>,
    exportMarker: FoundryExportMarker,
): { chunks: CorpusChunk[]; source: CorpusSource } => {
    const recordId = readRecordId(parsed) ?? hashText(JSON.stringify(parsed));
    const entityKind =
        firstString(parsed, ['sourceType', 'type', 'kind', 'entityType', 'documentType'])
        ?? readNestedString(parsed, ['metadata', 'classification', 'documentType'])
        ?? 'record';
    const title = firstString(parsed, ['name', 'title', 'label']) ?? `${entityKind} ${recordId}`;
    const sourceKey = recordId;
    const sourceId = createSourceId('foundry', sourceKey);
    const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
    const extractedText = body.length > 0 ? body : extractText(parsed);
    const text = extractedText.length > 0 ? extractedText : JSON.stringify(parsed, null, 2);
    const citationAnchor = readNestedString(parsed, ['metadata', 'citation', 'anchor']);

    const source: CorpusSource = {
        metadata: {
            citationAnchor,
            classificationTags: readNestedStringArray(parsed, ['metadata', 'classification', 'tags']),
            createdTime: readNestedPrimitive(parsed, ['timestamps', 'createdTime']),
            entityKind,
            exportGeneratedAt: exportMarker.generatedAt,
            exportRunId: exportMarker.runId,
            modifiedTime: readNestedPrimitive(parsed, ['timestamps', 'modifiedTime']),
            packId: firstString(parsed, ['packId']),
            parentId: firstString(parsed, ['parentId']),
            parentUuid: firstString(parsed, ['parentUuid']),
            provenancePath: readNestedStringArray(parsed, ['metadata', 'provenance', 'path']),
            recordId,
            sourceId: firstString(parsed, ['sourceId']),
            sourceScope: firstString(parsed, ['sourceScope']),
            sourceType: 'foundry',
            sourceUuid: firstString(parsed, ['sourceUuid']),
            title,
        },
        sourceId,
        sourceKey,
        sourceType: 'foundry',
        status: 'succeeded',
        title,
    };

    const chunks = chunkText(text).map((chunk, chunkIndex): CorpusChunk => ({
        chunkId: `${sourceId}:chunk:${chunkIndex}`,
        chunkIndex,
        citation: {
            label: title,
            locator: citationAnchor ?? entityKind,
            sourceType: 'foundry',
            url: null,
        },
        metadata: {
            classificationTags: readNestedStringArray(parsed, ['metadata', 'classification', 'tags']),
            endParagraph: chunk.endParagraph,
            entityKind,
            exportRunId: exportMarker.runId,
            provenancePath: readNestedStringArray(parsed, ['metadata', 'provenance', 'path']),
            recordId,
            sourceType: 'foundry',
            sourceUuid: firstString(parsed, ['sourceUuid']),
            startParagraph: chunk.startParagraph,
        },
        sourceId,
        text: chunk.text,
    }));

    return { chunks, source };
};

const readRecordId = (record: Record<string, unknown>): string | null => firstString(record, ['recordId', 'id', '_id', 'uuid', 'key']);

/**
 * Fallback text extraction for structured Foundry payloads that do not expose
 * one canonical body field.
 */
const extractText = (value: unknown): string => {
    const textParts: string[] = [];
    collectText(value, textParts, new Set());
    return [...new Set(textParts)].join('\n\n');
};

const collectText = (value: unknown, textParts: string[], seen: Set<unknown>): void => {
    if (typeof value === 'string') {
        const text = stripHtml(value).trim();
        if (text.length >= 2) {
            textParts.push(text);
        }
        return;
    }

    if (!isRecord(value) && !Array.isArray(value)) {
        return;
    }

    if (seen.has(value)) {
        return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
        for (const item of value) {
            collectText(item, textParts, seen);
        }
        return;
    }

    for (const [key, item] of Object.entries(value)) {
        if (key.startsWith('_') || key === 'img' || key === 'image' || key === 'flags') {
            continue;
        }
        collectText(item, textParts, seen);
    }
};

const firstString = (record: Record<string, unknown>, keys: string[]): string | null => {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return null;
};

const readNestedString = (record: Record<string, unknown>, pathSegments: string[]): string | null => {
    const value = readNestedValue(record, pathSegments);
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

const readNestedStringArray = (record: Record<string, unknown>, pathSegments: string[]): string[] => {
    const value = readNestedValue(record, pathSegments);
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
};

const readNestedPrimitive = (record: Record<string, unknown>, pathSegments: string[]): string | number | null => {
    const value = readNestedValue(record, pathSegments);
    return typeof value === 'string' || typeof value === 'number' ? value : null;
};

const readNestedValue = (record: Record<string, unknown>, pathSegments: string[]): unknown => {
    let value: unknown = record;
    for (const segment of pathSegments) {
        if (!isRecord(value)) {
            return null;
        }
        value = value[segment];
    }
    return value;
};

const createSourceId = (sourceType: string, sourceKey: string): string => `${sourceType}:${hashText(sourceKey)}`;

const hashText = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 24);

const stripHtml = (value: string): string => value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
