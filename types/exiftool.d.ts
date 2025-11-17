declare module "node-exiftool" {
  type MetadataRecord = Record<string, string | string[] | number>;

  export class ExiftoolProcess {
    constructor(exiftoolPath?: string, options?: Record<string, unknown>);
    open(): Promise<void>;
    writeMetadata(
      filePath: string,
      tags: MetadataRecord,
      args?: string[],
    ): Promise<{ data: unknown; error: string | null }>;
    close(): Promise<void>;
  }
}

declare module "dist-exiftool" {
  const exiftoolPath: string;
  export default exiftoolPath;
}
