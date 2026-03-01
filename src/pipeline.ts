/** Metadata passed through the pipeline to each processing stage. */
export interface PipelineContext {
	/** The system prompt text from the user's selected template, sent to Claude for post-processing. */
	templatePrompt?: string;
	/** Code snippets retrieved via semantic search for context-aware templates. */
	contextSnippets?: string[];
	/** Text that was selected in the editor when recording started. */
	selectedText?: string;
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
