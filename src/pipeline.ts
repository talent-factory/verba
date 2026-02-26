/** Metadata passed through the pipeline to each processing stage. */
export interface PipelineContext {
	/** The prompt template selected by the user (e.g. "Freitext", "Commit Message"). */
	templatePrompt?: string;
	/** Code snippets retrieved via semantic search for context-aware templates. */
	contextSnippets?: string[];
}

/** A single step in the dictation processing pipeline. */
export interface ProcessingStage {
	readonly name: string;
	/** Transforms the input text, optionally using pipeline context. */
	process(input: string, context?: PipelineContext): Promise<string>;
}

/**
 * Executes a sequence of {@link ProcessingStage}s, passing each stage's output
 * as the next stage's input (pipeline / pipes-and-filters).
 */
export class DictationPipeline {
	private stages: ProcessingStage[] = [];

	/** Appends a stage to the end of the pipeline. */
	addStage(stage: ProcessingStage): void {
		this.stages.push(stage);
	}

	/** Runs all stages sequentially and returns the final result. */
	async run(input: string, context?: PipelineContext): Promise<string> {
		let result = input;
		for (const stage of this.stages) {
			result = await stage.process(result, context);
		}
		return result;
	}
}
