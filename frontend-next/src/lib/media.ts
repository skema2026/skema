const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? '/proxy';

/**
 * 백엔드가 준 영상 주소를 <video src> 에 넣을 주소로 바꾼다.
 * - R2 서명 주소(https://...)는 이미 완전한 주소라서 그대로 쓴다.
 * - 로컬 개발의 /uploads/... 는 앞에 백엔드 주소를 붙인다.
 */
export const mediaUrl = (path: string) => (/^https?:\/\//i.test(path) ? path : `${BACKEND}${path}`);

/**
 * 영상인지 확장자로 판단한다.
 * 서명 주소는 뒤에 ?X-Amz-... 가 붙으므로 ? 와 # 앞부분(경로)만 본다.
 */
export const isVideoUrl = (url: string) => /\.(webm|mp4|m4v|mov|mkv)$/i.test(url.split(/[?#]/)[0]);
