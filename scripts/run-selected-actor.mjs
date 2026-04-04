import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function getActorPath() {
  const actorPath = process.env.ACTOR_PATH_IN_DOCKER_CONTEXT;

  if (!actorPath) {
    throw new Error('ACTOR_PATH_IN_DOCKER_CONTEXT is required at runtime.');
  }

  return actorPath;
}

const actorPath = getActorPath();
const packageJsonPath = path.join(process.cwd(), actorPath, 'package.json');

if (!existsSync(packageJsonPath)) {
  throw new Error(`Could not find package.json for actor path: ${actorPath}`);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const mainFile = typeof packageJson.main === 'string' && packageJson.main.trim() !== ''
  ? packageJson.main
  : './dist/main.js';
const entryFile = path.resolve(process.cwd(), actorPath, mainFile.replace(/^\.\//, ''));

if (!existsSync(entryFile)) {
  throw new Error(`Could not find built actor entrypoint: ${entryFile}`);
}

console.log(`Starting Apify workspace ${packageJson.name} from ${entryFile}`);

const result = spawnSync(process.execPath, [entryFile], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  throw result.error;
}

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);
