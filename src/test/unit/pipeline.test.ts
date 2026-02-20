import * as assert from 'assert';
import { DictationPipeline, ProcessingStage } from '../../pipeline';

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
});
