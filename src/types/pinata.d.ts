declare module "pinata" {
  export class PinataSDK {
    constructor(config: { pinataJwt?: string; pinataGateway?: string });
    upload: {
      file: (
        file:
          | File
          | Blob
          | ReadableStream<any>
          | NodeJS.ReadableStream
          | ArrayBuffer
          | Uint8Array
      ) => Promise<{
        cid: string;
        size?: number;
        created_at?: string;
        network?: string;
      }>;
      public?: {
        file: (
          file:
            | File
            | Blob
            | ReadableStream<any>
            | NodeJS.ReadableStream
            | ArrayBuffer
            | Uint8Array
        ) => Promise<{
          cid: string;
          size?: number;
          created_at?: string;
          network?: string;
        }>;
      };
    };
    gateways?: {
      public?: {
        get: (cid: string) => Promise<any>;
      };
      convert?: (cid: string) => Promise<string>;
    };
  }
}
