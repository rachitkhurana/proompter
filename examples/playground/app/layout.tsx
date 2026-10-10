import type { ReactNode } from "react";

export const metadata = { title: "Proompter playground" };

// The root layout stays bare so the /fixtures/* routes (which mount their own kit) never get a second one.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
