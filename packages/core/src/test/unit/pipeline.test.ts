import * as assert from 'assert';
import { DictationPipeline, PipelineContext, ProcessingStage } from '../../pipeline';

function createStage(name: string, transform: (input: string) => string): ProcessingStage {
	return {
		name,
		process: async (input: string) => transform(input),
	};
}

suite('DictationPipeline', () => {
	let pipeline: DictationPipeline;

	setup(() => {
		pipeline = new DictationPipeline();
	});

	test('returns input unchanged when no stages are added', async () => {
		const result = await pipeline.run('hello');
		assert.strictEqual(result, 'hello');
	});

	test('runs a single stage', async () => {
		pipeline.addStage(createStage('upper', (s) => s.toUpperCase()));
		const result = await pipeline.run('hello');
		assert.strictEqual(result, 'HELLO');
	});

	test('chains multiple stages in order', async () => {
		pipeline.addStage(createStage('prefix', (s) => `[${s}]`));
		pipeline.addStage(createStage('upper', (s) => s.toUpperCase()));
		const result = await pipeline.run('hello');
		assert.strictEqual(result, '[HELLO]');
	});

	test('propagates stage errors', async () => {
		pipeline.addStage({
			name: 'failing',
			process: async () => { throw new Error('stage failed'); },
		});
		await assert.rejects(
			() => pipeline.run('input'),
			/stage failed/
		);
	});

	test('stops execution on first error', async () => {
		let secondCalled = false;
		pipeline.addStage({
			name: 'failing',
			process: async () => { throw new Error('boom'); },
		});
		pipeline.addStage({
			name: 'second',
			process: async (input) => { secondCalled = true; return input; },
		});

		await assert.rejects(() => pipeline.run('input'), /boom/);
		assert.strictEqual(secondCalled, false);
	});

	test('passes context to each stage', async () => {
		let capturedContext: PipelineContext | undefined;
		pipeline.addStage({
			name: 'capture',
			process: async (input: string, context?: PipelineContext) => {
				capturedContext = context;
				return input;
			},
		});
		await pipeline.run('hello', { templatePrompt: 'test prompt' });
		assert.deepStrictEqual(capturedContext, { templatePrompt: 'test prompt' });
	});

	test('passes context through multiple stages', async () => {
		const capturedContexts: (PipelineContext | undefined)[] = [];
		pipeline.addStage({
			name: 'first',
			process: async (input: string, context?: PipelineContext) => {
				capturedContexts.push(context);
				return input.toUpperCase();
			},
		});
		pipeline.addStage({
			name: 'second',
			process: async (input: string, context?: PipelineContext) => {
				capturedContexts.push(context);
				return `[${input}]`;
			},
		});
		const ctx = { templatePrompt: 'my prompt' };
		const result = await pipeline.run('hello', ctx);
		assert.strictEqual(result, '[HELLO]');
		assert.strictEqual(capturedContexts.length, 2);
		assert.deepStrictEqual(capturedContexts[0], ctx);
		assert.deepStrictEqual(capturedContexts[1], ctx);
	});

	test('works without context for backward compatibility', async () => {
		pipeline.addStage(createStage('upper', (s) => s.toUpperCase()));
		const result = await pipeline.run('hello');
		assert.strictEqual(result, 'HELLO');
	});

	test('passes contextSnippets through to stages', async () => {
		let capturedContext: PipelineContext | undefined;
		pipeline.addStage({
			name: 'capture',
			process: async (input: string, context?: PipelineContext) => {
				capturedContext = context;
				return input;
			},
		});
		const ctx: PipelineContext = {
			templatePrompt: 'test',
			contextSnippets: ['function foo() { return 1; }'],
		};
		await pipeline.run('hello', ctx);
		assert.deepStrictEqual(capturedContext?.contextSnippets, ['function foo() { return 1; }']);
	});
});
