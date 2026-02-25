import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { VectorStore, IndexChunk } from './vectorStore';
import { EmbeddingService } from './embeddingService';

interface RawChunk {
	file: string;
	range: string;
	content: string;
}

export function chunkFileContent(file: string, content: string, maxLines: number = 50): RawChunk[] {
	if (!content.trim()) {
		return [];
	}

	const lines = content.split('\n');
	const chunks: RawChunk[] = [];

	for (let i = 0; i < lines.length; i += maxLines) {
		const slice = lines.slice(i, i + maxLines);
		const chunkContent = slice.join('\n').trim();
		if (chunkContent) {
			chunks.push({
				file,
				range: `${i + 1}-${Math.min(i + maxLines, lines.length)}`,
				content: chunkContent,
			});
		}
	}

	return chunks;
}

export class Indexer {
	private workspaceRoot: string;
	private store: VectorStore;
	private embeddingService: EmbeddingService;
	private fileHashes: Map<string, string> = new Map();

	constructor(workspaceRoot: string, indexDir: string, embeddingService: EmbeddingService) {
		this.workspaceRoot = workspaceRoot;
		this.store = new VectorStore(indexDir);
		this.embeddingService = embeddingService;
		this.store.load();
	}

	async indexFile(relativePath: string): Promise<number> {
		const absPath = path.join(this.workspaceRoot, relativePath);
		const content = fs.readFileSync(absPath, 'utf-8');
		const hash = crypto.createHash('sha256').update(content).digest('hex');

		if (this.fileHashes.get(relativePath) === hash) {
			return 0;
		}

		this.store.removeByFile(relativePath);
		const rawChunks = chunkFileContent(relativePath, content);

		if (rawChunks.length === 0) {
			this.fileHashes.set(relativePath, hash);
			return 0;
		}

		const texts = rawChunks.map(c => `// file: ${c.file} (lines ${c.range})\n${c.content}`);
		const vectors = await this.embeddingService.embedBatch(texts);

		const indexChunks: IndexChunk[] = rawChunks.map((c, i) => ({
			file: c.file,
			range: c.range,
			hash,
			content: c.content,
			vector: vectors[i],
		}));

		this.store.upsert(indexChunks);
		this.fileHashes.set(relativePath, hash);
		return indexChunks.length;
	}

	async indexAll(files: string[], onProgress?: (done: number, total: number) => void): Promise<number> {
		let totalChunks = 0;
		for (let i = 0; i < files.length; i++) {
			totalChunks += await this.indexFile(files[i]);
			onProgress?.(i + 1, files.length);
		}
		this.store.save();
		return totalChunks;
	}

	search(queryVector: number[], topK: number): IndexChunk[] {
		return this.store.search(queryVector, topK);
	}

	save(): void {
		this.store.save();
	}

	getFileHashes(): Map<string, string> {
		return new Map(this.fileHashes);
	}
}
