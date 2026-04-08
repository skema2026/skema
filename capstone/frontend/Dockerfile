# frontend/Dockerfile
FROM node:18

WORKDIR /app

# package.json & package-lock.json 복사 후 의존성 설치
COPY package*.json ./
RUN npm install

# 소스 전체 복사
COPY . .

# Vite 개발 서버 실행 (개발 단계용)
# --host 0.0.0.0 옵션을 주어 외부 접속 가능하게 함
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
