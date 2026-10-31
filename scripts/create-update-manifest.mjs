import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const outputDir = path.resolve(root, process.argv[2] || 'release');
const version = packageJson.version;
const file = `ServiceHub-Desktop-${version}-Setup.exe`;
const installerPath = path.join(outputDir, file);
const blockmapPath = `${installerPath}.blockmap`;
const [installer, installerStat, blockmapStat] = await Promise.all([
  readFile(installerPath),
  stat(installerPath),
  stat(blockmapPath)
]);
const sha512 = createHash('sha512').update(installer).digest('base64');
const releaseDate = new Date().toISOString();
const metadata = [
  `version: ${version}`,
  'files:',
  `  - url: ${file}`,
  `    sha512: ${sha512}`,
  `    size: ${installerStat.size}`,
  `    blockMapSize: ${blockmapStat.size}`,
  `path: ${file}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  ''
].join('\n');
await writeFile(path.join(outputDir, 'latest.yml'), metadata, 'utf8');
console.log(`Wrote ${path.join(outputDir, 'latest.yml')} for ${file} (${installerStat.size} bytes)`);
