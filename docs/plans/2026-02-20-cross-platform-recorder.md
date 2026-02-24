# Cross-Platform Audio-Aufnahme Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** FfmpegRecorder soll auf macOS, Linux (PulseAudio) und Windows (DirectShow mit Auto-Detect) funktionieren.

**Architecture:** Eine `getPlatformAudioConfig()` Methode in `recorder.ts` liefert pro Plattform die ffmpeg-Input-Argumente. `findFfmpeg()` wird um plattformspezifische Suchpfade erweitert. Windows erhaelt eine `detectWindowsAudioDevice()` Methode, die das erste Audio-Geraet automatisch erkennt.

**Tech Stack:** TypeScript, Node.js child_process (spawn/execSync), ffmpeg

---

### Task 1: getPlatformAudioConfig() -- Tests schreiben und Platform-Check ersetzen

**Files:**
- Modify: `src/recorder.ts:40-42` (Platform-Check ersetzen)
- Modify: `src/recorder.ts:52-59` (spawn-Argumente dynamisieren)
- Modify: `src/test/unit/recorder.test.ts:81-93` (Platform-Test anpassen)

**Step 1: Bestehenden Platform-Test anpassen**

Der Test `should throw on non-macOS platform` muss zu `should throw on unsupported platform` werden. Linux und Windows sind jetzt erlaubt, aber z.B. `freebsd` nicht.

In `src/test/unit/recorder.test.ts`, den Test bei Zeile 81 ersetzen:

```typescript
test('should throw on unsupported platform', async () => {
	const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
	Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
	try {
		await assert.rejects(
			() => recorder.start(),
			/Unsupported platform: freebsd/
		);
	} finally {
		if (originalDescriptor) {
			Object.defineProperty(process, 'platform', originalDescriptor);
		}
	}
});
```

**Step 2: Tests fuer getPlatformAudioConfig() hinzufuegen**

Am Ende der `start()` Suite in `src/test/unit/recorder.test.ts` hinzufuegen:

```typescript
test('should use avfoundation input on macOS', async () => {
	await startRecording();
	const spawnCall = (child_process.spawn as sinon.SinonStub).firstCall;
	const args: string[] = spawnCall.args[1];
	assert.ok(args.includes('avfoundation'), 'should use avfoundation');
	assert.ok(args.includes(':default'), 'should use :default device');
});

test('should use pulse input on Linux', async () => {
	const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
	Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
	try {
		// Also stub Linux ffmpeg path
		(fs.existsSync as sinon.SinonStub).callsFake(
			(p) => p === '/usr/bin/ffmpeg'
		);
		await startRecording();
		const spawnCall = (child_process.spawn as sinon.SinonStub).firstCall;
		const args: string[] = spawnCall.args[1];
		assert.ok(args.includes('pulse'), 'should use pulse');
		assert.ok(args.includes('default'), 'should use default device');
	} finally {
		if (originalDescriptor) {
			Object.defineProperty(process, 'platform', originalDescriptor);
		}
	}
});
```

**Step 3: Tests ausfuehren -- muessen fehlschlagen**

Run: `npm run compile && npm run test:unit`
Expected: FAIL -- `Unsupported platform` und `avfoundation`/`pulse` Tests schlagen fehl, weil `recorder.ts` noch den alten darwin-Check hat.

**Step 4: getPlatformAudioConfig() implementieren**

In `src/recorder.ts`, nach den Imports ein Interface und die Methode als private Klassenmethode hinzufuegen.

Den Platform-Check in `start()` (Zeilen 40-42) ersetzen:

```typescript
// Vorher:
if (process.platform !== 'darwin') {
	throw new Error('Microphone recording is currently only supported on macOS.');
}

// Nachher: (entfernen, Config kommt spaeter)
```

Neue private Methode in der Klasse:

```typescript
private getPlatformAudioConfig(): { inputFormat: string; inputDevice: string } {
	switch (process.platform) {
		case 'darwin':
			return { inputFormat: 'avfoundation', inputDevice: ':default' };
		case 'linux':
			return { inputFormat: 'pulse', inputDevice: 'default' };
		case 'win32':
			return { inputFormat: 'dshow', inputDevice: this.detectWindowsAudioDevice() };
		default:
			throw new Error(`Unsupported platform: ${process.platform}. Verba supports macOS, Linux, and Windows.`);
	}
}
```

Die `start()` Methode anpassen -- nach dem ffmpegPath-Check:

```typescript
const { inputFormat, inputDevice } = this.getPlatformAudioConfig();
```

Und die spawn-Argumente dynamisieren:

