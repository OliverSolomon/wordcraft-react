import { DocumentEditor } from './DocumentEditor';

export default function Page() {
  return (
    <main style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, margin: '0 0 12px' }}>WordCraft inside a Next.js app</h1>
      <DocumentEditor />
    </main>
  );
}
