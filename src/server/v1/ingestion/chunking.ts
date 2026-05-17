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
  let currentEnd = 0;
  let currentLength = 0;

  for (const [index, paragraph] of paragraphs.entries()) {
    for (const segment of splitOversizedParagraph(paragraph, targetCharacters)) {
      if (current.length > 0 && currentLength + segment.length + 2 > targetCharacters) {
        chunks.push({
          text: current.join('\n\n'),
          startParagraph: currentStart,
          endParagraph: currentEnd
        });
        current = [];
        currentLength = 0;
        currentStart = index;
        currentEnd = index;
      }

      if (current.length === 0) {
        currentStart = index;
      }

      current.push(segment);
      currentEnd = index;
      currentLength += segment.length + 2;
    }
  }

  if (current.length > 0) {
    chunks.push({
      text: current.join('\n\n'),
      startParagraph: currentStart,
      endParagraph: currentEnd
    });
  }

  return chunks;
};

const splitOversizedParagraph = (paragraph: string, targetCharacters: number): string[] => {
  if (paragraph.length <= targetCharacters) {
    return [paragraph];
  }

  const segments: string[] = [];
  let remaining = paragraph;

  while (remaining.length > targetCharacters) {
    const whitespaceIndex = remaining.lastIndexOf(' ', targetCharacters);
    const splitIndex =
      whitespaceIndex >= Math.floor(targetCharacters * 0.6) ? whitespaceIndex : targetCharacters;
    const segment = remaining.slice(0, splitIndex).trim();
    if (segment.length > 0) {
      segments.push(segment);
    }
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining.length > 0) {
    segments.push(remaining);
  }

  return segments;
};

export const normalizeText = (text: string): string => text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