```typescript
// Vorher:
this.process = spawn(ffmpegPath, [
	'-f', 'avfoundation',
	'-i', ':default',
	'-ar', '16000',
	...
]);

// Nachher:
this.process = spawn(ffmpegPath, [
	'-f', inputFormat,
	'-i', inputDevice,
	'-ar', '16000',
	'-ac', '1',
	'-acodec', 'pcm_s16le',
	'-y',
	this._outputPath,
], {
	stdio: ['pipe', 'pipe', 'pipe'],
});
```

Einen temporaeren Stub fuer `detectWindowsAudioDevice()`:

```typescript
private detectWindowsAudioDevice(): string {
	throw new Error('Windows audio device detection not yet implemented');
}
```

Den JSDoc-Kommentar der Klasse aktualisieren:

```typescript
/**
 * Records microphone audio to a WAV file using ffmpeg as a child process.
 *
 * Platform: macOS (avfoundation), Linux (PulseAudio), Windows (DirectShow).
 * External dependency: Requires ffmpeg to be installed.
 * Lifecycle: start() -> stop() returns file path, or dispose() for cleanup.
 * Graceful stop sends 'q' to stdin so ffmpeg finalizes WAV headers correctly.
 */
```

**Step 5: Tests ausfuehren -- muessen bestehen**

Run: `npm run compile && npm run test:unit`
Expected: PASS -- Alle Tests bestehen.

**Step 6: Commit**

```bash
git add src/recorder.ts src/test/unit/recorder.test.ts
git commit -m "✨ feat: Platform-Config-Map fuer macOS/Linux/Windows einfuehren"
```

---

### Task 2: findFfmpeg() plattformspezifisch erweitern

**Files:**
- Modify: `src/recorder.ts:236-263` (findFfmpeg Methode)
- Modify: `src/test/unit/recorder.test.ts:56-58` (existsSync Stub anpassen)
- Modify: `src/test/unit/recorder.test.ts:96-103` (ffmpeg-not-found Test)

**Step 1: Test fuer plattformspezifische ffmpeg-Suche hinzufuegen**

In `src/test/unit/recorder.test.ts`, nach dem bestehenden `should throw when ffmpeg is not found` Test:

```typescript
test('should find ffmpeg at /usr/bin/ffmpeg on Linux', async () => {
	const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
	Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
	try {
		(fs.existsSync as sinon.SinonStub).callsFake(
			(p) => p === '/usr/bin/ffmpeg'
		);
		await startRecording();
		const spawnCall = (child_process.spawn as sinon.SinonStub).firstCall;
		assert.strictEqual(spawnCall.args[0], '/usr/bin/ffmpeg');
	} finally {
		if (originalDescriptor) {
			Object.defineProperty(process, 'platform', originalDescriptor);
		}
	}
});

test('should use where command on Windows to find ffmpeg', async () => {
	const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
	Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
	try {
		(fs.existsSync as sinon.SinonStub).returns(false);
		sinon.stub(child_process, 'execSync')
			.withArgs('where ffmpeg', sinon.match.any)
			.returns('C:\\ffmpeg\\bin\\ffmpeg.exe\r\n');
		// Stub detectWindowsAudioDevice to avoid side effects
		sinon.stub(FfmpegRecorder.prototype as any, 'detectWindowsAudioDevice')
			.returns('audio="Microphone"');
		await startRecording();
		const spawnCall = (child_process.spawn as sinon.SinonStub).firstCall;
		assert.strictEqual(spawnCall.args[0], 'C:\\ffmpeg\\bin\\ffmpeg.exe');
	} finally {
		if (originalDescriptor) {
			Object.defineProperty(process, 'platform', originalDescriptor);
		}
	}
});
```

Den bestehenden ffmpeg-not-found Test anpassen, damit die Fehlermeldung plattformspezifisch ist:

```typescript
test('should throw when ffmpeg is not found', async () => {
	(fs.existsSync as sinon.SinonStub).returns(false);
	sinon.stub(child_process, 'execSync').throws(new Error('not found'));

	await assert.rejects(
		() => recorder.start(),
		/ffmpeg not found/
	);
});
```

**Step 2: Tests ausfuehren -- muessen fehlschlagen**

Run: `npm run compile && npm run test:unit`
Expected: FAIL -- Linux-Pfad und Windows-where Tests schlagen fehl.

**Step 3: findFfmpeg() implementieren**

In `src/recorder.ts`, die `findFfmpeg()` Methode ersetzen:

