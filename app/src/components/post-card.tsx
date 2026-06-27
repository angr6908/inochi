"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Post, updatePost, deletePost, getPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useTz } from "@/lib/tz";
import { formatTimestamp } from "@/lib/format-time";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PostContent } from "./post-content";
import { ImageGallery } from "./image-gallery";
import { ImageEditGrid } from "./image-edit-grid";
import { LinkPreviewCard } from "./link-preview-card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Reply, Pencil, Trash2, MoreHorizontal, Link2, Link2Off, ImagePlus } from "lucide-react";

/** The fields shown for the parent post in the edit dialog's echo-link control. */
type ParentSummary = Pick<NonNullable<Post["parent_post"]>, "username" | "content">;

/** An image tile in the edit dialog: one the post already has (kept unless
 *  removed) or a newly-picked file to upload. `preview` is the gallery `<img>`
 *  src — a remote URL for existing images, a data URL for new ones. */
type EditImage =
  | { kind: "existing"; id: string; preview: string }
  | { kind: "new"; id: string; file: File; preview: string };

/** Pull a post id out of a pasted post link, echo link, or raw id. */
function parsePostId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // An echo link points at the echo itself via ?echo=<id> / #<id>, not the
  // /post/<root> path, so those take precedence.
  const echoMatch = s.match(/[?&]echo=([\w-]+)/);
  if (echoMatch) return echoMatch[1];
  const hashMatch = s.match(/#([\w-]+)$/);
  if (hashMatch) return hashMatch[1];
  const pathMatch = s.match(/\/post\/([\w-]+)/);
  if (pathMatch) return pathMatch[1];
  if (/^[\w-]+$/.test(s)) return s;
  return null;
}

function TimeAgo({ date }: { date: string }) {
  const tz = useTz();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const then = new Date(date.replace(" ", "T") + "Z").getTime();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      setNow(Date.now());
      const age = Date.now() - then;
      if (age >= 12 * 60 * 60 * 1000) return;
      const next = age < 60_000 ? 1000 : 60_000 - (age % 60_000);
      timer = setTimeout(schedule, next);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [date]);

  return (
    <time dateTime={date} data-ts={date} suppressHydrationWarning>
      {formatTimestamp(date, tz, now)}
    </time>
  );
}

interface PostCardProps {
  post: Post;
  onUpdate?: () => void;
  /** Hide the quoted parent post (e.g. on a post's own page, where the parent is already shown). */
  hideParent?: boolean;
  /** Hide the author name (e.g. in a single-author thread where it's redundant). */
  hideUsername?: boolean;
  /** When set, the echo action toggles an inline composer for this post instead
   *  of navigating away (used on the thread page). */
  onEcho?: (postId: string) => void;
  /** Called after a successful delete (with this post's id) instead of `onUpdate`.
   *  Lets the thread page navigate away when the root post is removed. */
  onDelete?: (postId: string) => void;
  /** Extra classes for the card root (used to merge threaded neighbors). */
  className?: string;
  /** Above-the-fold hint — eager-load this card's media (the first post in the feed). */
  priority?: boolean;
  /** Whether to show the standalone echo button (outside the menu). Defaults to
   *  true (thread page); feed views pass false unless the post has echoes worth
   *  surfacing. */
  echoVisible?: boolean;
  /** Also offer the echo action inside the actions menu (feed views). Only takes
   *  effect for logged-in viewers, who always get it there. */
  echoInMenu?: boolean;
}

