import AppShell from "@/components/app-shell";
import { ActivityProvider } from "@/src/lib/session-activity";
import { PendingFileProvider } from "@/src/lib/pending-file";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Both live above the pages so they survive navigation between them — but only that.
  // A refresh is a clean slate, which is the point.
  return (
    <ActivityProvider>
      <PendingFileProvider>
        <AppShell>{children}</AppShell>
      </PendingFileProvider>
    </ActivityProvider>
  );
}
