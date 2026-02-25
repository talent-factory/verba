import * as fs from 'fs';
import * as path from 'path';

export interface IndexChunk {
	file: string;
	range: string;
	hash: string;
	content: string;
	vector: number[];
}

interface IndexFile {
	version: 1;
	chunks: IndexChunk[];
}

export class VectorStore {
	private chunks: IndexChunk[] = [];
	private indexDir: string;

	constructor(indexDir: string) {
		this.indexDir = indexDir;
	}

	get size(): number {
		return this.chunks.length;
	}

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

	removeByFile(file: string): void {
		this.chunks = this.chunks.filter(c => c.file !== file);
	}

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

	save(): void {
		fs.mkdirSync(this.indexDir, { recursive: true });
		const data: IndexFile = { version: 1, chunks: this.chunks };
		fs.writeFileSync(
			path.join(this.indexDir, 'index.json'),
			JSON.stringify(data),
			'utf-8',
		);
	}

	load(): void {
		const filePath = path.join(this.indexDir, 'index.json');
		if (!fs.existsSync(filePath)) {
			return;
		}
		const raw = fs.readFileSync(filePath, 'utf-8');
		const data: IndexFile = JSON.parse(raw);
		this.chunks = data.chunks;
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
