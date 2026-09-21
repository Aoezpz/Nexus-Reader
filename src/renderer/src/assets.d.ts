/**
 * Image imports resolve to a URL string under Vite. Declared here rather than
 * pulled in from `vite/client`, which would also declare a dozen module types
 * this project never uses.
 */
declare module '*.png' {
  const src: string
  export default src
}
declare module '*.jpg' {
  const src: string
  export default src
}
