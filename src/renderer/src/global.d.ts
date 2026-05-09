import type { DebaseApi } from "@shared/api";

declare global {
  interface Window {
    api: DebaseApi;
  }
}

export {};
