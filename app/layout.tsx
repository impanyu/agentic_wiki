import {PUBLIC_EDITION} from './edition';
import type { Metadata } from "next";
import "./globals.css";
import "./rankwiki-theme.css";
import {cookies} from "next/headers";
import {THEME_SCRIPT} from "./theme";
import {requestLocale} from "./i18n/request";
import {dirOf,langTag} from "./i18n/locales";

export const metadata: Metadata = {
  title: PUBLIC_EDITION?"RankWiki · Search any entity, rank any category":"AgenticWiKi · A question is an address",
  description: "Enter a question like an address. Open one consistent answer.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The theme cookie lets the server render the page in the reader's theme; the script settles it before paint.
  const theme=(await cookies()).get('rw-theme')?.value==='dark'?'dark':'light';
  const locale=await requestLocale();
  return (
    <html lang={langTag(locale)} dir={dirOf(locale)} data-theme={theme} style={{colorScheme:theme}} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{__html:THEME_SCRIPT}}/></head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
