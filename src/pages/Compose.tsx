import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  cloudinary,
  publish,
  vault,
  type MediaKind,
  type Platform,
  type PublishResult,
  type TikTokMode,
  type TikTokPrivacy,
  type TikTokSource,
  type YouTubePrivacy,
} from "../lib/tauri";
import { PLATFORMS } from "../lib/platforms";

type MediaItem = {
  kind: MediaKind;
  localPath: string;
  remoteUrl: string | null;
  uploading: boolean;
  error: string | null;
};

type Result = { platform: Platform; ok: boolean; message: string; permalink?: string | null };
type ComposeMode = "photo" | "video";

const PHOTO_PLATFORMS: Platform[] = ["facebook", "instagram", "threads"];
const VIDEO_PLATFORMS: Platform[] = [
  "facebook",
  "instagram",
  "threads",
  "youtube",
  "tiktok",
];

const allowedFor = (mode: ComposeMode): Platform[] =>
  mode === "photo" ? PHOTO_PLATFORMS : VIDEO_PLATFORMS;

const card = "border border-(--color-border) bg-(--color-surface) rounded-xl p-5 space-y-4";
const btn =
  "px-3 py-2 rounded-md bg-(--color-accent) text-black text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed";
const btnGhost =
  "px-3 py-2 rounded-md bg-(--color-surface-2) text-(--color-text) text-sm font-medium hover:bg-(--color-border) disabled:opacity-50";
const input =
  "w-full bg-(--color-bg) border border-(--color-border) rounded-md px-3 py-2 text-sm focus:outline-none focus:border-(--color-accent)";
const select = `${input} appearance-none`;
const fieldLabel = "block text-xs uppercase tracking-wide text-(--color-muted) mb-1";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];
const VIDEO_EXTS = ["mp4", "mov", "m4v"];

const fileName = (p: string) => {
  const norm = p.replace(/\\/g, "/");
  return norm.split("/").pop() ?? p;
};

const CONNECTED_KEY: Record<Platform, string> = {
  facebook: "fb_page_token",
  instagram: "ig_token",
  threads: "th_token",
  youtube: "yt_refresh_token",
  tiktok: "tt_refresh_token",
};