export function PostCard({ post, onUpdate, hideParent, hideUsername, onEcho, onDelete, className, priority, echoVisible = true, echoInMenu }: PostCardProps) {
  const { user } = useAuth();
  const router = useRouter();
  const isOwner = user?.id === post.user_id;
  // Logged-in viewers always get the echo action in the actions menu (feeds);
  // logged-out viewers never do.
  const echoMenuItem = !!echoInMenu && !!user;
  const hasFollowups = post.followup_count > 0;
  const sameAuthor = post.parent_post?.username === post.username;
  const showReference = !hideParent && !!post.parent_post;
  const hideOwnUsername = hideUsername || (showReference && sameAuthor);
  const hasMedia = post.images.length > 0 || post.link_previews.length > 0;
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editContent, setEditContent] = useState(post.content);
  const [editImages, setEditImages] = useState<EditImage[]>([]);
  const editFileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  // Echo link being edited: the parent post id, plus a summary for display.
  // Both are populated by openEdit when the dialog opens.
  const [editParentId, setEditParentId] = useState<string | null>(null);
  const [parentSummary, setParentSummary] = useState<ParentSummary | null>(null);
  const [parentInput, setParentInput] = useState("");
  const [linking, setLinking] = useState(false);

  const openEdit = () => {
    setEditContent(post.content);
    setEditImages(post.images.map((img) => ({ kind: "existing", id: img.id, preview: img.url })));
    setEditParentId(post.parent_post_id);
    setParentSummary(
      post.parent_post
        ? { username: post.parent_post.username, content: post.parent_post.content }
        : null,
    );
    setParentInput("");
    setEditOpen(true);
  };

  const handleLinkParent = async () => {
    const pid = parsePostId(parentInput);
    if (!pid) {
      toast.error("Enter a post link or ID");
      return;
    }
    if (pid === post.id) {
      toast.error("A post can't echo itself");
      return;
    }
    setLinking(true);
    try {
      const { post: target } = await getPost(pid);
      setEditParentId(target.id);
      setParentSummary({ username: target.username, content: target.content });
      setParentInput("");
    } catch {
      toast.error("Post not found");
    } finally {
      setLinking(false);
    }
  };

  const handleUnlinkParent = () => {
    setEditParentId(null);
    setParentSummary(null);
  };

  const handleEditFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    selected.forEach((f) => {
      const id = crypto.randomUUID();
      setEditImages((prev) => [...prev, { kind: "new", id, file: f, preview: "" }]);
      const reader = new FileReader();
      reader.onload = () =>
        setEditImages((prev) =>
          prev.map((img) => (img.id === id ? { ...img, preview: reader.result as string } : img)),
        );
      reader.readAsDataURL(f);
    });
    e.target.value = "";
  };

  const removeEditImage = (index: number) => {
    setEditImages((prev) => prev.filter((_, i) => i !== index));
  };

  const moveEditImage = (from: number, to: number) => {
    if (from === to) return;
    setEditImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const handleEdit = async () => {
    if (!editContent.trim() && editImages.length === 0) {
      toast.error("Content or an image is required");
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("content", editContent);
      // Only send the echo link when it actually changed; an empty string unlinks.
      const parentChange = editParentId !== post.parent_post_id ? editParentId : undefined;
      if (parentChange !== undefined) fd.append("parent_post_id", parentChange ?? "");
      // The final image order: existing images keep their id, new files are
      // appended and referenced by their upload index. Existing images absent
      // from this list are deleted server-side.
      const order: string[] = [];
      let uploadIndex = 0;
      for (const img of editImages) {
        if (img.kind === "existing") {
          order.push(img.id);
        } else {
          fd.append("images", img.file);
          order.push(`new:${uploadIndex}`);
          uploadIndex++;
        }
      }
      fd.append("image_order", JSON.stringify(order));
      await updatePost(post.id, fd);
      toast.success("Post updated");
      setEditOpen(false);
      onUpdate?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deletePost(post.id);
      toast.success("Post deleted");
      setDeleteOpen(false);
      if (onDelete) onDelete(post.id);
      else onUpdate?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
      setDeleteOpen(false);
    }
  };

  // Every echo lives in the thread of its very original root post; links resolve
  // to that root page, scrolling to (and optionally opening a composer for) this
  // post via the URL.
  const rootId = post.root_post_id || post.id;
  const isRoot = rootId === post.id;
  const echoHref = isRoot
    ? `/post/${rootId}?echo=${post.id}`
    : `/post/${rootId}?echo=${post.id}#${post.id}`;

  const handleEcho = () => {
    if (onEcho) onEcho(post.id);
    else router.push(echoHref);
  };

  return (
    <Card id={post.id} className={cn("scroll-mt-20 gap-0 py-0", className)}>
      <CardContent className="p-4">
        {/* Header */}
        {/* 10px below the header. With no text the empty content div collapses,
            so this collapses with the inner-card wrapper's mt-[9px]; mb-2.5 (10px)
            wins, keeping header→card at 10px to the border (border not counted),
            while the wrapper's 9px only governs content-text→card (border counted). */}
        <div className="mb-2.5 flex items-center gap-1.5 text-sm">
          <span className="flex items-center gap-1.5">
            {!hideOwnUsername && (
              <>
                <span className="font-medium leading-none">{post.username}</span>
                {/* A flex-centered square rather than a "·" glyph: the middle-dot
                    character renders low in the line box (its position is
                    font-defined), so a small span centered by the row's
                    items-center sits at the true vertical center, font-agnostic. */}
                <span aria-hidden className="size-[2px] shrink-0 bg-muted-foreground/50" />
              </>
            )}
            <span className="text-xs leading-none text-muted-foreground">
              <TimeAgo date={post.created_at} />
            </span>
          </span>

          {/* The action buttons (h-7 / size-7 = 28px) are taller than the
              username line, so in this items-center row they'd inflate its
              height and push the username down — leaving more space above it
              than the card leaves below its content. The negative vertical
              margin stops the buttons from dictating the row height, dropping
              the header flush against the top padding without moving the buttons
              relative to the text. It mirrors the row's own mb-1.5, so the
              buttons' overflow ends exactly at the content edge — never into it. */}
          <div className="-my-1.5 ml-auto flex items-center gap-0.5">
            {/* The echo button opens an inline composer for this post on the
                thread page, or navigates to its root thread (and opens the
                composer there) from anywhere else. In feed views it lives in
                the actions menu instead. */}
            {echoVisible && (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                aria-label="Echo"
                title="Echo"
                onClick={handleEcho}
                className="h-7 gap-1 px-2 text-muted-foreground hover:text-foreground"
              >
                <Reply className="size-4" />
                {hasFollowups && (
                  <span className="text-xs tabular-nums">{post.followup_count}</span>
                )}
              </Button>
            )}

            {(isOwner || echoMenuItem) && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Post actions"
                      className="size-7 text-muted-foreground hover:text-foreground"
                    />
                  }
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-32">
                  {echoMenuItem && (
                    <DropdownMenuItem onClick={handleEcho}>
                      <Reply className="size-4" />
                      Echo
                      {hasFollowups && (
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                          {post.followup_count}
                        </span>
                      )}
                    </DropdownMenuItem>
                  )}
                  {isOwner && (
                    <>
                      <DropdownMenuItem onClick={openEdit}>
                        <Pencil className="size-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                        <Trash2 className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Content */}
        {/* The card's bottom padding (p-4 = 16px) is larger than the 10px content
            gap, so a text-only card's bottom would read roomier than the rest.
            When the text is the last block, pull it down so the gap to the card
            edge lands at 10px, matching every other content gap. Scoped to
            :last-child so it never collapses the spacing when media/reference
            actually follows. */}
        <div className="font-content text-base leading-relaxed [&:last-child]:-mb-[6px]">
          <PostContent content={post.content} priority={priority} />
        </div>

        {/* Images, link previews and the reference card — the "cards inside the
            card". The wrapper owns their spacing. Only the content-text→first-card
            gap counts that card's 1px border: mt-[9px] (+ border = 10px to its
            content). Everything else is 10px to the border edge, border not
            counted: gap-2.5 (10px) between cards, and header→first-card when there
            is no text (the header's mb-2.5 wins the margin collapse over this
            mt-[9px]). The wrapper sits on the full p-4 padding, so the last card
            is 16px off the mother card bottom; the reference card matches that
            above itself (see its own mt below). ImageGallery renders nothing when
            there are no images, so it adds no gap. */}
        {(hasMedia || showReference) && (
          <div className="mt-[9px] flex flex-col gap-2.5">
            <ImageGallery images={post.images} priority={priority} />

            {post.link_previews.map((lp, i) => (
              <LinkPreviewCard key={i} preview={lp} priority={priority} />
            ))}

            {/* Reference card — the quoted parent post this follow-up replies to.
                The whole card is clickable via a stretched overlay link (can't
                wrap in <a> because PostContent renders its own links). When media
                sits above it, mt-[6px] (on top of the wrapper's gap-2.5 = 10px)
                makes the gap above the reference 16px, matching its 16px gap down
                to the mother card bottom — framing it symmetrically. With no media
                above, it's the content-text→card gap (mt-[9px]) and this mt does
                not apply. */}
            {!hideParent && post.parent_post && (
              <div className={cn("relative rounded-lg border border-border/60 bg-muted/40 p-3 transition-colors hover:bg-muted/70", hasMedia && "mt-[6px]")}>
                <Link
                  href={`/post/${post.parent_post.id}`}
                  aria-label={`View post by ${post.parent_post.username}`}
                  className="absolute inset-0 z-10"
                />
                <div className="mb-1.5 flex items-center gap-1.5 text-sm">
                  <span className="font-medium leading-none">{post.parent_post.username}</span>
                  <span aria-hidden className="size-[2px] shrink-0 bg-muted-foreground/50" />
                  <span className="text-xs leading-none text-muted-foreground">
                    <TimeAgo date={post.parent_post.created_at} />
                  </span>
                </div>
                <div className="font-content text-base leading-relaxed [&:last-child]:-mb-[2px] [&_a]:relative [&_a]:z-20">
                  <PostContent content={post.parent_post.content} />
                </div>
                {/* Same rhythm one level deeper: content-text→first-card counts
                    its border (mt-[9px]); cards are 10px apart (gap-2.5). z-20
                    lifts the media above the card's stretched overlay link so it
                    stays clickable (lightbox / preview links). */}
                {(post.parent_post.images.length > 0 || post.parent_post.link_previews.length > 0) && (
                  <div className="relative z-20 mt-[9px] flex flex-col gap-2.5">
                    <ImageGallery images={post.parent_post.images} />
                    {post.parent_post.link_previews.map((lp, i) => (
                      <LinkPreviewCard key={i} preview={lp} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Owner dialogs (opened from the actions menu) */}
        {isOwner && (
          <>
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit post</DialogTitle>
                </DialogHeader>
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={5}
                  className="font-content leading-relaxed placeholder:font-sans"
                />

                {/* Image controls: reorder/remove existing or newly-added
                    images, and add more. */}
                <div className="flex flex-col gap-2">
                  <ImageEditGrid
                    images={editImages}
                    onReorder={moveEditImage}
                    onRemove={removeEditImage}
                  />
                  <div>
                    <input
                      ref={editFileRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleEditFiles}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() => editFileRef.current?.click()}
                      className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
                    >
                      <ImagePlus className="size-4" />
                      Add image
                    </Button>
                  </div>
                </div>

                {/* Echo link controls: make this post an echo of another, or
                    unlink it into an independent post. */}
                <div className="flex flex-col gap-2">
                  {parentSummary ? (
                    <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 p-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-muted-foreground">
                          Echo of <span className="font-medium text-foreground">{parentSummary.username}</span>
                        </div>
                        <div className="mt-0.5 line-clamp-2 font-content text-sm leading-snug">
                          {parentSummary.content || "(no text)"}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={handleUnlinkParent}
                        className="h-7 shrink-0 gap-1 px-2 text-muted-foreground hover:text-foreground"
                      >
                        <Link2Off className="size-4" />
                        Make independent
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input
                        value={parentInput}
                        onChange={(e) => setParentInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleLinkParent();
                          }
                        }}
                        placeholder="Echo of… paste a post link or ID"
                        className="h-9 flex-1"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={handleLinkParent}
                        disabled={linking || !parentInput.trim()}
                        className="h-9 shrink-0 gap-1"
                      >
                        <Link2 className="size-4" />
                        {linking ? "Linking..." : "Link"}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                  <Button
                    onClick={handleEdit}
                    disabled={saving || (!editContent.trim() && editImages.length === 0)}
                  >
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this post?</AlertDialogTitle>
                  <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </CardContent>
    </Card>
  );
}
