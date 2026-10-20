// electron-vite's `?asset` import: a file shipped beside the main bundle, imported as its path.
declare module '*?asset' {
  const path: string
  export default path
}
