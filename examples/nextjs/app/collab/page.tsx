import { CollabEditor } from './CollabEditor';

export const metadata = { title: 'WordCraft co-editing' };

export default function Page() {
  return (
    <main style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, margin: '0 0 12px' }}>Co-editing, like Word</h1>
      <CollabEditor />
    </main>
  );
}
