// vite/vitest 의 `?raw` 가져오기(파일 내용을 문자열로)
declare module '*?raw' {
  const text: string;
  export default text;
}
