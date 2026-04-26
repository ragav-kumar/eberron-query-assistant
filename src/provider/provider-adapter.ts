export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatAdapter {
  complete(messages: ChatMessage[]): Promise<string>;
}

export interface EmbeddingAdapter {
  modelId: string;
  schemaVersion: string;
  embed(input: string): Promise<number[]>;
}

export const createDeterministicEmbeddingAdapter = (): EmbeddingAdapter => {
  return {
    modelId: "local-deterministic-v1",
    schemaVersion: "local-vector-8",
    embed(input) {
      const vector = Array.from({ length: 8 }, () => 0);
      const words = input.toLowerCase().match(/[a-z0-9]+/g) ?? [];

      for (const word of words) {
        const index = stableWordIndex(word, vector.length);
        vector[index] = (vector[index] ?? 0) + 1;
      }

      const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
      return Promise.resolve(magnitude === 0 ? vector : vector.map((value) => value / magnitude));
    }
  };
};

const stableWordIndex = (word: string, modulo: number): number => {
  let hash = 0;
  for (const character of word) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash % modulo;
};
