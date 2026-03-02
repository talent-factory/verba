import * as fs from 'fs';
import * as path from 'path';

/** A chunk of source code with its embedding vector, stored in the local index. */
export interface IndexChunk {
	/** Relative file path within the workspace. */
	file: string;
	/** Line range within the file (e.g. `"1-50"`). */
	range: string;
	/** SHA-256 hash of the full file content at indexing time. */
	hash: string;
	/** The raw source code of this chunk. */
	content: string;
	/** The embedding vector produced by the OpenAI embedding model. */
	vector: number[];
}

interface IndexFile {
	version: 1;
	chunks: IndexChunk[];
}

/**
 * In-memory vector store backed by a JSON file on disk.
 * Supports upsert, removal, and cosine-similarity search over {@link IndexChunk}s.
 */
export class VectorStore {
	private chunks: IndexChunk[] = [];
	private indexDir: string;

	constructor(indexDir: string) {
		this.indexDir = indexDir;
	}

	/** Returns the number of chunks currently stored. */
	get size(): number {
		return this.chunks.length;
	}

	/** Inserts new chunks or replaces existing ones with the same file:range key. */
	upsert(newChunks: IndexChunk[]): void {
		for (const chunk of newChunks) {
			const key = `${chunk.file}:${chunk.range}`;
			const idx = this.chunks.findIndex(c => `${c.file}:${c.range}` === key);
			if (idx !== -1) {
				this.chunks[idx] = chunk;
			} else {
				this.chunks.push(chunk);
			}
		}
	}

	/** Removes all chunks belonging to the given file. */
	removeByFile(file: string): void {
		this.chunks = this.chunks.filter(c => c.file !== file);
	}

	/** Returns the top-K chunks most similar to the query vector (cosine similarity). */
	search(queryVector: number[], topK: number): IndexChunk[] {
		if (this.chunks.length === 0) {
			return [];
		}
		const scored = this.chunks.map(chunk => ({
			chunk,
			score: cosineSimilarity(queryVector, chunk.vector),
		}));
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, topK).map(s => s.chunk);
	}

	/** Persists the index to `index.json` inside the index directory. */
	save(): void {
		fs.mkdirSync(this.indexDir, { recursive: true });
		const data: IndexFile = { version: 1, chunks: this.chunks };
		fs.writeFileSync(
			path.join(this.indexDir, 'index.json'),
			JSON.stringify(data),
			'utf-8',
		);
	}

	/** Loads the index from disk. No-op if the index file does not exist yet. */
	load(): void {
		const filePath = path.join(this.indexDir, 'index.json');
		if (!fs.existsSync(filePath)) {
			return;
		}
		const raw = fs.readFileSync(filePath, 'utf-8');
		const data: unknown = JSON.parse(raw);

		if (typeof data !== 'object' || data === null || !Array.isArray((data as any).chunks)) {
			console.warn('[Verba] index.json has unexpected format, starting with empty index');
			return;
		}

		this.chunks = ((data as any).chunks as unknown[]).filter((c): c is IndexChunk =>
			typeof c === 'object' && c !== null
			&& typeof (c as any).file === 'string'
			&& typeof (c as any).range === 'string'
			&& typeof (c as any).content === 'string'
			&& Array.isArray((c as any).vector),
		);

		const skipped = (data as any).chunks.length - this.chunks.length;
		if (skipped > 0) {
			console.warn(`[Verba] Skipped ${skipped} malformed chunks in index.json`);
		}
	}
}

function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}
