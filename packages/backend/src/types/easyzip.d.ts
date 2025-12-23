declare module 'easyzip' {
  export class EasyZip {
    constructor();
    file(name: string, content: string): void;
    writeToBuffer(
      options: { password: string; compress: boolean },
      callback: (err: Error | null, buffer: Buffer) => void
    ): void;
  }
}
