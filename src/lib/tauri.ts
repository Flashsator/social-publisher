import { invoke } from "@tauri-apps/api/core";

export type Platform =
  | "facebook"
  | "instagram"
  | "threads"
  | "youtube"
  | "tiktok";

export type VaultStatus = Array<[string, boolean]>;

export type OAuthResult = {
  access_token: string;
  expires_in: number | null;
  user_id: string | null;
  refresh_token?: string | null;
  open_id?: string | null;
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

export type YouTubePrivacy = "public" | "unlisted" | "private";
export type TikTokMode = "inbox" | "direct_post";
export type TikTokSource = "file_upload" | "pull_from_url";
export type TikTokPrivacy =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

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

export type MediaKind = "image" | "video";

export const cloudinary = {
  upload: (args: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
    filePath: string;
    kind?: MediaKind;
  }) =>
    invoke<UploadResult>("cloudinary_upload", {
      cloudName: args.cloudName,
      apiKey: args.apiKey,
      apiSecret: args.apiSecret,
      filePath: args.filePath,
      kind: args.kind ?? "image",
    }),
};

export const publish = {
  facebook: (args: {
    pageId: string;
    pageToken: string;
    text: string;
    imageUrls: string[];
    videoUrl?: string | null;
    videoPath?: string | null;
  }) =>
    invoke<PublishResult>("publish_facebook", {
      pageId: args.pageId,
      pageToken: args.pageToken,
      text: args.text,
      imageUrls: args.imageUrls,
      videoUrl: args.videoUrl ?? null,
      videoPath: args.videoPath ?? null,
    }),
  instagram: (args: {
    igUserId: string;
    accessToken: string;
    text: string;
    imageUrls: string[];
    videoUrl?: string | null;
  }) =>
    invoke<PublishResult>("publish_instagram", {
      igUserId: args.igUserId,
      accessToken: args.accessToken,
      text: args.text,
      imageUrls: args.imageUrls,
      videoUrl: args.videoUrl ?? null,
    }),
  threads: (args: {
    thUserId: string;
    accessToken: string;
    text: string;
    imageUrls: string[];
    videoUrl?: string | null;
  }) =>
    invoke<PublishResult>("publish_threads", {
      thUserId: args.thUserId,
      accessToken: args.accessToken,
      text: args.text,
      imageUrls: args.imageUrls,
      videoUrl: args.videoUrl ?? null,
    }),
  youtube: (args: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    title: string;
    description: string;
    privacy: YouTubePrivacy;
    videoPath: string;
  }) =>
    invoke<PublishResult>("publish_youtube", {
      clientId: args.clientId,
      clientSecret: args.clientSecret,
      refreshToken: args.refreshToken,
      title: args.title,
      description: args.description,
      privacy: args.privacy,
      videoPath: args.videoPath,
    }),
  tiktok: (args: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    mode: TikTokMode;
    source: TikTokSource;
    videoUrl?: string | null;
    videoPath?: string | null;
    title?: string | null;
    privacyLevel?: TikTokPrivacy | null;
  }) =>
    invoke<PublishResult>("publish_tiktok", {
      clientId: args.clientId,
      clientSecret: args.clientSecret,
      refreshToken: args.refreshToken,
      mode: args.mode,
      source: args.source,
      videoUrl: args.videoUrl ?? null,
      videoPath: args.videoPath ?? null,
      title: args.title ?? null,
      privacyLevel: args.privacyLevel ?? null,
    }),
};
