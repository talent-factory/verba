import * as assert from 'assert';

import { deliver, type DeliveryPorts } from '../../delivery';
import type { DetectedSurface } from '@verba/core';

/** Tracked-calls fake DeliveryPorts; individual tests override behavior as needed. */
function ports(surface: DetectedSurface, overrides: Partial<DeliveryPorts> = {}): DeliveryPorts & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		detectSurface: async () => surface,
		herdrSend: async (paneId: string, _t: string, submit: boolean) => {
			calls.push(`herdr:${paneId}:${submit}`);
			return 'delivered';
		},
		paste: async (_t: string) => {
			calls.push('paste');
			return 'pasted';
		},
		pressEnter: async () => {
			calls.push('enter');
		},
		...overrides,
	};
}

suite('deliver', () => {
	test('agent+paneId+submit → herdr send-text + submit, no paste', async () => {
		const p = ports({ class: 'agent', agent: 'claude', paneId: 'wQ:p2' });
		const outcome = await deliver('run tests', 'submit', p);
		assert.deepEqual(p.calls, ['herdr:wQ:p2:true']);
		assert.strictEqual(outcome, 'herdr');
	});

	test('agent+paneId+insert → herdr send-text without submit', async () => {
		const p = ports({ class: 'agent', agent: 'claude', paneId: 'wQ:p2' });
		const outcome = await deliver('hello', 'insert', p);
		assert.deepEqual(p.calls, ['herdr:wQ:p2:false']);
		assert.strictEqual(outcome, 'herdr');
	});

	test('agent+paneId+submit, herdr resolves "delivered-not-submitted" → not-submitted, no paste, no pressEnter', async () => {
		const calls: string[] = [];
		const p: DeliveryPorts = {
			detectSurface: async () => ({ class: 'agent', agent: 'claude', paneId: 'wQ:p2' }),
			herdrSend: async (paneId: string, _t: string, submit: boolean) => {
				calls.push(`herdr:${paneId}:${submit}`);
				return 'delivered-not-submitted';
			},
			paste: async () => {
				calls.push('paste');
				return 'pasted';
			},
			pressEnter: async () => {
				calls.push('enter');
			},
		};
		const outcome = await deliver('run tests', 'submit', p);
		assert.deepEqual(calls, ['herdr:wQ:p2:true']);
		assert.strictEqual(outcome, 'not-submitted');
	});

	test('agent+paneId, herdr rejects (nothing landed) → paste fallback once (+enter on submit)', async () => {
		const calls: string[] = [];
		const p: DeliveryPorts = {
			detectSurface: async () => ({ class: 'agent', agent: 'claude', paneId: 'wQ:p2' }),
			herdrSend: async () => {
				throw new Error('herdr down');
			},
			paste: async () => {
				calls.push('paste');
				return 'pasted';
			},
			pressEnter: async () => {
				calls.push('enter');
			},
		};
		const outcome = await deliver('run tests', 'submit', p);
		assert.deepEqual(calls, ['paste', 'enter']);
		assert.strictEqual(calls.filter((c) => c === 'paste').length, 1, 'paste must be called exactly once — no double delivery');
		assert.strictEqual(outcome, 'pasted');
	});

	test('paste path, submit+agent, pressEnter rejects → not-submitted (paste already landed, not re-thrown)', async () => {
		const calls: string[] = [];
		const p: DeliveryPorts = {
			detectSurface: async () => ({ class: 'agent', agent: 'claude' }), // no paneId → paste path
			herdrSend: async () => {
				throw new Error('unused');
			},
			paste: async () => {
				calls.push('paste');
				return 'pasted';
			},
			pressEnter: async () => {
				calls.push('enter');
				throw new Error('Enter failed: could not create event source');
			},
		};
		const outcome = await deliver('run tests', 'submit', p);
		assert.deepEqual(calls, ['paste', 'enter']);
		assert.strictEqual(outcome, 'not-submitted');
	});

	test('agent without paneId + submit → paste + enter', async () => {
		const calls: string[] = [];
		const outcome = await deliver('go', 'submit', {
			detectSurface: async () => ({ class: 'agent', agent: 'codex' }),
			herdrSend: async () => {
				throw new Error('unused');
			},
			paste: async () => {
				calls.push('paste');
				return 'pasted';
			},
			pressEnter: async () => {
				calls.push('enter');
			},
		});
		assert.deepEqual(calls, ['paste', 'enter']);
		assert.strictEqual(outcome, 'pasted');
	});

	test('generic surface + submit → paste only, never enter', async () => {
		const calls: string[] = [];
		const outcome = await deliver('note text', 'submit', {
			detectSurface: async () => ({ class: 'generic' }),
			herdrSend: async () => {
				throw new Error('unused');
			},
			paste: async () => {
				calls.push('paste');
				return 'pasted';
			},
			pressEnter: async () => {
				calls.push('enter');
			},
		});
		assert.deepEqual(calls, ['paste']);
		assert.strictEqual(outcome, 'pasted');
	});

	test('detectSurface throws → treated as generic → paste', async () => {
		const calls: string[] = [];
		const outcome = await deliver('x', 'insert', {
			detectSurface: async () => {
				throw new Error('detect failed');
			},
			herdrSend: async () => {
				throw new Error('unused');
			},
			paste: async () => {
				calls.push('paste');
				return 'pasted';
			},
			pressEnter: async () => {
				calls.push('enter');
			},
		});
		assert.deepEqual(calls, ['paste']);
		assert.strictEqual(outcome, 'pasted');
	});

	test('secure input → deliver returns secure-input and never presses Enter', async () => {
		// Under Secure Event Input the paste port leaves the transcript on the
		// clipboard and reports 'secure-input'. `deliver` must surface that and
		// must NOT fire Enter (it would be swallowed too), even for submit on an
		// agent surface.
		const calls: string[] = [];
		const outcome = await deliver('run tests', 'submit', {
			detectSurface: async () => ({ class: 'agent', agent: 'codex' }),
			herdrSend: async () => {
				throw new Error('unused');
			},
			paste: async () => {
				calls.push('paste');
				return 'secure-input';
			},
			pressEnter: async () => {
				calls.push('enter');
			},
		});
		assert.deepEqual(calls, ['paste']);
		assert.strictEqual(outcome, 'secure-input');
	});
});
