#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const pagesDirectory = resolve('src/docs/pages');
const files = (await readdir(pagesDirectory)).filter(file => file.endsWith('.mdx')).sort();
const registry = await readFile(resolve('src/docs/registry.ts'), 'utf8');
const required = ['getting-started', 'wallets-authentication', 'noir-wallet', 'swap-bridge', 'route-availability', 'privacy-custody', 'handles-contacts', 'inbox-notifications', 'ai-and-voice', 'security', 'roadmap', 'judge-walkthrough', 'evidence'];
const slugs = new Set();
const failures = [];

for (const file of files) {
  const source = await readFile(resolve(pagesDirectory, file), 'utf8');
  const slug = source.match(/slug:\s*'([^']+)'/)?.[1];
  if (!slug) failures.push(`${file}: missing exported meta slug`);
  else if (slugs.has(slug)) failures.push(`${file}: duplicate slug ${slug}`);
  else slugs.add(slug);
  if (!/title:\s*'[^']+'/.test(source) || !/summary:\s*'[^']+'/.test(source) || !/featureIds:\s*\[/.test(source)) failures.push(`${file}: incomplete metadata`);
  if (!registry.includes(`./pages/${file}`)) failures.push(`${file}: not imported by the registry`);
  if (/javascript\s*:/i.test(source)) failures.push(`${file}: unsafe javascript link`);
  for (const match of source.matchAll(/\]\(\/docs\/([a-z0-9-]+)\)/g)) {
    if (!slugs.has(match[1]) && !files.includes(`${match[1]}.mdx`)) failures.push(`${file}: broken docs link ${match[1]}`);
  }
}
for (const slug of required) if (!slugs.has(slug)) failures.push(`missing required docs route: ${slug}`);
if (failures.length) throw new Error(`MDX documentation validation failed:\n${failures.join('\n')}`);
process.stdout.write(`${JSON.stringify({ status: 'MDX_DOCS_VALID', pages: files.length, requiredRoutes: required.length })}\n`);
