import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 컨테이너 배포를 위한 standalone 출력 모드
  // Dockerfile의 COPY --from=builder .next/standalone ./ 가 이 설정에 의존
  output: "standalone",
};

export default nextConfig;
