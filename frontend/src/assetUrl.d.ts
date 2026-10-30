/**
 * Vite's `?url` import: the module's value is the asset's public URL.
 *
 * Declared here, for this one suffix, rather than by referencing
 * `vite/client`: that would also bring Vite's `import.meta.env` and asset
 * typings into a codebase that reads configuration through `process.env`
 * (see vite.config.ts), suggesting a second way to do it. Only `index.tsx`
 * uses it, to link the Bootstrap build matching the writing direction.
 */
declare module '*?url' {
  const url: string;
  export default url;
}
