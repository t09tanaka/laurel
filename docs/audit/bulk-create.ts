#!/usr/bin/env bun
// Bulk-create GitHub issues from docs/audit/all.json.
// - Concurrency-limited (default 4) to avoid secondary rate limits.
// - Idempotent: persists progress in docs/audit/created.ndjson; reruns skip done items.
// - Backoff: 60s on 403 (secondary rate limit) and 429.
//
// Usage: bun docs/audit/bulk-create.ts [concurrency]
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

type Issue = { title: string; body: string; labels: string[] };
type Created = { idx: number; number?: number; status: 'created' | 'skipped' | 'failed'; reason?: string; title: string };

const concurrency = Number(process.argv[2] ?? '4');
const INPUT = 'docs/audit/all.json';
const STATE = 'docs/audit/created.ndjson';

const token = (await Bun.spawn(['gh', 'auth', 'token']).stdout.text()).trim();
const repoInfo = await Bun.spawn(['gh', 'repo', 'view', '--json', 'owner,name']).stdout.text();
const { owner, name } = JSON.parse(repoInfo) as { owner: { login: string }; name: string };
const REPO = `${owner.login}/${name}`;
console.log(`Repo: ${REPO}, concurrency: ${concurrency}`);

const issues = (await Bun.file(INPUT).json()) as Issue[];
console.log(`Loaded ${issues.length} issues`);

if (!existsSync(STATE)) {
  await mkdir(dirname(STATE), { recursive: true });
  await Bun.write(STATE, '');
}
const stateText = await readFile(STATE, 'utf8');
const doneIdx = new Set<number>();
for (const line of stateText.split('\n')) {
  if (!line.trim()) continue;
  try {
    const row = JSON.parse(line) as Created;
    if (row.status === 'created' || row.status === 'skipped') doneIdx.add(row.idx);
  } catch {
    // ignore
  }
}
console.log(`${doneIdx.size} already done; ${issues.length - doneIdx.size} to create`);

let inFlight = 0;
let nextIdx = 0;
let createdCount = 0;
let failedCount = 0;
let lastSecondaryRateLimit = 0;

async function record(row: Created): Promise<void> {
  await appendFile(STATE, `${JSON.stringify(row)}\n`);
}

async function createIssue(idx: number, issue: Issue): Promise<void> {
  // Honor recent secondary rate limit by waiting if needed.
  const now = Date.now();
  if (lastSecondaryRateLimit > now - 60_000) {
    const wait = 60_000 - (now - lastSecondaryRateLimit);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
    }),
  });

  if (res.status === 201) {
    const json = (await res.json()) as { number: number };
    await record({ idx, number: json.number, status: 'created', title: issue.title });
    createdCount += 1;
    if (createdCount % 25 === 0) {
      console.log(`  ✓ ${createdCount} created (latest #${json.number})`);
    }
    return;
  }

  if (res.status === 403 || res.status === 429) {
    lastSecondaryRateLimit = Date.now();
    const text = await res.text();
    console.warn(`  ⏸ rate-limited (${res.status}); retrying in 60s: ${text.slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 60_000));
    return createIssue(idx, issue);
  }

  const errText = await res.text();
  console.warn(`  ✗ idx=${idx} failed ${res.status}: ${errText.slice(0, 200)}`);
  await record({
    idx,
    status: 'failed',
    reason: `${res.status}: ${errText.slice(0, 500)}`,
    title: issue.title,
  });
  failedCount += 1;
}

async function worker(): Promise<void> {
  while (true) {
    const idx = nextIdx++;
    if (idx >= issues.length) return;
    if (doneIdx.has(idx)) continue;
    const issue = issues[idx];
    if (!issue) continue;
    inFlight += 1;
    try {
      await createIssue(idx, issue);
    } catch (err) {
      console.warn(`  ✗ idx=${idx} threw:`, err);
      await record({
        idx,
        status: 'failed',
        reason: err instanceof Error ? err.message : String(err),
        title: issue.title,
      });
      failedCount += 1;
    } finally {
      inFlight -= 1;
    }
    // Small stagger to be polite even within concurrency budget.
    await new Promise((r) => setTimeout(r, 250));
  }
}

const start = Date.now();
await Promise.all(Array.from({ length: concurrency }, () => worker()));
const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`Done in ${elapsed}s. created=${createdCount}, failed=${failedCount}, in_flight_end=${inFlight}`);
