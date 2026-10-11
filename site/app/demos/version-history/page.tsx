import { DemoHead } from '@/components/DemoHead';
import { VersionsDemo } from './VersionsDemo';

export const metadata = { title: 'Version history demo' };

export default function Page() {
  return (
    <div className="wrap" style={{ paddingBottom: 64 }}>
      <DemoHead title="Version history" extra doc="version-history">
        This demo records a version every 20 seconds while you type (the default is every 5 minutes). Make a few edits, then click the title above the ribbon, use File › Info › View Version History, or press Ctrl+Alt+Shift+H. Click a version to see it, name it, download it or restore it.
      </DemoHead>
      <VersionsDemo />
    </div>
  );
}
