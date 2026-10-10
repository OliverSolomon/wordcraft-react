// The one shared file per document, like a .docx on OneDrive or SharePoint: everyone's AutoSave
// overwrites it with the merged document, and each overwrite keeps the previous file as a
// version (Word's version history). Swap this for S3, Supabase Storage, a database, ...
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIR = path.join(process.cwd(), '.data');
const KEEP_VERSIONS = 20;

function fileFor(id: string) {
  if (!/^[\w-]{1,64}$/.test(id)) return null;
  return path.join(DIR, `${id}.docx`);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const file = fileFor((await params).id);
  if (!file) return new Response('bad id', { status: 400 });
  try {
    const bytes = await readFile(file);
    return new Response(bytes, { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'cache-control': 'no-store' } });
  } catch {
    return new Response('not found', { status: 404 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const file = fileFor(id);
  if (!file) return new Response('bad id', { status: 400 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 50 * 1024 * 1024) return new Response('bad size', { status: 413 });
  await mkdir(path.join(DIR, 'versions'), { recursive: true });
  // Keep the previous file as a version, then overwrite.
  await rename(file, path.join(DIR, 'versions', `${id}-${Date.now()}.docx`)).catch(() => {});
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, file);
  const versions = (await readdir(path.join(DIR, 'versions'))).filter((f) => f.startsWith(`${id}-`)).sort();
  for (const old of versions.slice(0, Math.max(0, versions.length - KEEP_VERSIONS))) await unlink(path.join(DIR, 'versions', old)).catch(() => {});
  return Response.json({ saved: true, bytes: bytes.byteLength, versions: Math.min(versions.length, KEEP_VERSIONS) });
}
