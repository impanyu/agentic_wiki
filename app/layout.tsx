import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgenticWiKi · A question is an address",
  description: "Enter a question like an address. Open one consistent answer.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
