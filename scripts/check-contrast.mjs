import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const root = css.match(/^:root \{([\s\S]*?)\n\}/)?.[1];
const light = css.match(/:root\[data-theme="light"\] \{([\s\S]*?)\n\}/)?.[1];
if (!root || !light) throw new Error('Theme token blocks were not found.');

function variables(source) {
  return Object.fromEntries([...source.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
}

const darkTokens = variables(root);
const lightTokens = { ...darkTokens, ...variables(light) };
function resolveToken(tokens, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`Circular color token: ${name}`);
  seen.add(name);
  const value = tokens[name];
  if (!value) throw new Error(`Missing color token: ${name}`);
  const reference = value.match(/^var\(--([a-z-]+)\)$/)?.[1];
  return reference ? resolveToken(tokens, reference, seen) : value;
}

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}
function luminance(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Contrast check requires a six-digit hex color, received ${color}`);
  return 0.2126 * channel(Number.parseInt(color.slice(1, 3), 16))
    + 0.7152 * channel(Number.parseInt(color.slice(3, 5), 16))
    + 0.0722 * channel(Number.parseInt(color.slice(5, 7), 16));
}
function ratio(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const pairs = [
  ['ink/page', 'ink', 'page'], ['muted/page', 'muted', 'page'], ['muted/surface', 'muted', 'surface'],
  ['soft/surface', 'soft', 'surface'], ['button label/accent', 'accent-ink', 'accent'],
  ['warning/surface', 'warning', 'surface'], ['danger/page', 'danger', 'page'],
];
const results = [];
for (const [theme, tokens] of [['dark', darkTokens], ['light', lightTokens]]) {
  for (const [label, foregroundToken, backgroundToken] of pairs) {
    const foreground = resolveToken(tokens, foregroundToken);
    const background = resolveToken(tokens, backgroundToken);
    const contrast = ratio(foreground, background);
    results.push({ theme, pair: label, foreground, background, ratio: Number(contrast.toFixed(2)) });
    if (contrast < 4.5) throw new Error(`${theme} ${label} is ${contrast.toFixed(2)}:1; WCAG 2.2 AA normal text requires 4.5:1.`);
  }
}
process.stdout.write(`${JSON.stringify({ status: 'WCAG_2_2_AA_CONTRAST_PASS', minimumRatio: Math.min(...results.map(result => result.ratio)), results })}\n`);
