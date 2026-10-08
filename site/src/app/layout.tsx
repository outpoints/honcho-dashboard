import type { Metadata } from "next";
import { JetBrains_Mono, VT323 } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/lib/theme";
import { serverAdvertisedBaseUrl } from "@/lib/honcho/allowlist";
import { DEFAULT_BASE_URL_META } from "@/lib/honcho/defaultTarget";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const vt323 = VT323({
  variable: "--font-vt323",
  subsets: ["latin"],
  weight: ["400"],
});

export const metadata: Metadata = {
  // The document title is owned by AppShell via a reactive <title> element so it
  // can reflect the active hash route + the user's preference. Setting a static
  // title here too would render a second, competing <title> that React re-asserts
  // on mount (overwriting the dynamic one on initial load).
  description: "honcho_dashboard",
  icons: { icon: { url: "/seo/favicon.svg", type: "image/svg+xml", sizes: "any" } },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Render per request so the default Honcho URL comes from the running
  // server's env, not the value frozen into the bundle by `next build`.
  await connection();
  const defaultBaseUrl = serverAdvertisedBaseUrl();
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${jetbrainsMono.variable} ${vt323.variable} h-full`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {defaultBaseUrl ? <meta name={DEFAULT_BASE_URL_META} content={defaultBaseUrl} /> : null}
      </head>
      <body className="min-h-screen antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
