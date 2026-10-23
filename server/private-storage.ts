import { chmod, link, lstat, mkdir, open, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';

export function assertOutsideWorkspace(path: string): void {
  const workspace = resolve(process.cwd());
  const target = resolve(path);
  const relation = relative(workspace, target);
  if (relation === '' || (!relation.startsWith('..') && relation !== '..')) {
    throw new Error('Private operator files must be stored outside the application workspace');
  }
}

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Private operator directory must be a real directory');
  await chmod(path, 0o700);
}

export async function atomicCreatePrivateFile(path: string, content: string | Uint8Array): Promise<void> {
  assertOutsideWorkspace(path);
  const folder = dirname(path);
  await ensurePrivateDirectory(folder);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
    await link(temporary, path);
    await chmod(path, 0o600);
    const directory = await open(folder, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await handle.close();
    await unlink(temporary).catch(() => undefined);
  }
}
