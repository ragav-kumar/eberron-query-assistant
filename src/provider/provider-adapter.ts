export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatAdapter {
  complete(messages: ChatMessage[]): Promise<string>;
}

export interface EmbeddingAdapter {
  embed(input: string): Promise<number[]>;
}
