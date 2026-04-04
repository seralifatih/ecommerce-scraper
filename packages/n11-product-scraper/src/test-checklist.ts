import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { actorInputSchema, n11ProductSchema, runSummarySchema } from './types.js';

const PRODUCT_URL = 'https://www.n11.com/urun/logitech-mk270-kablosuz-usb-turkce-q-klavye-mouse-seti-61465';

function logCheck(name: string, passed: boolean, detail?: string): boolean {
  const prefix = passed ? 'PASS' : 'FAIL';
  console.log(`[${prefix}] ${name}${detail ? ` - ${detail}` : ''}`);
  return passed;
}

async function readDatasetRecords(directoryPath: string): Promise<unknown[]> {
  const records: unknown[] = [];

  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        records.push(...await readDatasetRecords(entryPath));
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      const content = (await readFile(entryPath, 'utf8')).trim();

      if (!content) {
        continue;
      }

      const parsed = JSON.parse(content) as unknown;

      if (Array.isArray(parsed)) {
        records.push(...parsed);
      } else {
        records.push(parsed);
      }
    }
  } catch {
    return records;
  }

  return records;
}

async function runActor(input: unknown): Promise<{
  exitCode: number | null;
  records: unknown[];
}> {
  const validatedInput = actorInputSchema.parse(input);
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'n11-product-checklist-'));
  const inputPath = path.join(storageDir, 'key_value_stores', 'default', 'INPUT.json');

  await mkdir(path.dirname(inputPath), { recursive: true });
  await writeFile(inputPath, JSON.stringify(validatedInput, null, 2), 'utf8');

  const currentFile = fileURLToPath(import.meta.url);
  const packageDir = path.resolve(path.dirname(currentFile), '..');
  const actorEntry = path.join(packageDir, 'dist', 'main.js');

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, [actorEntry], {
      cwd: packageDir,
      env: {
        ...process.env,
        APIFY_LOCAL_STORAGE_DIR: storageDir,
        CRAWLEE_STORAGE_DIR: storageDir,
        ACTOR_INPUT_KEY: 'INPUT',
        APIFY_INPUT_KEY: 'INPUT',
        APIFY_IS_AT_HOME: '',
        APIFY_DISABLE_OUTDATED_WARNING: '1',
        APIFY_HEADLESS: '1',
        APIFY_LOG_LEVEL: 'WARNING',
      },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', resolve);
  });

  const records = await readDatasetRecords(path.join(storageDir, 'datasets', 'default'));
  await rm(storageDir, { recursive: true, force: true });

  return {
    exitCode,
    records,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const input = {
  productUrls: [PRODUCT_URL],
  maxProducts: 5,
  scrapeDetails: false,
  proxyConfig: {
    useApifyProxy: false,
  },
};

const { exitCode, records } = await runActor(input);
const summaryRecords = records.filter((record) => isObject(record) && record.type === 'RUN_SUMMARY');
const productRecords = records.filter((record) => !isObject(record) || record.type !== 'RUN_SUMMARY');
const invalidProducts = productRecords
  .map((record, index) => ({ index, result: n11ProductSchema.safeParse(record) }))
  .filter(({ result }) => !result.success);
const validProducts = productRecords
  .map((record) => n11ProductSchema.safeParse(record))
  .filter((result) => result.success)
  .map((result) => result.data);

const checks = [
  logCheck('Actor exited successfully', exitCode === 0, `exitCode=${exitCode}`),
  logCheck('At least one product record was collected', productRecords.length > 0, `records=${productRecords.length}`),
  logCheck('All product records match the Zod output schema', invalidProducts.length === 0, `invalid=${invalidProducts.length}`),
  logCheck('RUN_SUMMARY record exists', summaryRecords.length === 1, `summaries=${summaryRecords.length}`),
  logCheck(
    'RUN_SUMMARY record matches the Zod summary schema',
    summaryRecords.length === 1 && runSummarySchema.safeParse(summaryRecords[0]).success,
  ),
  logCheck(
    'Required product fields are not null',
    validProducts.every((product) => Boolean(product.productId && product.title && product.productUrl && product.sellerName)),
  ),
];

if (checks.every(Boolean)) {
  console.log('Checklist completed successfully.');
  process.exit(0);
}

console.error('Checklist failed.');
process.exit(1);
