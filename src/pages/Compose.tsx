import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  cloudinary,
  publish,
  schedule,
  vault,
  type MediaKind,
  type Platform,
  type PublishResult,
  type ScheduleInput,
  type TikTokMode,
  type TikTokPrivacy,
  type TikTokSource,
  type YouTubePrivacy,
} from "../lib/tauri";
import { PLATFORMS } from "../lib/platforms";
import { useT } from "../lib/i18n";

type MediaItem = {
  kind: MediaKind;
  localPath: string;
  remoteUrl: string | null;
  publicId: string | null;
  uploading: boolean;
  error: string | null;
};

type Result = { platform: Platform; ok: boolean; message: string; permalink?: string | null };
type ComposeMode = "photo" | "video";

const PHOTO_PLATFORMS: Platform[] = ["instagram", "threads"];
const VIDEO_PLATFORMS: Platform[] = [
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

const nowLocalInput = (): string => {
  const d = new Date(Date.now() + 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

const CONNECTED_KEY: Record<Platform, string> = {
  facebook: "fb_page_token",
  instagram: "ig_token",
  threads: "th_token",
  youtube: "yt_refresh_token",
  tiktok: "tt_refresh_token",
};

export default function Compose() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const [composeMode, setComposeMode] = useState<ComposeMode>("photo");
  const scheduleSectionRef = useRef<HTMLElement | null>(null);
  const [text, setText] = useState("");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [selected, setSelected] = useState<Record<Platform, boolean>>({
    facebook: false,
    instagram: false,
    threads: false,
    youtube: false,
    tiktok: false,
  });

  const [videoTitle, setVideoTitle] = useState("");
  const [postPrivacy, setPostPrivacy] = useState<"public" | "private">("public");
  const [ttMode, setTtMode] = useState<TikTokMode>("inbox");
  const [ttSource, setTtSource] = useState<TikTokSource>("file_upload");
  const ytPrivacy: YouTubePrivacy = postPrivacy === "public" ? "public" : "private";
  const ttPrivacy: TikTokPrivacy =
    postPrivacy === "public" ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY";

  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [vaultMap, setVaultMap] = useState<Record<string, boolean>>({});
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [scheduling, setScheduling] = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState<string | null>(null);
  const [nowMin, setNowMin] = useState<string>(() => nowLocalInput());
  useEffect(() => {
    const id = window.setInterval(() => setNowMin(nowLocalInput()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  type Snapshot = {
    text: string;
    media: MediaItem[];
    selected: Record<Platform, boolean>;
    results: Result[];
    videoTitle: string;
  };
  const [snapshots, setSnapshots] = useState<Record<ComposeMode, Snapshot | null>>({
    photo: null,
    video: null,
  });
  type Drag = { idx: number; startY: number; shifted: number; rowH: number };
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cursorY, setCursorY] = useState(0);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const mediaRef = useRef<MediaItem[]>(media);
  mediaRef.current = media;
  const rowRefs = useRef<Map<string, HTMLLIElement | null>>(new Map());
  const [thumbSize, setThumbSize] = useState(96);

  const startDrag = (e: React.PointerEvent, i: number, key: string) => {
    if (composeMode !== "photo" || e.button !== 0) return;
    const rowEl = rowRefs.current.get(key);
    if (!rowEl) return;
    e.preventDefault();
    setCursorY(e.clientY);
    setDrag({ idx: i, startY: e.clientY, shifted: 0, rowH: rowEl.offsetHeight + 8 });
  };

  const dragActive = drag !== null;
  useEffect(() => {
    if (!dragActive) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setCursorY(e.clientY);
      const delta = e.clientY - d.startY;
      const targetShift = Math.round(delta / d.rowH);
      if (targetShift === d.shifted) return;
      const len = mediaRef.current.length;
      const newIdx = Math.max(0, Math.min(len - 1, d.idx - d.shifted + targetShift));
      if (newIdx !== d.idx) {
        setMedia((prev) => {
          const arr = prev.slice();
          const [m] = arr.splice(d.idx, 1);
          arr.splice(newIdx, 0, m);
          return arr;
        });
      }
      setDrag({ ...d, idx: newIdx, shifted: targetShift });
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragActive]);

  useEffect(() => {
    vault.status().then((list) => {
      const obj: Record<string, boolean> = {};
      for (const [k, v] of list) obj[k] = v;
      setVaultMap(obj);
    });
  }, [location.key]);

  useEffect(() => {
    const refetch = () => {
      vault.status().then((list) => {
        const obj: Record<string, boolean> = {};
        for (const [k, v] of list) obj[k] = v;
        setVaultMap(obj);
      });
    };
    window.addEventListener("focus", refetch);
    return () => window.removeEventListener("focus", refetch);
  }, []);

  useEffect(() => {
    setSelected((s) => {
      let changed = false;
      const next = { ...s };
      for (const p of PLATFORMS) {
        if (s[p.id] && !vaultMap[CONNECTED_KEY[p.id]]) {
          next[p.id] = false;
          changed = true;
        }
      }
      return changed ? next : s;
    });
  }, [vaultMap]);

  useEffect(() => {
    const st = location.state as
      | { presetMode?: ComposeMode; focusSchedule?: boolean }
      | null;
    if (!st?.presetMode) return;
    if (st.presetMode !== composeMode) switchMode(st.presetMode);
    if (st.focusSchedule) {
      requestAnimationFrame(() => {
        scheduleSectionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    }
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

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

  const switchMode = (next: ComposeMode) => {
    if (next === composeMode) return;
    setSnapshots((s) => ({
      ...s,
      [composeMode]: { text, media, selected, results, videoTitle },
    }));
    const snap = snapshots[next];
    if (snap) {
      setText(snap.text);
      setMedia(snap.media);
      setSelected(snap.selected);
      setResults(snap.results);
      setVideoTitle(snap.videoTitle);
    } else {
      setText("");
      setMedia([]);
      setResults([]);
      setVideoTitle("");
      setSelected((s) => {
        const allowed = new Set(allowedFor(next));
        const out: Record<Platform, boolean> = { ...s };
        for (const p of PLATFORMS) {
          if (!allowed.has(p.id)) out[p.id] = false;
        }
        return out;
      });
    }
    setComposeMode(next);
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
      publicId: null,
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
      publicId: null,
      uploading: false,
      error: null,
    };
    setMedia([next]);
    setResults([]);
  };

  const removeMedia = (idx: number) =>
    setMedia((prev) => prev.filter((_, i) => i !== idx));

  const moveMedia = (idx: number, dir: -1 | 1) =>
    setMedia((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });

  type CloudinaryCreds = { cn: string; ak: string; as: string };

  const ensureUploaded = async (
    items: MediaItem[],
    creds: CloudinaryCreds,
  ): Promise<MediaItem[]> => {
    const next = items.slice();
    for (let i = 0; i < next.length; i++) {
      const item = next[i];
      if (item.remoteUrl) continue;
      setMedia((prev) =>
        prev.map((x) =>
          x.localPath === item.localPath ? { ...x, uploading: true, error: null } : x,
        ),
      );
      const r = await cloudinary.upload({
        cloudName: creds.cn,
        apiKey: creds.ak,
        apiSecret: creds.as,
        filePath: item.localPath,
        kind: item.kind,
      });
      next[i] = { ...item, remoteUrl: r.url, publicId: r.public_id, uploading: false };
      setMedia((prev) =>
        prev.map((x) =>
          x.localPath === item.localPath
            ? { ...x, remoteUrl: r.url, publicId: r.public_id, uploading: false }
            : x,
        ),
      );
    }
    return next;
  };

  const deleteFromCloudinary = async (items: MediaItem[], creds: CloudinaryCreds) => {
    for (const m of items) {
      if (!m.publicId) continue;
      try {
        await cloudinary.delete({
          cloudName: creds.cn,
          apiKey: creds.ak,
          apiSecret: creds.as,
          publicId: m.publicId,
          kind: m.kind,
        });
      } catch (e) {
        console.error("[Cloudinary delete]", m.publicId, e);
      }
    }
  };

  const doPublish = async () => {
    setPublishing(true);
    setResults([]);
    const out: Result[] = [];
    let workingMedia = media;
    let creds: CloudinaryCreds | null = null;
    if (needsCloudinaryUpload) {
      const cn = await vault.get("cl_cloud_name");
      const ak = await vault.get("cl_api_key");
      const as = await vault.get("cl_api_secret");
      if (!cn || !ak || !as) {
        setResults([{ platform: "facebook", ok: false, message: "Cloudinary 憑證未設定,請先到 Setup 設定" }]);
        setPublishing(false);
        return;
      }
      creds = { cn, ak, as };
      try {
        workingMedia = await ensureUploaded(media, creds);
      } catch (e) {
        setMedia((prev) =>
          prev.map((x) =>
            x.uploading ? { ...x, uploading: false, error: String(e) } : x,
          ),
        );
        setResults([{ platform: "facebook", ok: false, message: `Cloudinary 上傳失敗: ${String(e)}` }]);
        setPublishing(false);
        return;
      }
    }
    const workingImages = workingMedia.filter((m) => m.kind === "image");
    const workingVideo = workingMedia.find((m) => m.kind === "video") ?? null;
    const imageUrls = workingImages.map((i) => i.remoteUrl!).filter(Boolean);

    for (const p of PLATFORMS) {
      if (!allowedSet.has(p.id) || !selected[p.id]) continue;
      if (!vaultMap[CONNECTED_KEY[p.id]]) continue;
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
            videoPath: workingVideo?.localPath ?? null,
            published: postPrivacy === "public",
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
            videoUrl: workingVideo?.remoteUrl ?? null,
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
            videoUrl: workingVideo?.remoteUrl ?? null,
          });
        } else if (p.id === "youtube") {
          if (!workingVideo) throw new Error("YouTube requires a video");
          const clientId = await vault.get("yt_client_id");
          const clientSecret = await vault.get("yt_client_secret");
          const refreshToken = await vault.get("yt_refresh_token");
          if (!clientId || !clientSecret || !refreshToken)
            throw new Error("YouTube not connected");
          if (!videoTitle.trim()) throw new Error("Video title is required for YouTube");
          r = await publish.youtube({
            clientId,
            clientSecret,
            refreshToken,
            title: videoTitle.trim(),
            description: text,
            privacy: ytPrivacy,
            videoPath: workingVideo.localPath,
          });
        } else {
          if (!workingVideo) throw new Error("TikTok requires a video");
          if (ttSource === "pull_from_url" && !workingVideo.remoteUrl)
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
            videoUrl: ttSource === "pull_from_url" ? workingVideo.remoteUrl : null,
            videoPath: ttSource === "file_upload" ? workingVideo.localPath : null,
            title: ttMode === "direct_post" ? videoTitle.trim() || text : null,
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
    if (creds) {
      await deleteFromCloudinary(workingMedia, creds);
    }
    setPublishing(false);
    setText("");
    setMedia([]);
    setVideoTitle("");
    setPostPrivacy("public");
    setScheduledAt("");
    setScheduleMsg(null);
    setSnapshots({ photo: null, video: null });
  };

  const buildScheduleInput = (): ScheduleInput => ({
    scheduledAt: Math.floor(new Date(scheduledAt).getTime() / 1000),
    composeMode,
    text,
    videoTitle: videoTitle.trim(),
    media: media.map((m) => ({
      kind: m.kind,
      localPath: m.localPath,
      remoteUrl: m.remoteUrl,
    })),
    platforms: PLATFORMS.filter((p) => allowedSet.has(p.id) && selected[p.id]).map(
      (p) => p.id
    ),
    postPrivacy,
    ttMode,
    ttSource,
  });

  const doSchedule = async () => {
    setScheduling(true);
    setScheduleMsg(null);
    try {
      const created = await schedule.create(buildScheduleInput());
      setScheduleMsg(
        new Date(created.scheduledAt * 1000).toLocaleString()
      );
      setText("");
      setMedia([]);
      setVideoTitle("");
      setPostPrivacy("public");
      setScheduledAt("");
      setSnapshots({ photo: null, video: null });
    } catch (e) {
      setScheduleMsg(String(e));
    } finally {
      setScheduling(false);
    }
  };

  const photoMode = composeMode === "photo";
  const videoMode = composeMode === "video";
  const anySelected = allowedPlatforms.some((id) => selected[id]);

  const igNeedsImages = photoMode && selected.instagram && imageItems.length === 0;
  const fbNeedsVideo = videoMode && selected.facebook && !videoItem;
  const igNeedsVideo = videoMode && selected.instagram && !videoItem;
  const thNeedsVideo = videoMode && selected.threads && !videoItem;
  const ytNeedsVideo = videoMode && selected.youtube && !videoItem;
  const ttNeedsVideo = videoMode && selected.tiktok && !videoItem;
  const ytNeedsTitle = videoMode && selected.youtube && !videoTitle.trim();

  const hasMissing =
    fbNeedsVideo ||
    igNeedsVideo ||
    thNeedsVideo ||
    ytNeedsVideo ||
    ttNeedsVideo ||
    ytNeedsTitle;

  const canPublish =
    !publishing &&
    !scheduling &&
    anySelected &&
    !hasMissing &&
    (text.length > 0 || media.length > 0);

  const scheduledTs = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
  const scheduleLeadOk =
    !!scheduledAt && Number.isFinite(scheduledTs) && scheduledTs > Date.now() + 60_000;
  const canSchedule =
    !scheduling &&
    !publishing &&
    anySelected &&
    !hasMissing &&
    scheduleLeadOk &&
    (text.length > 0 || media.length > 0);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("composeTitle")}</h1>
        <p className="text-sm text-(--color-muted)">
          {photoMode ? t("composeSubPhoto") : t("composeSubVideo")}
        </p>
      </header>

      <div
        role="tablist"
        className="inline-flex rounded-lg border border-(--color-border) bg-(--color-surface) p-1"
      >
        <ModeTab
          active={photoMode}
          label={t("tabPhoto")}
          onClick={() => switchMode("photo")}
        />
        <ModeTab
          active={videoMode}
          label={t("tabVideo")}
          onClick={() => switchMode("video")}
        />
      </div>

      <section className={card}>
        {videoMode && (
          <div>
            <label className={fieldLabel}>{t("videoTitle")}</label>
            <input
              className={input}
              value={videoTitle}
              onChange={(e) => setVideoTitle(e.currentTarget.value)}
              placeholder={t("videoTitlePh")}
              maxLength={100}
            />
          </div>
        )}
        <div>
          <label className={fieldLabel}>
            {photoMode ? t("captionPhoto") : t("captionVideo")}
          </label>
          <textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            placeholder={photoMode ? t("placeholderPhoto") : t("placeholderVideo")}
            className={`${input} leading-relaxed`}
          />
        </div>
        <CharCounters text={text} selected={selected} allowed={allowedSet} />
        <div className="pt-2 border-t border-(--color-border) space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={fieldLabel + " mb-0"}>{t("postPrivacy")}</span>
            <div
              role="radiogroup"
              className="inline-flex rounded-md border border-(--color-border) overflow-hidden"
            >
              <button
                type="button"
                role="radio"
                aria-checked={postPrivacy === "public"}
                onClick={() => setPostPrivacy("public")}
                className={`px-3 py-1.5 text-sm ${
                  postPrivacy === "public"
                    ? "bg-(--color-accent) text-black"
                    : "bg-(--color-surface) text-(--color-muted) hover:text-(--color-text)"
                }`}
              >
                {t("postPrivacyPublic")}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={postPrivacy === "private"}
                onClick={() => setPostPrivacy("private")}
                className={`px-3 py-1.5 text-sm border-l border-(--color-border) ${
                  postPrivacy === "private"
                    ? "bg-(--color-accent) text-black"
                    : "bg-(--color-surface) text-(--color-muted) hover:text-(--color-text)"
                }`}
              >
                {t("postPrivacyPrivate")}
              </button>
            </div>
          </div>
          {postPrivacy === "private" && (selected.instagram || selected.threads || selected.facebook) && (
            <p className="text-xs text-(--color-muted)">{t("privacyMetaHint")}</p>
          )}
        </div>
      </section>

      <section className={card}>
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">{t("media")}</h2>
            <p className="text-xs text-(--color-muted)">
              {photoMode ? t("mediaHintPhoto") : t("mediaHintVideo")}
            </p>
          </div>
          <div className="flex gap-2">
            {photoMode ? (
              <button className={btnGhost} onClick={pickImages}>
                {t("addImages")}
              </button>
            ) : (
              <button
                className={btnGhost}
                onClick={pickVideo}
                disabled={media.some((m) => m.uploading)}
              >
                {media.length === 0 ? t("addVideo") : t("replaceVideo")}
              </button>
            )}
          </div>
        </header>

        {photoMode && media.length > 0 && (
          <div className="flex items-center gap-3 text-xs text-(--color-muted)">
            <span>{t("thumbSize")}</span>
            <input
              type="range"
              min={48}
              max={240}
              step={8}
              value={thumbSize}
              onChange={(e) => setThumbSize(Number(e.currentTarget.value))}
              className="flex-1 max-w-xs accent-(--color-accent)"
            />
            <span className="tabular-nums w-12 text-right">{thumbSize}px</span>
          </div>
        )}

        {media.length === 0 ? (
          <p className="text-xs text-(--color-muted)">{t("noMedia")}</p>
        ) : (
          <ul className="space-y-2">
            {media.map((m, i) => {
              const isDragging = drag?.idx === i;
              const dy = isDragging && drag ? cursorY - drag.startY - drag.shifted * drag.rowH : 0;
              return (
              <li
                key={m.localPath}
                ref={(el) => {
                  rowRefs.current.set(m.localPath, el);
                }}
                style={{
                  transform: isDragging ? `translateY(${dy}px)` : undefined,
                  transition: isDragging
                    ? "none"
                    : "transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)",
                  zIndex: isDragging ? 10 : 1,
                  position: "relative",
                  touchAction: "none",
                }}
                className="flex items-center gap-3 bg-(--color-bg) border border-(--color-border) rounded-md px-3 py-2 text-sm"
              >
                {photoMode && (
                  <span
                    className="text-(--color-muted) select-none px-1 py-2 cursor-grab active:cursor-grabbing hover:text-(--color-text)"
                    title={t("dragToReorder")}
                    onPointerDown={(e) => startDrag(e, i, m.localPath)}
                    style={{ touchAction: "none" }}
                  >
                    ⋮⋮
                  </span>
                )}
                {photoMode && (
                  <span className="text-xs font-semibold w-6 h-6 inline-flex items-center justify-center rounded-full bg-(--color-accent)/15 text-(--color-accent)">
                    {i + 1}
                  </span>
                )}
                {m.kind === "image" ? (
                  <img
                    src={convertFileSrc(m.localPath)}
                    alt={fileName(m.localPath)}
                    draggable={false}
                    style={{ width: thumbSize, height: thumbSize }}
                    className="object-cover rounded-md border border-(--color-border) bg-(--color-bg) shrink-0"
                  />
                ) : (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-(--color-surface-2) text-(--color-muted)">
                    {m.kind}
                  </span>
                )}
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
                  {m.remoteUrl ? t("uploaded") : m.uploading ? t("uploading") : t("local")}
                </span>
                {photoMode && media.length > 1 && (
                  <div className="inline-flex rounded-md border border-(--color-border) overflow-hidden">
                    <button
                      type="button"
                      title={t("moveUp")}
                      className="px-2 py-1 text-(--color-muted) hover:text-(--color-text) hover:bg-(--color-surface-2) disabled:opacity-30 disabled:cursor-not-allowed"
                      onClick={() => moveMedia(i, -1)}
                      disabled={i === 0 || m.uploading}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      title={t("moveDown")}
                      className="px-2 py-1 text-(--color-muted) hover:text-(--color-text) hover:bg-(--color-surface-2) disabled:opacity-30 disabled:cursor-not-allowed border-l border-(--color-border)"
                      onClick={() => moveMedia(i, 1)}
                      disabled={i === media.length - 1 || m.uploading}
                    >
                      ↓
                    </button>
                  </div>
                )}
                <button
                  className="text-xs text-(--color-muted) hover:text-(--color-danger)"
                  onClick={() => removeMedia(i)}
                  disabled={m.uploading}
                >
                  {t("remove")}
                </button>
              </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold">{t("publishTo")}</h2>
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
                  onChange={(e) => {
                    const checked = e.currentTarget.checked;
                    setSelected((s) => ({ ...s, [p.id]: checked }));
                  }}
                />
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: p.accent }}
                />
                <div>
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-xs text-(--color-muted)">
                    {connected ? t("connected") : t("notConnected")}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
        {photoMode && igNeedsImages && (
          <p className="text-xs text-(--color-muted)">{t("igNeedImages")}</p>
        )}
        {videoMode &&
          (fbNeedsVideo ||
            igNeedsVideo ||
            thNeedsVideo ||
            ytNeedsVideo ||
            ttNeedsVideo) && (
            <p className="text-xs text-(--color-danger)">{t("needVideoAll")}</p>
          )}
      </section>

      {videoMode && selected.tiktok && (
        <section className={card}>
          <h2 className="text-base font-semibold">TikTok</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel}>{t("ttPublishMode")}</label>
              <select
                className={select}
                value={ttMode}
                onChange={(e) => setTtMode(e.currentTarget.value as TikTokMode)}
              >
                <option value="inbox">{t("ttInbox")}</option>
                <option value="direct_post">{t("ttDirect")}</option>
              </select>
            </div>
            <div>
              <label className={fieldLabel}>{t("ttUploadSource")}</label>
              <select
                className={select}
                value={ttSource}
                onChange={(e) => setTtSource(e.currentTarget.value as TikTokSource)}
              >
                <option value="file_upload">{t("ttFile")}</option>
                <option value="pull_from_url">{t("ttPull")}</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-(--color-muted)">
            {ttSource === "pull_from_url" ? t("ttPullHint") : t("ttFileHint")}
            {ttMode === "direct_post" && ` ${t("ttCaptionNote")}`}
          </p>
        </section>
      )}

      <section className={card} ref={scheduleSectionRef}>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <label className={fieldLabel}>{t("scheduleAt")}</label>
            <input
              type="datetime-local"
              className={input}
              value={scheduledAt}
              min={nowMin}
              onChange={(e) => setScheduledAt(e.currentTarget.value)}
            />
            <p className="text-xs text-(--color-muted) mt-1">{t("scheduleHint")}</p>
          </div>
          <div className="flex gap-2 items-center">
            <button className={btn} onClick={doPublish} disabled={!canPublish}>
              {publishing ? t("publishing") : t("publish")}
            </button>
            <button
              type="button"
              className={btnGhost}
              onClick={doSchedule}
              disabled={!canSchedule}
            >
              {scheduling ? t("scheduling") : t("schedulePost")}
            </button>
          </div>
        </div>
        {scheduleMsg && (
          <p className="text-xs text-(--color-accent)">
            {t("scheduledOk")}: {scheduleMsg}
          </p>
        )}
      </section>

      {results.length > 0 && (
        <section className={card}>
          <h2 className="text-base font-semibold">{t("results")}</h2>
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
                    {t("open")}
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
