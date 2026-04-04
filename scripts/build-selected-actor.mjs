import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function getActorPath() {
  const actorPath = process.env.ACTOR_PATH_IN_DOCKER_CONTEXT;

  if (!actorPath) {
    throw new Error('ACTOR_PATH_IN_DOCKER_CONTEXT is required during Docker builds.');
  }

  return actorPath;
}

function readSelectedPackageJson() {
  const actorPath = getActorPath();
  const packageJsonPath = path.join(process.cwd(), actorPath, 'package.json');

  if (!existsSync(packageJsonPath)) {
    throw new Error(`Could not find package.json for actor path: ${actorPath}`);
  }

  return JSON.parse(readFileSync(packageJsonPath, 'utf8'));
}

const selectedPackageJson = readSelectedPackageJson();
if (typeof selectedPackageJson.name !== 'string' || selectedPackageJson.name.trim() === '') {
  throw new Error('The selected actor package.json must contain a workspace package name.');
}

console.log(`Building Apify workspace ${selectedPackageJson.name} from ${getActorPath()}`);

execSync(`npm run build --workspace ${selectedPackageJson.name}`, {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: true,
});
