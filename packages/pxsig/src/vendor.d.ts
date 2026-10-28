/**
 * vendor.d.ts — declarations for the dependencies that ship no types of their own, covering only
 * what pxsig uses. Types only: nothing here runs. A module declared here is checked against these
 * declarations, so keep them to the library's documented API.
 */

declare module 'pngjs' {
  /** A decoded image: RGBA bytes, row by row. */
  export interface PNGImage {
    width: number;
    height: number;
    data: Buffer;
  }

  /** pngjs's PNG (https://github.com/pngjs/pngjs#readme). */
  export class PNG implements PNGImage {
    constructor(options?: { width?: number; height?: number });
    width: number;
    height: number;
    data: Buffer;
    /** The synchronous API. */
    static sync: {
      read(buffer: Buffer): PNG;
      write(png: PNGImage): Buffer;
    };
  }
}
