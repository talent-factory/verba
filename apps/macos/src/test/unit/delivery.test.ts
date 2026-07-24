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
		},
		paste: async (_t: string) => {
			calls.push('paste');
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
		await deliver('run tests', 'submit', p);
		assert.deepEqual(p.calls, ['herdr:wQ:p2:true']);
	});

	test('agent+paneId+insert → herdr send-text without submit', async () => {
		const p = ports({ class: 'agent', agent: 'claude', paneId: 'wQ:p2' });
		await deliver('hello', 'insert', p);
		assert.deepEqual(p.calls, ['herdr:wQ:p2:false']);
	});

	test('agent+paneId, herdr throws → paste fallback (+enter on submit)', async () => {
		const calls: string[] = [];
		const p: DeliveryPorts = {
			detectSurface: async () => ({ class: 'agent', agent: 'claude', paneId: 'wQ:p2' }),
			herdrSend: async () => {
				throw new Error('herdr down');
			},
			paste: async () => {
				calls.push('paste');
			},
			pressEnter: async () => {
				calls.push('enter');
			},
		};
		await deliver('run tests', 'submit', p);
		assert.deepEqual(calls, ['paste', 'enter']);
	});

	test('agent without paneId + submit → paste + enter', async () => {
		const calls: string[] = [];
		await deliver('go', 'submit', {
			detectSurface: async () => ({ class: 'agent', agent: 'codex' }),
			herdrSend: async () => {
				throw new Error('unused');
			},
			paste: async () => {
				calls.push('paste');
			},
			pressEnter: async () => {
				calls.push('enter');
			},
		});
		assert.deepEqual(calls, ['paste', 'enter']);
	});

	test('generic surface + submit → paste only, never enter', async () => {
		const calls: string[] = [];
		await deliver('note text', 'submit', {
			detectSurface: async () => ({ class: 'generic' }),
			herdrSend: async () => {
				throw new Error('unused');
			},
			paste: async () => {
				calls.push('paste');
			},
			pressEnter: async () => {
				calls.push('enter');
			},
		});
		assert.deepEqual(calls, ['paste']);
	});

	test('detectSurface throws → treated as generic → paste', async () => {
		const calls: string[] = [];
		await deliver('x', 'insert', {
			detectSurface: async () => {
				throw new Error('detect failed');
			},
			herdrSend: async () => {
				throw new Error('unused');
			},
			paste: async () => {
				calls.push('paste');
			},
			pressEnter: async () => {
				calls.push('enter');
			},
		});
		assert.deepEqual(calls, ['paste']);
	});
});
