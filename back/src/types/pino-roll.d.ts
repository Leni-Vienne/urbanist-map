// AI : Type declaration for pino-roll (no @types package available)
declare module "pino-roll" {
  import type { DestinationStream } from "pino";

  interface PinoRollOptions {
    file: string;
    frequency?: "daily" | "hourly" | number;
    dateFormat?: string;
    size?: string;
    limit?: {
      count?: number;
      days?: number;
    };
    mkdir?: boolean;
  }

  function build(options: PinoRollOptions): DestinationStream;
  export default build;
}
