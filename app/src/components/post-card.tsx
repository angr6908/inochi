"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Post, updatePost, deletePost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { LinkPreviewCard } from "./link-preview-card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Reply, Pencil, Trash2, MoreHorizontal } from "lucide-react";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function timeAgo(dateStr: string): string {
  // Stored as UTC; parsed and displayed in the viewer's local time.
  const then = new Date(dateStr + "Z");
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();

  const hhmm = `${String(then.getHours()).padStart(2, "0")}:${String(
    then.getMinutes(),
  ).padStart(2, "0")}`;
  const monDay = `${MONTHS[then.getMonth()]} ${then.getDate()}`;

  // Under 12 hours → relative (hours, then minutes, then seconds below a minute).
  const diffMin = diffMs / 60000;
  if (diffMin < 12 * 60) {
    if (diffMin < 1) return `${Math.max(0, Math.floor(diffMs / 1000))}s`;
    if (diffMin < 60) return `${Math.floor(diffMin)}m`;
    return `${Math.floor(diffMin / 60)}h`;
  }

  // ≥ 12 hours but still today → just "HH:MM".
  if (sameDay(then, now)) return hhmm;

  // Yesterday → "Yesterday HH:MM".
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(then, yesterday)) return `Yesterday ${hhmm}`;

  // Earlier this year → "Mon D HH:MM"; previous years prefix the year.
  if (then.getFullYear() === now.getFullYear()) return `${monDay} ${hhmm}`;
  return `${then.getFullYear()} ${monDay} ${hhmm}`;
}

function TimeAgo({ date }: { date: string }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const then = new Date(date + "Z").getTime();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const age = Date.now() - then;
      if (age >= 12 * 60 * 60 * 1000) return;
      const next = age < 60_000 ? 1000 : 60_000 - (age % 60_000);
      timer = setTimeout(() => {
        setTick((t) => t + 1);
        schedule();
      }, next);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [date]);

  return <>{timeAgo(date)}</>;
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
  /** Move the echo action into the actions menu instead of a standalone button (feed views). */
  echoInMenu?: boolean;
}

export function PostCard({ post, onUpdate, hideParent, hideUsername, onEcho, onDelete, className, priority, echoInMenu }: PostCardProps) {
  const { user } = useAuth();
  const router = useRouter();
  const isOwner = user?.id === post.user_id;
  const hasFollowups = post.followup_count > 0;
  const sameAuthor = post.parent_post?.username === post.username;
  const showReference = !hideParent && !!post.parent_post;
  const hideOwnUsername = hideUsername || (showReference && sameAuthor);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editContent, setEditContent] = useState(post.content);
  const [saving, setSaving] = useState(false);

  const handleEdit = async () => {
    setSaving(true);
    try {
      await updatePost(post.id, editContent);
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
        <div className="mb-2 flex items-center gap-1.5 text-sm">
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
            {!echoInMenu && (
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

            {(isOwner || echoInMenu) && (
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
                  {echoInMenu && (
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
                      <DropdownMenuItem
                        onClick={() => {
                          setEditContent(post.content);
                          setEditOpen(true);
                        }}
                      >
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
        <div className="font-content text-base leading-relaxed">
          <PostContent content={post.content} priority={priority} />
        </div>

        {/* Images */}
        <ImageGallery images={post.images} priority={priority} />

        {/* Link previews */}
        {post.link_previews.map((lp, i) => (
          <LinkPreviewCard key={i} preview={lp} priority={priority} />
        ))}

        {/* Reference card — the quoted parent post this follow-up replies to,
            shown below the follow-up's own content and link previews. The whole
            card is clickable via a stretched overlay link (can't wrap in <a>
            because PostContent renders its own links). */}
        {!hideParent && post.parent_post && (
          <div className="relative mt-3 rounded-lg border border-border/60 bg-muted/40 p-3 transition-colors hover:bg-muted/70">
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
            <div className="font-content text-base leading-relaxed [&_a]:relative [&_a]:z-20">
              <PostContent content={post.parent_post.content} />
            </div>
            {post.parent_post.images.length > 0 && (
              <div className="relative z-20">
                <ImageGallery images={post.parent_post.images} />
              </div>
            )}
            {post.parent_post.link_previews.length > 0 && (
              <div className="relative z-20">
                {post.parent_post.link_previews.map((lp, i) => (
                  <LinkPreviewCard key={i} preview={lp} />
                ))}
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
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                  <Button onClick={handleEdit} disabled={saving}>
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