export default function Compose() {
  const [composeMode, setComposeMode] = useState<ComposeMode>("photo");
  const [text, setText] = useState("");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [selected, setSelected] = useState<Record<Platform, boolean>>({
    facebook: true,
    instagram: false,
    threads: false,
    youtube: false,
    tiktok: false,
  });

  const [ytTitle, setYtTitle] = useState("");
  const [ytPrivacy, setYtPrivacy] = useState<YouTubePrivacy>("private");
  const [ttMode, setTtMode] = useState<TikTokMode>("inbox");
  const [ttSource, setTtSource] = useState<TikTokSource>("file_upload");
  const [ttPrivacy, setTtPrivacy] = useState<TikTokPrivacy>("SELF_ONLY");

  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [vaultMap, setVaultMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    vault.status().then((list) => {
      const obj: Record<string, boolean> = {};
      for (const [k, v] of list) obj[k] = v;
      setVaultMap(obj);
    });
  }, []);

  const cloudinaryConfigured =
    !!vaultMap.cl_cloud_name && !!vaultMap.cl_api_key && !!vaultMap.cl_api_secret;

  const allowedPlatforms = useMemo(() => allowedFor(composeMode), [composeMode]);
  const allowedSet = useMemo(() => new Set(allowedPlatforms), [allowedPlatforms]);

  const videoItem = useMemo(
    () => (composeMode === "video" ? media.find((m) => m.kind === "video") ?? null : null),
    [media, composeMode]
  );
  const imageItems = useMemo(
    () => (composeMode === "photo" ? media.filter((m) => m.kind === "image") : []),
    [media, composeMode]
  );

  // Cloudinary is only required when a selected platform needs a hosted URL:
  //   photo mode: IG / Threads (any image) and FB (image posts)
  //   video mode: IG / Threads (any video) and TT with source = pull_from_url
  //   YouTube and FB video and TT file_upload always go local — never require Cloudinary.
  const needsCloudinaryUpload = useMemo(() => {
    if (media.length === 0) return false;
    if (composeMode === "photo") {
      if (imageItems.length === 0) return false;
      return selected.instagram || selected.threads || selected.facebook;
    }
    if (!videoItem) return false;
    if (selected.instagram || selected.threads) return true;
    if (selected.tiktok && ttSource === "pull_from_url") return true;
    return false;
  }, [media, imageItems, videoItem, selected, composeMode, ttSource]);

  const allRemote = useMemo(
    () => !needsCloudinaryUpload || media.every((m) => m.remoteUrl),
    [needsCloudinaryUpload, media]
  );

  const switchMode = (next: ComposeMode) => {
    if (next === composeMode) return;
    if (media.length > 0) {
      const ok = confirm(
        "Switching mode will clear the current media. Continue?"
      );
      if (!ok) return;
    }
    setComposeMode(next);
    setMedia([]);
    setResults([]);
    setSelected((s) => {
      const allowed = new Set(allowedFor(next));
      const out: Record<Platform, boolean> = { ...s };
      for (const p of PLATFORMS) {
        if (!allowed.has(p.id)) out[p.id] = false;
      }
      return out;
    });
  };

  const pickImages = async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: "Images", extensions: IMAGE_EXTS }],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    const next = paths.map<MediaItem>((p) => ({
      kind: "image",
      localPath: p as string,
      remoteUrl: null,
      uploading: false,
      error: null,
    }));
    setMedia((prev) => [...prev, ...next]);
    setResults([]);
  };

  const pickVideo = async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Video", extensions: VIDEO_EXTS }],
    });
    if (!picked) return;
    const path = (Array.isArray(picked) ? picked[0] : picked) as string;
    const next: MediaItem = {
      kind: "video",
      localPath: path,
      remoteUrl: null,
      uploading: false,
      error: null,
    };
    setMedia([next]);
    setResults([]);
  };

  const removeMedia = (idx: number) =>
    setMedia((prev) => prev.filter((_, i) => i !== idx));

  const uploadAll = async () => {
    const cn = await vault.get("cl_cloud_name");
    const ak = await vault.get("cl_api_key");
    const as = await vault.get("cl_api_secret");
    if (!cn || !ak || !as) {
      alert("Cloudinary credentials not set. Go to Setup first.");
      return;
    }
    for (let i = 0; i < media.length; i++) {
      const item = media[i];
      if (item.remoteUrl || item.uploading) continue;
      setMedia((prev) =>
        prev.map((x, idx) => (idx === i ? { ...x, uploading: true, error: null } : x))
      );
      try {
        const r = await cloudinary.upload({
          cloudName: cn,
          apiKey: ak,
          apiSecret: as,
          filePath: item.localPath,
          kind: item.kind,
        });
        setMedia((prev) =>
          prev.map((x, idx) =>
            idx === i ? { ...x, remoteUrl: r.url, uploading: false } : x
          )
        );
      } catch (e) {
        setMedia((prev) =>
          prev.map((x, idx) =>
            idx === i ? { ...x, uploading: false, error: String(e) } : x
          )
        );
      }
    }
  };

  const doPublish = async () => {
    setPublishing(true);
    setResults([]);
    const out: Result[] = [];
    const imageUrls = imageItems.map((i) => i.remoteUrl!).filter(Boolean);

    for (const p of PLATFORMS) {
      if (!allowedSet.has(p.id) || !selected[p.id]) continue;
      try {
        let r: PublishResult;
        if (p.id === "facebook") {
          const pageId = await vault.get("fb_page_id");
          const pageToken = await vault.get("fb_page_token");
          if (!pageId || !pageToken) throw new Error("Facebook Page not connected");
          r = await publish.facebook({
            pageId,
            pageToken,
            text,
            imageUrls,
            videoUrl: null,
            videoPath: videoItem?.localPath ?? null,
          });
        } else if (p.id === "instagram") {
          const igUserId = await vault.get("ig_user_id");
          const accessToken = await vault.get("ig_token");
          if (!igUserId || !accessToken) throw new Error("Instagram not connected");
          r = await publish.instagram({
            igUserId,
            accessToken,
            text,
            imageUrls,
            videoUrl: videoItem?.remoteUrl ?? null,
          });
        } else if (p.id === "threads") {
          const thUserId = await vault.get("th_user_id");
          const accessToken = await vault.get("th_token");
          if (!thUserId || !accessToken) throw new Error("Threads not connected");
          r = await publish.threads({
            thUserId,
            accessToken,
            text,
            imageUrls,
            videoUrl: videoItem?.remoteUrl ?? null,
          });
        } else if (p.id === "youtube") {
          if (!videoItem) throw new Error("YouTube requires a video");
          const clientId = await vault.get("yt_client_id");
          const clientSecret = await vault.get("yt_client_secret");
          const refreshToken = await vault.get("yt_refresh_token");
          if (!clientId || !clientSecret || !refreshToken)
            throw new Error("YouTube not connected");
          if (!ytTitle.trim()) throw new Error("YouTube title is required");
          r = await publish.youtube({
            clientId,
            clientSecret,
            refreshToken,
            title: ytTitle.trim(),
            description: text,
            privacy: ytPrivacy,
            videoPath: videoItem.localPath,
          });
        } else {
          if (!videoItem) throw new Error("TikTok requires a video");
          if (ttSource === "pull_from_url" && !videoItem.remoteUrl)
            throw new Error(
              "TikTok PULL_FROM_URL requires the video to be uploaded to Cloudinary"
            );
          const clientId = await vault.get("tt_client_id");
          const clientSecret = await vault.get("tt_client_secret");
          const refreshToken = await vault.get("tt_refresh_token");
          if (!clientId || !clientSecret || !refreshToken)
            throw new Error("TikTok not connected");
          r = await publish.tiktok({
            clientId,
            clientSecret,
            refreshToken,
            mode: ttMode,
            source: ttSource,
            videoUrl: ttSource === "pull_from_url" ? videoItem.remoteUrl : null,
            videoPath: ttSource === "file_upload" ? videoItem.localPath : null,
            title: ttMode === "direct_post" ? text : null,
            privacyLevel: ttMode === "direct_post" ? ttPrivacy : null,
          });
        }
        out.push({
          platform: p.id,
          ok: true,
          message: `Posted (${r.post_id})`,
          permalink: r.permalink,
        });
      } catch (e) {
        out.push({ platform: p.id, ok: false, message: String(e) });
      }
      setResults([...out]);
    }
    setPublishing(false);
  };

  const photoMode = composeMode === "photo";
  const videoMode = composeMode === "video";
  const anySelected = allowedPlatforms.some((id) => selected[id]);

  const igNeedsImages = photoMode && selected.instagram && imageItems.length === 0;
  const thNeedsImages = photoMode && selected.threads && imageItems.length === 0;
  const fbNeedsVideo = videoMode && selected.facebook && !videoItem;
  const igNeedsVideo = videoMode && selected.instagram && !videoItem;
  const thNeedsVideo = videoMode && selected.threads && !videoItem;
  const ytNeedsVideo = videoMode && selected.youtube && !videoItem;
  const ttNeedsVideo = videoMode && selected.tiktok && !videoItem;
  const ytNeedsTitle = videoMode && selected.youtube && !ytTitle.trim();

  const hasMissing =
    igNeedsImages ||
    thNeedsImages ||
    fbNeedsVideo ||
    igNeedsVideo ||
    thNeedsVideo ||
    ytNeedsVideo ||
    ttNeedsVideo ||
    ytNeedsTitle;

  const canPublish =
    !publishing &&
    anySelected &&
    !hasMissing &&
    allRemote &&
    (text.length > 0 || media.length > 0);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Compose</h1>
        <p className="text-sm text-(--color-muted)">
          {photoMode
            ? "Photo & text post → Facebook, Instagram, Threads."
            : "Video post → Facebook, Instagram, Threads, YouTube, TikTok."}
        </p>
      </header>

      <div
        role="tablist"
        className="inline-flex rounded-lg border border-(--color-border) bg-(--color-surface) p-1"
      >
        <ModeTab
          active={photoMode}
          label="Photo & Text"
          onClick={() => switchMode("photo")}
        />
        <ModeTab
          active={videoMode}
          label="Video"
          onClick={() => switchMode("video")}
        />
      </div>

      <section className={card}>
        <label className="text-xs uppercase tracking-wide text-(--color-muted)">
          {photoMode ? "Caption / text" : "Description / caption"}
        </label>
        <textarea
          rows={6}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          placeholder={
            photoMode
              ? "What do you want to publish?"
              : "Video description (used as YouTube description and the TikTok caption when direct posting)."
          }
          className="w-full bg-(--color-bg) border border-(--color-border) rounded-md px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:border-(--color-accent)"
        />
        <CharCounters text={text} selected={selected} allowed={allowedSet} />
      </section>

      <section className={card}>
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Media</h2>
            <p className="text-xs text-(--color-muted)">
              {photoMode
                ? "Attach one or more images (jpg/png/webp)."
                : "Attach a single video (mp4/mov/m4v)."}
            </p>
          </div>
          <div className="flex gap-2">
            {photoMode ? (
              <button className={btnGhost} onClick={pickImages}>
                + Add images
              </button>
            ) : (
              <button
                className={btnGhost}
                onClick={pickVideo}
                disabled={media.some((m) => m.uploading)}
              >
                {media.length === 0 ? "+ Add video" : "Replace video"}
              </button>
            )}
            <button
              className={btn}
              onClick={uploadAll}
              disabled={
                !cloudinaryConfigured ||
                media.length === 0 ||
                !needsCloudinaryUpload ||
                media.every((m) => m.remoteUrl)
              }
              title={
                !cloudinaryConfigured
                  ? "Set Cloudinary credentials in Setup first"
                  : !needsCloudinaryUpload
                    ? "No selected platform requires Cloudinary"
                    : ""
              }
            >
              Upload to Cloudinary
            </button>
          </div>
        </header>

        {media.length === 0 ? (
          <p className="text-xs text-(--color-muted)">No media attached.</p>
        ) : (
          <ul className="space-y-2">
            {media.map((m, i) => (
              <li
                key={i}
                className="flex items-center gap-3 bg-(--color-bg) border border-(--color-border) rounded-md px-3 py-2 text-sm"
              >
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-(--color-surface-2) text-(--color-muted)">
                  {m.kind}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{fileName(m.localPath)}</div>
                  <div className="text-xs text-(--color-muted) truncate">
                    {m.remoteUrl ? m.remoteUrl : m.localPath}
                  </div>
                  {m.error && (
                    <div className="text-xs text-(--color-danger)">{m.error}</div>
                  )}
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    m.remoteUrl
                      ? "bg-(--color-success)/15 text-(--color-success)"
                      : m.uploading
                        ? "bg-(--color-accent)/15 text-(--color-accent)"
                        : "bg-(--color-surface-2) text-(--color-muted)"
                  }`}
                >
                  {m.remoteUrl ? "uploaded" : m.uploading ? "uploading…" : "local"}
                </span>
                <button
                  className="text-xs text-(--color-muted) hover:text-(--color-danger)"
                  onClick={() => removeMedia(i)}
                  disabled={m.uploading}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold">Publish to</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {PLATFORMS.filter((p) => allowedSet.has(p.id)).map((p) => {
            const connected = !!vaultMap[CONNECTED_KEY[p.id]];
            return (
              <label
                key={p.id}
                className={`flex items-center gap-3 px-3 py-3 rounded-md border cursor-pointer transition-colors ${
                  selected[p.id]
                    ? "border-(--color-accent) bg-(--color-accent)/10"
                    : "border-(--color-border) bg-(--color-bg) hover:border-(--color-muted)"
                } ${!connected ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selected[p.id]}
                  disabled={!connected}
                  onChange={(e) =>
                    setSelected((s) => ({ ...s, [p.id]: e.currentTarget.checked }))
                  }
                />
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: p.accent }}
                />
                <div>
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-xs text-(--color-muted)">
                    {connected ? "Connected" : "Not connected"}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
        {photoMode && (igNeedsImages || thNeedsImages) && (
          <p className="text-xs text-(--color-danger)">
            {igNeedsImages && thNeedsImages
              ? "Instagram and Threads require at least one image."
              : igNeedsImages
                ? "Instagram requires at least one image."
                : "Threads requires at least one image."}
          </p>
        )}
        {videoMode &&
          (fbNeedsVideo ||
            igNeedsVideo ||
            thNeedsVideo ||
            ytNeedsVideo ||
            ttNeedsVideo) && (
            <p className="text-xs text-(--color-danger)">
              Attach a video — selected platforms publish only in video mode.
            </p>
          )}
      </section>

      {videoMode && selected.youtube && (
        <section className={card}>
          <h2 className="text-base font-semibold">YouTube</h2>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className={fieldLabel}>Video title (required)</label>
              <input
                className={input}
                value={ytTitle}
                onChange={(e) => setYtTitle(e.currentTarget.value)}
                placeholder="Title shown on YouTube"
                maxLength={100}
              />
            </div>
            <div>
              <label className={fieldLabel}>Privacy</label>
              <select
                className={select}
                value={ytPrivacy}
                onChange={(e) =>
                  setYtPrivacy(e.currentTarget.value as YouTubePrivacy)
                }
              >
                <option value="private">Private</option>
                <option value="unlisted">Unlisted</option>
                <option value="public">Public</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-(--color-muted)">
            The composed text becomes the YouTube description (max 5,000 chars).
          </p>
        </section>
      )}

      {videoMode && selected.tiktok && (
        <section className={card}>
          <h2 className="text-base font-semibold">TikTok</h2>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={fieldLabel}>Publish mode</label>
              <select
                className={select}
                value={ttMode}
                onChange={(e) => setTtMode(e.currentTarget.value as TikTokMode)}
              >
                <option value="inbox">Send to Inbox (review in TikTok app)</option>
                <option value="direct_post">Direct post (publishes immediately)</option>
              </select>
            </div>
            <div>
              <label className={fieldLabel}>Upload source</label>
              <select
                className={select}
                value={ttSource}
                onChange={(e) => setTtSource(e.currentTarget.value as TikTokSource)}
              >
                <option value="file_upload">File upload (local, ≤ 64 MiB)</option>
                <option value="pull_from_url">Pull from URL (Cloudinary)</option>
              </select>
            </div>
            {ttMode === "direct_post" && (
              <div>
                <label className={fieldLabel}>Privacy</label>
                <select
                  className={select}
                  value={ttPrivacy}
                  onChange={(e) =>
                    setTtPrivacy(e.currentTarget.value as TikTokPrivacy)
                  }
                >
                  <option value="SELF_ONLY">Private (only me)</option>
                  <option value="MUTUAL_FOLLOW_FRIENDS">Friends</option>
                  <option value="FOLLOWER_OF_CREATOR">Followers</option>
                  <option value="PUBLIC_TO_EVERYONE">Public</option>
                </select>
              </div>
            )}
          </div>
          <p className="text-xs text-(--color-muted)">
            {ttSource === "pull_from_url" ? (
              <>
                Pull from URL uses the Cloudinary URL. Make sure{" "}
                <code>res.cloudinary.com</code> is whitelisted in your TikTok
                developer settings.
              </>
            ) : (
              <>
                File upload sends the local video directly to TikTok (single chunk
                up to 64 MiB). No Cloudinary whitelist needed.
              </>
            )}
            {ttMode === "direct_post" &&
              " The composed text becomes the post caption."}
          </p>
        </section>
      )}

      <div className="flex items-center gap-3">
        <button className={btn} onClick={doPublish} disabled={!canPublish}>
          {publishing ? "Publishing…" : "Publish"}
        </button>
        {!allRemote && media.length > 0 && (
          <span className="text-xs text-(--color-muted)">
            Upload media to Cloudinary before publishing.
          </span>
        )}
      </div>

      {results.length > 0 && (
        <section className={card}>
          <h2 className="text-base font-semibold">Results</h2>
          <ul className="space-y-2">
            {results.map((r, i) => (
              <li
                key={i}
                className={`text-sm px-3 py-2 rounded-md ${
                  r.ok
                    ? "bg-(--color-success)/10 text-(--color-success)"
                    : "bg-(--color-danger)/10 text-(--color-danger)"
                }`}
              >
                <span className="font-semibold capitalize">{r.platform}</span>: {r.message}{" "}
                {r.permalink && (
                  <a
                    href={r.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-(--color-accent)"
                  >
                    open
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ModeTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
        active
          ? "bg-(--color-accent) text-black"
          : "text-(--color-muted) hover:text-(--color-text)"
      }`}
    >
      {label}
    </button>
  );
}

function CharCounters({
  text,
  selected,
  allowed,
}: {
  text: string;
  selected: Record<Platform, boolean>;
  allowed: Set<Platform>;
}) {
  const len = text.length;
  return (
    <div className="flex gap-4 text-xs text-(--color-muted) flex-wrap">
      {PLATFORMS.filter((p) => allowed.has(p.id) && selected[p.id]).map((p) => {
        if (p.charLimit == null) return null;
        const over = len > p.charLimit;
        return (
          <span
            key={p.id}
            className={over ? "text-(--color-danger) font-medium" : ""}
          >
            {p.label}: {len} / {p.charLimit}
          </span>
        );
      })}
    </div>
  );
}