```typescript
private findFfmpeg(): string | null {
	const candidates = this.getFfmpegCandidatePaths();

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}

	const whichCommand = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
	try {
		const result = execSync(whichCommand, {
			encoding: 'utf-8',
			timeout: 5000,
		}).trim().split(/\r?\n/)[0]; // where returns multiple lines on Windows
		if (result) {
			return result;
		}
	} catch (err: unknown) {
		const detail = err instanceof Error ? err.message : String(err);
		console.warn(`[Verba] "${whichCommand}" lookup failed: ${detail}`);
	}

	return null;
}

private getFfmpegCandidatePaths(): string[] {
	switch (process.platform) {
		case 'darwin':
			return ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
		case 'linux':
			return ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
		case 'win32':
			return []; // Windows relies on PATH/where
		default:
			return [];
	}
}
```

Die ffmpeg-not-found Fehlermeldung plattformspezifisch machen:

```typescript
if (!ffmpegPath) {
	const installHint = process.platform === 'darwin'
		? 'Install it via: brew install ffmpeg'
		: process.platform === 'win32'
			? 'Download from https://ffmpeg.org/download.html and add to PATH'
			: 'Install it via: sudo apt install ffmpeg (Debian/Ubuntu) or sudo dnf install ffmpeg (Fedora)';
	throw new Error(`ffmpeg not found. ${installHint}`);
}
```

**Step 4: Tests ausfuehren -- muessen bestehen**

Run: `npm run compile && npm run test:unit`
Expected: PASS

**Step 5: Commit**

```bash
git add src/recorder.ts src/test/unit/recorder.test.ts
git commit -m "✨ feat: ffmpeg-Suche plattformspezifisch erweitern (macOS/Linux/Windows)"
```

---

### Task 3: Windows Audio-Device Auto-Detection implementieren

**Files:**
- Modify: `src/recorder.ts` (detectWindowsAudioDevice implementieren)
- Modify: `src/test/unit/recorder.test.ts` (Detection-Tests)

**Step 1: Tests fuer detectWindowsAudioDevice schreiben**

In `src/test/unit/recorder.test.ts`, eine neue Suite nach `dispose()`:

```typescript
suite('detectWindowsAudioDevice()', () => {
	test('should parse first audio device from ffmpeg output', () => {
		const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
		Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
		try {
			const stderr = [
				'[dshow @ 0000020] DirectShow video devices',
				'[dshow @ 0000020]  "HD Webcam"',
				'[dshow @ 0000020] DirectShow audio devices',
				'[dshow @ 0000020]  "Microphone (Realtek High Definition Audio)"',
				'[dshow @ 0000020]  "Stereo Mix (Realtek High Definition Audio)"',
			].join('\n');

			const execSyncStub = sinon.stub(child_process, 'execSync');
			execSyncStub.throws({ stderr });

			const result = (recorder as any).detectWindowsAudioDevice();
			assert.strictEqual(result, 'audio=Microphone (Realtek High Definition Audio)');
		} finally {
			if (originalDescriptor) {
				Object.defineProperty(process, 'platform', originalDescriptor);
			}
		}
	});

	test('should throw when no audio device found', () => {
		const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
		Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
		try {
			const stderr = [
				'[dshow @ 0000020] DirectShow video devices',
				'[dshow @ 0000020]  "HD Webcam"',
				'[dshow @ 0000020] DirectShow audio devices',
			].join('\n');

			const execSyncStub = sinon.stub(child_process, 'execSync');
			execSyncStub.throws({ stderr });

			assert.throws(
				() => (recorder as any).detectWindowsAudioDevice(),
				/No audio input device found/
			);
		} finally {
			if (originalDescriptor) {
				Object.defineProperty(process, 'platform', originalDescriptor);
			}
		}
	});

	test('should throw when ffmpeg list_devices fails without stderr', () => {
		const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
		Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
		try {
			const execSyncStub = sinon.stub(child_process, 'execSync');
			execSyncStub.throws(new Error('Command failed'));

			assert.throws(
				() => (recorder as any).detectWindowsAudioDevice(),
				/No audio input device found|detect/i
			);
		} finally {
			if (originalDescriptor) {
				Object.defineProperty(process, 'platform', originalDescriptor);
			}
		}
	});
});
```

**Step 2: Tests ausfuehren -- muessen fehlschlagen**

Run: `npm run compile && npm run test:unit`
Expected: FAIL -- `detectWindowsAudioDevice` wirft `not yet implemented`.

**Step 3: detectWindowsAudioDevice() implementieren**

In `src/recorder.ts`, den Stub ersetzen:

