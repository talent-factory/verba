import * as assert from 'assert';
import * as sinon from 'sinon';
import { applyConfig } from '../../config/verbaConfig';

suite('applyConfig', () => {
	test('applies transcription language, glossary, and expansions to the targets', () => {
		const targets = {
			setLanguage: sinon.stub(),
			setGlossary: sinon.stub(),
			setExpansions: sinon.stub(),
		};
		applyConfig(
			{
				transcriptionLanguage: 'de',
				language: 'auto',
				glossary: ['Verba'],
				expansions: [{ abbreviation: 'z', expansion: 'zum Beispiel' }],
				templates: [{ name: 'Freitext', prompt: 'noop' }],
				activeTemplate: { name: 'Freitext', prompt: 'noop' },
			},
			targets,
		);
		assert.ok(targets.setLanguage.calledOnceWith('de'));
		assert.ok(targets.setGlossary.calledOnceWith(['Verba']));
		assert.ok(targets.setExpansions.calledOnceWith([{ abbreviation: 'z', expansion: 'zum Beispiel' }]));
	});
});
