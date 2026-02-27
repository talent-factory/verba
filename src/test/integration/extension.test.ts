import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension', () => {
	suiteSetup(async () => {
		const ext = vscode.extensions.getExtension('talent-factory.verba');
		if (ext && !ext.isActive) {
			await ext.activate();
		}
	});

	test('extension activates successfully', () => {
		const ext = vscode.extensions.getExtension('talent-factory.verba');
		assert.ok(ext, 'Extension talent-factory.verba not found');
		assert.strictEqual(ext.isActive, true);
	});

	test('dictation.start command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('dictation.start'),
			'dictation.start command not found in registered commands'
		);
	});

	test('command execution handles expected errors gracefully', async () => {
		try {
			// Race against a timeout: the command may block on a QuickPick
			// waiting for user input that never comes in test environments.
			await Promise.race([
				vscode.commands.executeCommand('dictation.start'),
				new Promise<void>((resolve) => setTimeout(resolve, 3000)),
			]);
		} catch (err: unknown) {
			// In test environments, ffmpeg may not be available or we may not be on macOS.
			// Verify the error is one of the known, expected failures.
			const message = err instanceof Error ? err.message : String(err);
			const expectedPatterns = [
				/ffmpeg not found/,
				/only supported on macOS/,
				/Microphone access denied/,
			];
			const isExpected = expectedPatterns.some(p => p.test(message));
			assert.ok(
				isExpected,
				`Command threw an unexpected error: ${message}`
			);
		}
	});
});
