import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(projectRoot, 'package.json'));
const outputRoot = join(projectRoot, 'public', 'tesseract');
const dataOutput = join(outputRoot, 'tessdata');

await rm(outputRoot, { recursive: true, force: true });
await mkdir(dataOutput, { recursive: true });

for (const lang of ['ara', 'eng']) {
  const source = require.resolve(`@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`, { paths: [projectRoot] });
  await cp(source, join(dataOutput, `${lang}.traineddata.gz`));
}

const modelPackages = ['ara', 'eng'].map((lang) => require.resolve(`@tesseract.js-data/${lang}/package.json`, { paths: [projectRoot] }));
const modelNotice = modelPackages.map((file) => {
  const pkg = require(file);
  return `Language model ${pkg.name}@${pkg.version}: ${pkg.license || 'license declared in package metadata'}`;
}).join('\n');
await writeFile(join(outputRoot, 'LICENSES.txt'), `${modelNotice}\n`);
console.log(`Prepared local OCR assets at ${outputRoot}`);
