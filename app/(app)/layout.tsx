import { AppHeader } from "@/components/app-header";
import { AppProviders } from "@/components/app-providers";
import { BackButton } from "@/components/back-button";
import { Suspense } from "react";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppProviders>
      <AppHeader />
      <main className="mx-auto w-full max-w-[2000px] px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pb-12 sm:pt-5 lg:px-8">
        <Suspense fallback={null}>
          <BackButton />
        </Suspense>
        {children}
      </main>
    </AppProviders>
  );
}
