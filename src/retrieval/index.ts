export interface RetrievalResult {
  chunkId: string;
  content: string;
  citationLabel: string;
}

export interface RetrievalService {
  search(query: string): Promise<RetrievalResult[]>;
}
