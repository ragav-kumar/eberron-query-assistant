export interface TextChunk {
  text: string;
  startParagraph: number;
  endParagraph: number;
}

const TARGET_CHUNK_CHARACTERS = 1_600;

export const chunkText = (text: string, targetCharacters = TARGET_CHUNK_CHARACTERS): TextChunk[] => {
  const paragraphs = normalizeText(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const chunks: TextChunk[] = [];
  let current: string[] = [];
  let currentStart = 0;
  let currentLength = 0;

  for (const [index, paragraph] of paragraphs.entries()) {
    if (current.length > 0 && currentLength + paragraph.length + 2 > targetCharacters) {
      chunks.push({
        text: current.join("\n\n"),
        startParagraph: currentStart,
        endParagraph: index - 1
      });
      current = [];
      currentLength = 0;
      currentStart = index;
    }

    if (current.length === 0) {
      currentStart = index;
    }

    current.push(paragraph);
    currentLength += paragraph.length + 2;
  }

  if (current.length > 0) {
    chunks.push({
      text: current.join("\n\n"),
      startParagraph: currentStart,
      endParagraph: paragraphs.length - 1
    });
  }

  return chunks;
};

export const normalizeText = (text: string): string => {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};
