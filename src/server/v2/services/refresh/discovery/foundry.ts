import { mkdir, open, readdir } from 'node:fs/promises';
import path from 'node:path';

import { createTaggedError, formatThrownValue, isRecord } from '@/errors.js';

import type { FoundryImportState } from '../import-state.js';
import type { FoundryDiscoveryResult, FoundryExportMarker } from '../types.js';

const FOUNDRY_MANIFEST_READ_CHUNK_BYTES = 64 * 1024;
const SUPPORTED_FOUNDRY_EXPORT_SCHEMA_VERSION = '2.0.0';

export const discoverFoundryRefresh = async (
    foundryExportDir: string,
    importState: FoundryImportState,
    forceReingest: boolean,
): Promise<FoundryDiscoveryResult> => {
    await mkdir(foundryExportDir, { recursive: true });
    const filenames = (await readdir(foundryExportDir, { withFileTypes: true }))
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.ndjson'))
        .map(entry => entry.name)
        .sort((left, right) => left.localeCompare(right));
    const markers = await Promise.all(filenames.map(async filename => parseFoundryExportManifest(foundryExportDir, filename)));
    const appliedFilenames = new Set(importState.appliedExportFilenames);

    return {
        markers,
        scheduledMarkers: forceReingest
            ? markers
            : markers.filter(marker => !appliedFilenames.has(marker.filename)),
    };
};

export const parseFoundryExportManifest = async (foundryExportDir: string, filename: string): Promise<FoundryExportMarker> => {
    const exportPath = path.join(foundryExportDir, filename);
    const firstLine = (await readFirstLine(exportPath)).trim();
    if (firstLine.length === 0) {
        throw createTaggedError('invalid-foundry-manifest', `${filename}: first line must contain a manifest envelope`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(firstLine) as unknown;
    } catch (error) {
        throw createTaggedError('invalid-foundry-manifest', `${filename}: invalid manifest JSON: ${formatThrownValue(error)}`);
    }

    return parseFoundryManifestEnvelope(filename, parsed);
};

const readFirstLine = async (filePath: string): Promise<string> => {
    const file = await open(filePath, 'r');
    const chunks: Buffer[] = [];
    let position = 0;

    try {
        while (true) {
            const buffer = Buffer.alloc(FOUNDRY_MANIFEST_READ_CHUNK_BYTES);
            const result = await file.read(buffer, 0, buffer.length, position);
            if (result.bytesRead === 0) {
                return Buffer.concat(chunks).toString('utf8');
            }

            const chunk = buffer.subarray(0, result.bytesRead);
            const newlineIndex = chunk.indexOf(10);
            if (newlineIndex >= 0) {
                chunks.push(chunk.subarray(0, newlineIndex));
                return Buffer.concat(chunks).toString('utf8');
            }

            chunks.push(chunk);
            position += result.bytesRead;
        }
    } finally {
        await file.close();
    }
};

const parseFoundryManifestEnvelope = (filename: string, value: unknown): FoundryExportMarker => {
    if (!isRecord(value)) {
        throw createTaggedError('invalid-foundry-manifest', `${filename}: first line must contain a manifest envelope object`);
    }

    if (value.kind !== 'manifest') {
        throw createTaggedError('invalid-foundry-manifest', `${filename}: first line kind must be manifest`);
    }

    return parseFoundryManifest(filename, value.manifest);
};

const parseFoundryManifest = (filename: string, value: unknown): FoundryExportMarker => {
    if (!isRecord(value)) {
        throw createTaggedError('invalid-foundry-manifest', `${filename}: manifest must contain an object`);
    }

    const schemaVersion = value.schemaVersion;
    if (schemaVersion !== SUPPORTED_FOUNDRY_EXPORT_SCHEMA_VERSION) {
        throw createTaggedError('invalid-foundry-manifest', `${filename}: manifest.schemaVersion must be ${SUPPORTED_FOUNDRY_EXPORT_SCHEMA_VERSION}`);
    }

    const run = value.run;
    if (!isRecord(run)) {
        throw createTaggedError('invalid-foundry-manifest', `${filename}: manifest.run must contain an object`);
    }

    const runId = run.runId;
    const generatedAt = run.generatedAt;
    const recordCount = run.recordCount;
    const upsertCount = run.upsertCount;
    const deleteCount = run.deleteCount;

    if (typeof runId !== 'string' || runId.length === 0) {
        throw createTaggedError('invalid-foundry-manifest', `${filename}: manifest.run.runId must be a non-empty string`);
    }
    if (typeof generatedAt !== 'string' || generatedAt.length === 0) {
        throw createTaggedError('invalid-foundry-manifest', `${filename}: manifest.run.generatedAt must be a non-empty string`);
    }
    if (typeof recordCount !== 'number' || !Number.isInteger(recordCount) || recordCount < 0) {
        throw createTaggedError('invalid-foundry-manifest', `${filename}: manifest.run.recordCount must be a non-negative integer`);
    }
    if (typeof upsertCount !== 'number' || !Number.isInteger(upsertCount) || upsertCount < 0) {
        throw createTaggedError('invalid-foundry-manifest', `${filename}: manifest.run.upsertCount must be a non-negative integer`);
    }
    if (typeof deleteCount !== 'number' || !Number.isInteger(deleteCount) || deleteCount < 0) {
        throw createTaggedError('invalid-foundry-manifest', `${filename}: manifest.run.deleteCount must be a non-negative integer`);
    }

    return {
        deleteCount,
        filename,
        generatedAt,
        recordCount,
        runId,
        schemaVersion,
        upsertCount,
    };
};
