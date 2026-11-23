import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { AppProviders } from "@/components/app-providers";
import { ReminderNotifier } from "@/components/reminders";
import { PrivacyBoundary } from "@/components/privacy-boundary";
import { ScrollRestorer } from "@/components/scroll-restorer";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppProviders>
      <AppHeader />
      <ReminderNotifier />
      {/* Going back lands where you were on that page, not at its top. */}
      <Suspense fallback={null}>
        <ScrollRestorer />
      </Suspense>
      <main className="mx-auto w-full max-w-[2000px] px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pb-12 sm:pt-5 lg:px-8">
        <PrivacyBoundary>{children}</PrivacyBoundary>
      </main>
    </AppProviders>
  );
}
