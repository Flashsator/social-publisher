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
  cancel: () => invoke<void>("oauth_cancel"),
  facebookListPages: (userToken: string) =>
    invoke<FbPage[]>("facebook_list_pages", { userToken }),
  facebookResolvePage: (pageToken: string) =>
    invoke<string>("facebook_resolve_page", { pageToken }),
  instagramResolveUser: (accessToken: string) =>
    invoke<string>("instagram_resolve_user", { accessToken }),
  threadsResolveUser: (accessToken: string) =>
    invoke<string>("threads_resolve_user", { accessToken }),
  facebookDebugToken: (token: string) =>
    invoke<number>("facebook_debug_token", { token }),
  instagramDebugToken: (token: string) =>
    invoke<number>("instagram_debug_token", { token }),
  threadsDebugToken: (token: string) =>
    invoke<number>("threads_debug_token", { token }),
  instagramRefreshToken: (accessToken: string) =>
    invoke<[string, number]>("instagram_refresh_token", { accessToken }),
  threadsRefreshToken: (accessToken: string) =>
    invoke<[string, number]>("threads_refresh_token", { accessToken }),
};

export type MediaKind = "image" | "video";

export type CloudinaryVerifyResult = {
  plan: string;
  credits_used: number | null;
  credits_limit: number | null;
};

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
  verify: (args: { cloudName: string; apiKey: string; apiSecret: string }) =>
    invoke<CloudinaryVerifyResult>("cloudinary_verify", {
      cloudName: args.cloudName,
      apiKey: args.apiKey,
      apiSecret: args.apiSecret,
    }),
  delete: (args: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
    publicId: string;
    kind?: MediaKind;
  }) =>
    invoke<void>("cloudinary_delete", {
      cloudName: args.cloudName,
      apiKey: args.apiKey,
      apiSecret: args.apiSecret,
      publicId: args.publicId,
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
    published?: boolean;
  }) =>
    invoke<PublishResult>("publish_facebook", {
      pageId: args.pageId,
      pageToken: args.pageToken,
      text: args.text,
      imageUrls: args.imageUrls,
      videoUrl: args.videoUrl ?? null,
      videoPath: args.videoPath ?? null,
      published: args.published ?? true,
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

export type ScheduleStatus = "pending" | "running" | "done" | "failed";

export type ScheduledMedia = {
  kind: MediaKind;
  localPath: string;
  remoteUrl?: string | null;
};

export type PlatformOutcome = {
  platform: string;
  ok: boolean;
  message: string;
  permalink: string | null;
};

export type ScheduledPost = {
  id: string;
  scheduledAt: number;
  createdAt: number;
  status: ScheduleStatus;
  composeMode: "photo" | "video";
  text: string;
  videoTitle: string;
  media: ScheduledMedia[];
  platforms: Platform[];
  postPrivacy: "public" | "private";
  ttMode: TikTokMode;
  ttSource: TikTokSource;
  results: PlatformOutcome[];
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
};

export type ScheduleInput = {
  scheduledAt: number;
  composeMode: "photo" | "video";
  text: string;
  videoTitle: string;
  media: ScheduledMedia[];
  platforms: Platform[];
  postPrivacy: "public" | "private";
  ttMode: TikTokMode;
  ttSource: TikTokSource;
};

export const schedule = {
  list: () => invoke<ScheduledPost[]>("schedule_list"),
  create: (input: ScheduleInput) =>
    invoke<ScheduledPost>("schedule_create", { input }),
  update: (id: string, input: ScheduleInput) =>
    invoke<ScheduledPost>("schedule_update", { id, input }),
  delete: (id: string) => invoke<void>("schedule_delete", { id }),
};
