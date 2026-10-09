import { AppHeader } from "@/components/app-header";
import { AppProviders } from "@/components/app-providers";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppProviders>
      <AppHeader />
      <main className="mx-auto w-full max-w-[2000px] px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pb-12 sm:pt-5 lg:px-8">
        {children}
      </main>
    </AppProviders>
  );
}
