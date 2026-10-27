export {};
declare global {
  interface WindowEventMap {
    airbookinstallavailable: CustomEvent<unknown>;
  }
  interface Window {
    __MANUS_CONFIG__?: {
      projectId: string; oauthPortalUrl: string; apiUrl: string; apiBrowserKey: string;
    };
  }
}
