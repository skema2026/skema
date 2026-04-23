import type { Metadata } from "next";
import { Manrope, Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers/Providers";
import { Toaster } from "@/components/ui/sonner";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  preload: false,
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "SKEMA",
  description: "AI로 관리하는 스마트 시간표",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${manrope.variable} ${inter.variable} h-full antialiased light`}
    >
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
        />
        {/* suppress Next.js dev-mode negative timestamp warning */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var _measure = performance.measure.bind(performance);
            performance.measure = function(name, start, end) {
              try { return _measure(name, start, end); } catch(e) {}
            };
          })();
        `}} />
      </head>
      <body className="min-h-full flex flex-col bg-[#f7fafd] text-[#181c1e]" style={{ fontFamily: "var(--font-inter), Inter, sans-serif" }}>
        <Providers>
          {children}
          <Toaster richColors position="top-right" />
        </Providers>
      </body>
    </html>
  );
}
