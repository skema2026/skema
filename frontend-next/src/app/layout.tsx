import type { Metadata } from "next";
import localFont from "next/font/local";
// 한글 글꼴: Pretendard (SIL OFL 1.1). 글자 범위별로 쪼갠 파일이라 화면에 쓰인 글자 묶음만 받는다
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";
import { Providers } from "@/components/providers/Providers";
import { Toaster } from "@/components/ui/sonner";

// 폰트 파일을 프로젝트 안(src/app/fonts)에 두고 쓴다.
// next/font/google은 빌드할 때마다 Google에서 폰트를 받아 오는데, 그게 끊기면 Vercel 빌드가
// 통째로 실패해서(10/31, 11/4) 바꿨다. 화면은 같다. 파일 출처: @fontsource-variable 5.3.0 (SIL OFL 1.1)
const manrope = localFont({
  src: "./fonts/Manrope-latin-wght.woff2",
  variable: "--font-manrope",
  weight: "200 800",
  display: "swap",
  preload: false,
});

const inter = localFont({
  src: "./fonts/Inter-latin-wght.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "SKEMA",
    template: "%s | SKEMA",
  },
  description: "밀려도 다시 짜 주는 대학생 시간표와 시험 준비 대시보드",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      data-scroll-behavior="smooth"
      className={`${manrope.variable} ${inter.variable} h-full antialiased light`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var _measure = performance.measure.bind(performance);
            performance.measure = function(name, start, end) {
              try { return _measure(name, start, end); } catch(e) {}
            };
          })();
        `}} />
      </head>
      <body className="min-h-full flex flex-col bg-[#f5f8fd] text-[#0f1e3a]" style={{ fontFamily: '"Pretendard Variable", Pretendard, var(--font-inter), Inter, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif' }} suppressHydrationWarning>
        <Providers>
          {children}
          <Toaster position="top-center" />
        </Providers>
      </body>
    </html>
  );
}
