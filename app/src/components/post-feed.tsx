"use client";

import { Post } from "@/lib/api";
import { PostCard } from "./post-card";
import { cn } from "@/lib/utils";

interface PostFeedProps {
  posts: Post[];
  onUpdate: () => void;
  dedupeReferences?: boolean;
  surfaceEchoes?: boolean;
}

const CUSTOM_EMOJI = /:[a-z0-9_]*[a-z_][a-z0-9_]*:/i;

function hasMedia(p: Post): boolean {
  return (
    p.images.length > 0 ||
    p.link_previews.some((lp) => lp.thumbnail || lp.image_url) ||
    CUSTOM_EMOJI.test(p.content)
  );
}

export function PostFeed({ posts, onUpdate, dedupeReferences, surfaceEchoes }: PostFeedProps) {
  const idsOnPage = new Set(posts.map((p) => p.id));
  const priorityIndex = posts.findIndex(hasMedia);

  return (
    <div>
      {posts.map((post, i) => {
        const next = posts[i + 1];
        const prev = posts[i - 1];
        const repliesToNext = !!(
          post.parent_post && next && post.parent_post.id === next.id
        );
        const continuesPrev = !!(
          prev?.parent_post && prev.parent_post.id === post.id
        );
        const sameThreadAsNext = !!(next && next.root_post_id === post.root_post_id);
        const sameThreadAsPrev = !!(prev && prev.root_post_id === post.root_post_id);
        const sameAuthorAsNext = sameThreadAsNext && next?.username === post.username;
        const parentOnPage = !!(post.parent_post && idsOnPage.has(post.parent_post.id));
        const echoIsNeighbor = continuesPrev;
        const echoInMenu = !(surfaceEchoes && post.followup_count > 0 && !echoIsNeighbor);
        return (
          <PostCard
            key={post.id}
            post={post}
            priority={i === priorityIndex}
            echoInMenu={echoInMenu}
            hideParent={repliesToNext || (!!dedupeReferences && parentOnPage)}
            hideUsername={sameAuthorAsNext}
            onUpdate={onUpdate}
            className={cn(
              sameThreadAsNext ? "mb-0" : "mb-4",
              i === posts.length - 1 && "mb-0",
              sameThreadAsNext && "rounded-b-none border-b-0",
              sameThreadAsPrev && "rounded-t-none",
            )}
          />
        );
      })}
    </div>
  );
}
