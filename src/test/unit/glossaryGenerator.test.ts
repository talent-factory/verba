import * as assert from 'assert';

import { filterTerms, STOPWORDS, GlossaryGenerator } from '../../glossaryGenerator';

suite('filterTerms', () => {
	test('removes terms shorter than 3 characters', () => {
		const result = filterTerms(['ab', 'cd', 'TypeScript', 'Go'], []);
		assert.deepStrictEqual(result, ['TypeScript']);
	});

	test('removes stopwords', () => {
		const result = filterTerms(['constructor', 'Verba', 'module', 'Pipeline'], []);
		assert.deepStrictEqual(result, ['Pipeline', 'Verba']);
	});

	test('removes already existing glossary terms', () => {
		const result = filterTerms(['Verba', 'Claude', 'Whisper'], ['Claude']);
		assert.deepStrictEqual(result, ['Verba', 'Whisper']);
	});

	test('deduplicates terms', () => {
		const result = filterTerms(['Verba', 'Claude', 'Verba', 'Claude'], []);
		assert.deepStrictEqual(result, ['Claude', 'Verba']);
	});

	test('sorts alphabetically', () => {
		const result = filterTerms(['Zebra', 'Alpha', 'Mango'], []);
		assert.deepStrictEqual(result, ['Alpha', 'Mango', 'Zebra']);
	});

	test('returns empty array for all-filtered input', () => {
		const result = filterTerms(['ab', 'constructor', 'module'], []);
		assert.deepStrictEqual(result, []);
	});
});