```typescript
private detectWindowsAudioDevice(): string {
	let stderr = '';
	try {
		execSync('ffmpeg -list_devices true -f dshow -i dummy', {
			encoding: 'utf-8',
			timeout: 10000,
		});
	} catch (err: unknown) {
		// ffmpeg -list_devices always exits with error code 1, output is in stderr
		if (err && typeof err === 'object' && 'stderr' in err) {
			stderr = String((err as { stderr: unknown }).stderr);
		}
	}

	const lines = stderr.split('\n');
	let inAudioSection = false;

	for (const line of lines) {
		if (line.includes('DirectShow audio devices')) {
			inAudioSection = true;
			continue;
		}
		if (inAudioSection) {
			const match = line.match(/"([^"]+)"/);
			if (match) {
				return `audio=${match[1]}`;
			}
		}
	}

	throw new Error(
		'No audio input device found. Check that a microphone is connected and recognized by Windows.'
	);
}
```

**Step 4: Tests ausfuehren -- muessen bestehen**

Run: `npm run compile && npm run test:unit`
Expected: PASS

**Step 5: Commit**

```bash
git add src/recorder.ts src/test/unit/recorder.test.ts
git commit -m "✨ feat: Windows Audio-Device Auto-Detection via DirectShow implementieren"
```

---

### Task 4: README.md mit Cross-Platform Installationsanleitung aktualisieren

**Files:**
- Modify: `README.md:14-23` (Voraussetzungen-Abschnitt)

**Step 1: Voraussetzungen-Abschnitt aktualisieren**

In `README.md`, den Abschnitt `## Voraussetzungen` ersetzen:

```markdown
## Voraussetzungen

- [ffmpeg](https://ffmpeg.org/) muss installiert sein (Audioaufnahme)
- OpenAI API Key (Whisper-Transkription)
- Anthropic API Key (Claude Post-Processing)

### ffmpeg installieren

**macOS:**
```bash
brew install ffmpeg
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt install ffmpeg
```

**Linux (Fedora):**
```bash
sudo dnf install ffmpeg
```

**Windows:**

ffmpeg von [ffmpeg.org/download.html](https://ffmpeg.org/download.html) herunterladen und zum PATH hinzufuegen. Oder via [Chocolatey](https://chocolatey.org/):
```powershell
choco install ffmpeg
```

### Plattform-spezifische Hinweise

| Plattform | Audio-Backend | Mikrofon-Auswahl |
|-----------|--------------|-----------------|
| macOS | AVFoundation | Standard-Mikrofon |
| Linux | PulseAudio | Standard-Mikrofon |
| Windows | DirectShow | Automatisch erkannt |

**Linux:** PulseAudio muss laufen (Standard auf Ubuntu, Fedora und den meisten Desktop-Distributionen).

**Windows:** Das erste erkannte Audio-Eingabegeraet wird automatisch verwendet.
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "📚 docs: Cross-Platform Installationsanleitung in README.md ergaenzen"
```

---

### Task 5: Bestehende Tests reparieren und Gesamttest

**Files:**
- Modify: `src/test/unit/recorder.test.ts:56-58` (existsSync Stub flexibler machen)

**Step 1: existsSync Stub im Test-Setup pruefen**

Der bestehende Test-Setup (Zeile 56-58) stubbt `fs.existsSync` so, dass nur `/opt/homebrew/bin/ffmpeg` gefunden wird. Das funktioniert nur auf macOS. Der Stub muss plattformbewusst sein oder generisch fuer alle Tests funktionieren.

In `src/test/unit/recorder.test.ts`, den Setup-Block anpassen:

```typescript
setup(() => {
	recorder = new FfmpegRecorder();
	fakeProcess = createFakeProcess();
	clock = sinon.useFakeTimers();

	sinon.stub(child_process, 'spawn').returns(
		fakeProcess as unknown as child_process.ChildProcess
	);
	// Stub existsSync to find ffmpeg at platform-appropriate path
	sinon.stub(fs, 'existsSync').callsFake(
		(p) => p === '/opt/homebrew/bin/ffmpeg'
			|| p === '/usr/bin/ffmpeg'
	);
});
```

**Step 2: Alle Tests ausfuehren**

Run: `npm run compile && npm run test:unit`
Expected: PASS -- Alle bestehenden und neuen Tests bestehen.

**Step 3: Commit (nur falls Aenderungen noetig waren)**

```bash
git add src/test/unit/recorder.test.ts
git commit -m "🧪 test: Test-Setup fuer plattformuebergreifende ffmpeg-Pfade anpassen"
```

---

### Task 6: Abschluss und Push

**Step 1: Gesamttest nochmals ausfuehren**

Run: `npm run compile && npm run test:unit`
Expected: PASS -- Alle Tests bestehen.

**Step 2: Push**

```bash
git push origin <branch-name>
```
