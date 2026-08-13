declare module 'node:fs/promises' {
  export function readFile(path: URL | string, encoding: 'utf8'): Promise<string>;
}

interface ImportMeta {
  readonly url: string;
}
