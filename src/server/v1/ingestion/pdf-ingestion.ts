import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PdfData, VerbosityLevel } from "pdfdataextract";

import type { CorpusChunk, CorpusSource, RuntimeConfig } from "@/types.js";
import { chunkText, normalizeText } from "./chunking.js";

export interface ParsedPdfPage {
  pageNumber: number;
  text: string;
}

export interface ParsedPdf {
  pageCount: number;
  fingerprint: string | null;
  title: string | null;
  pages: ParsedPdfPage[];
}

export interface PdfParser {
  parse(filePath: string): Promise<ParsedPdf>;
}

export const createPdfDataExtractParser = (): PdfParser => {
  return {
    async parse(filePath) {
      const data = await PdfData.extract(await readFile(filePath), {
        sort: true,
        verbosity: VerbosityLevel.ERRORS,
        get: {
          pages: true,
          text: true,
          fingerprint: true,
          info: true,
          metadata: false,
          outline: false,
          permissions: false
        }
      });

      const text = data.text ?? [];
      return {
        pageCount: data.pages ?? text.length,
        fingerprint: data.fingerprint ?? null,
        title: typeof data.info?.Title === "string" && data.info.Title.trim().length > 0 ? data.info.Title.trim() : null,
        pages: text.map((pageText, index) => ({
          pageNumber: index + 1,
          text: normalizeText(pageText)
        }))
      };
    }
  };
};

export const normalizePdf = async (
  config: RuntimeConfig,
  filename: string,
  parser: PdfParser
): Promise<{ source: CorpusSource; chunks: CorpusChunk[] }> => {
  const filePath = path.join(config.pdfDir, filename);
  const parsed = await parser.parse(filePath);
  const title = parsed.title ?? friendlyTitle(filename);
  const sourceKey = filename;
  const sourceId = `pdf:${hashText(sourceKey)}`;

  const source: CorpusSource = {
    sourceId,
    sourceType: "pdf",
    sourceKey,
    title,
    status: "succeeded",
    metadata: {
      sourceType: "pdf",
      filename,
      title,
      pageCount: parsed.pageCount,
      fingerprint: parsed.fingerprint
    }
  };

  const chunks: CorpusChunk[] = [];
  for (const page of parsed.pages) {
    for (const chunk of chunkText(page.text)) {
      if (chunk.text.length === 0) {
        continue;
      }

      const chunkIndex = chunks.length;
      chunks.push({
        chunkId: `${sourceId}:chunk:${chunkIndex}`,
        sourceId,
        chunkIndex,
        text: chunk.text,
        citation: {
          sourceType: "pdf",
          label: title,
          locator: `page ${page.pageNumber}`,
          url: null
        },
        metadata: {
          sourceType: "pdf",
          filename,
          pageNumber: page.pageNumber,
          startParagraph: chunk.startParagraph,
          endParagraph: chunk.endParagraph
        }
      });
    }
  }

  return { source, chunks };
};

const friendlyTitle = (filename: string): string => {
  return path
    .basename(filename, path.extname(filename))
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const hashText = (text: string): string => {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
};
