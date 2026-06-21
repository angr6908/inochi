import { serverGet } from "@/lib/ssr";
import { PostThread, type InitialThread } from "./post-thread";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await serverGet<InitialThread>(`/api/posts/${id}`);
  // Seed only a root thread; an echo id redirects to its root client-side.
  const initial =
    data && (!data.post.root_post_id || data.post.root_post_id === data.post.id) ? data : null;

  return <PostThread key={id} id={id} initial={initial} />;
}
