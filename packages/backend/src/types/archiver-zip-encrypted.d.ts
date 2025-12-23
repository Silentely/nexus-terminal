declare module 'archiver' {
  interface ArchiverOptions {
    encryptionMethod?: 'aes256' | 'zip20';
    password?: string;
    zlib?: { level: number };
  }

  function registerFormat(format: string, module: any): void;
  function create(format: string, options: ArchiverOptions): Archiver;

  interface Archiver extends NodeJS.EventEmitter {
    on(event: 'data', listener: (data: Buffer) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'warning', listener: (err: Error) => void): this; // 添加 'warning' 事件
    pipe(destination: NodeJS.WritableStream): NodeJS.WritableStream; // 添加 pipe 方法
    append(data: any, options: { name: string }): void;
    finalize(): Promise<void>;
    destroyed?: boolean; // 添加 destroyed 属性
    abort(): this; // 添加 abort 方法
  }
}
