import AppShell from "@/components/app-shell";
import { ActivityProvider } from "@/src/lib/session-activity";

export default function DashboardLayout({ children }) {
  // Activity lives above the pages so it survives navigation between them — but only
  // that. A refresh is a clean slate, which is the point.
  return (
    <ActivityProvider>
      <AppShell>{children}</AppShell>
    </ActivityProvider>
  );
}
