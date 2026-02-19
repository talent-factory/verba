import * as path from 'path';
import * as fs from 'fs';
import Mocha = require('mocha');

export function run(): Promise<void> {
	const mocha = new Mocha({
		ui: 'tdd',
		color: true,
		timeout: 10000,
	});

	const testsRoot = __dirname;

	return new Promise((resolve, reject) => {
		const testFiles = fs.readdirSync(testsRoot)
			.filter(f => f.endsWith('.test.js'));

		for (const file of testFiles) {
			mocha.addFile(path.resolve(testsRoot, file));
		}

		try {
			mocha.run(failures => {
				if (failures > 0) {
					reject(new Error(`${failures} tests failed.`));
				} else {
					resolve();
				}
			});
		} catch (err) {
			reject(err);
		}
	});
}
