/**
 * URL of a file the site serves. Vite sets BASE_URL to '/' for functionbench.net and to
 * '/CAFA_forever/' for the GitHub Pages build (`npm run build:pages`).
 */
export function siteUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
}
