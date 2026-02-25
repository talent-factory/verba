export interface PipelineContext {
	templatePrompt?: string;
	contextSnippets?: string[];
}

export interface ProcessingStage {
	readonly name: string;
	process(input: string, context?: PipelineContext): Promise<string>;
}

export class DictationPipeline {
	private stages: ProcessingStage[] = [];

	addStage(stage: ProcessingStage): void {
		this.stages.push(stage);
	}

	async run(input: string, context?: PipelineContext): Promise<string> {
		let result = input;
		for (const stage of this.stages) {
			result = await stage.process(result, context);
		}
		return result;
	}
}
