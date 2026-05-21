import { invoke } from "@tauri-apps/api/core";

export type Platform = "facebook" | "instagram" | "threads";

export type VaultStatus = Array<[string, boolean]>;

export type OAuthResult = {
  access_token: string;
  expires_in: number | null;
  user_id: string | null;
};

export type FbPage = {
  id: string;
  name: string;
  access_token: string;
};

export type UploadResult = {
  url: string;
  public_id: string;
};

export type PublishResult = {
  post_id: string;
  permalink: string | null;
};

export const vault = {
  set: (key: string, value: string) =>
    invoke<void>("vault_set", { key, value }),
  get: (key: string) => invoke<string | null>("vault_get", { key }),
  delete: (key: string) => invoke<void>("vault_delete", { key }),
  wipeAll: () => invoke<void>("vault_wipe_all"),
  status: () => invoke<VaultStatus>("vault_status"),
};

export const oauth = {
  flow: (platform: Platform, clientId: string, clientSecret: string) =>
    invoke<OAuthResult>("oauth_flow", {
      platform,
      clientId,
      clientSecret,
    }),
  facebookListPages: (userToken: string) =>
    invoke<FbPage[]>("facebook_list_pages", { userToken }),
  instagramResolveUser: (accessToken: string) =>
    invoke<string>("instagram_resolve_user", { accessToken }),
  threadsResolveUser: (accessToken: string) =>
    invoke<string>("threads_resolve_user", { accessToken }),
};

export const cloudinary = {
  upload: (args: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
    filePath: string;
  }) =>
    invoke<UploadResult>("cloudinary_upload", {
      cloudName: args.cloudName,
      apiKey: args.apiKey,
      apiSecret: args.apiSecret,
      filePath: args.filePath,
    }),
};

export const publish = {
  facebook: (args: {
    pageId: string;
    pageToken: string;
    text: string;
    imageUrls: string[];
  }) =>
    invoke<PublishResult>("publish_facebook", {
      pageId: args.pageId,
      pageToken: args.pageToken,
      text: args.text,
      imageUrls: args.imageUrls,
    }),
  instagram: (args: {
    igUserId: string;
    accessToken: string;
    text: string;
    imageUrls: string[];
  }) =>
    invoke<PublishResult>("publish_instagram", {
      igUserId: args.igUserId,
      accessToken: args.accessToken,
      text: args.text,
      imageUrls: args.imageUrls,
    }),
  threads: (args: {
    thUserId: string;
    accessToken: string;
    text: string;
    imageUrls: string[];
  }) =>
    invoke<PublishResult>("publish_threads", {
      thUserId: args.thUserId,
      accessToken: args.accessToken,
      text: args.text,
      imageUrls: args.imageUrls,
    }),
};
