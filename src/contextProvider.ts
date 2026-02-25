import { GrepaiProvider } from './grepaiProvider';
import { Indexer } from './indexer';
import { EmbeddingService } from './embeddingService';

type ProviderConfig =
	| { type: 'grepai'; grepai: GrepaiProvider }
	| { type: 'openai'; embeddingService: EmbeddingService; indexer: Indexer }
	| { type: 'none' };

export class ContextProvider {
	private config: ProviderConfig;

	constructor(config: ProviderConfig) {
		this.config = config;
	}

	get providerType(): string {
		return this.config.type;
	}

	isAvailable(): boolean {
		return this.config.type !== 'none';
	}

	async search(query: string, topK: number): Promise<string[]> {
		switch (this.config.type) {
			case 'grepai': {
				const results = this.config.grepai.search(query, topK);
				return results.map(r => `// file: ${r.file}\n${r.content}`);
			}
			case 'openai': {
				const queryVector = await this.config.embeddingService.embed(query);
				const chunks = this.config.indexer.search(queryVector, topK);
				return chunks.map(c => `// file: ${c.file} (lines ${c.range})\n${c.content}`);
			}
			case 'none':
				return [];
		}
	}
}
