"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { updatePassword, updateUsername, deleteAccount, refreshEmojis, uploadEmoji, deleteEmoji, Emoji } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";
import { toastError } from "@/lib/utils";
import { useTitle } from "@/lib/use-title";

// Every form on this page is the same shape: a label bound to one control,
// stacked. The `id` is still repeated on the control itself, since that is what
// `htmlFor` points at — this only removes the repeated markup around it.
function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const { user, loading, signOut, refreshUser } = useAuth();
  const router = useRouter();
  useTitle("Settings");

  // Username
  const [newUsername, setNewUsername] = useState("");
  // Password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  // Delete
  const [deletePassword, setDeletePassword] = useState("");
  // Emojis
  const [emojis, setEmojis] = useState<Emoji[]>([]);
  const [shortcode, setShortcode] = useState("");
  // Only read when the form is submitted; holding it in state re-rendered the
  // whole settings page every time a file was picked.
  const emojiFile = useRef<File | null>(null);

  // Wait for the session to resolve first: `user` is null on the first client
  // render while the cached token is being verified, and redirecting on that
  // bounced signed-in readers straight back out of their own settings page.
  // `replace`, so the back button does not land here again mid-redirect.
  useEffect(() => {
    if (!loading && !user) router.replace("/auth/signin");
  }, [loading, user, router]);

  useEffect(() => {
    refreshEmojis().then(setEmojis).catch(() => {});
  }, []);

  const handleUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateUsername(newUsername);
      await refreshUser();
      setNewUsername("");
      toast.success("Username updated");
    } catch (err) {
      toastError(err);
    }
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updatePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Password updated");
    } catch (err) {
      toastError(err);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteAccount(deletePassword);
      signOut();
      router.push("/");
      toast.success("Account deleted");
    } catch (err) {
      toastError(err);
    }
  };

  const handleUploadEmoji = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shortcode.trim() || !emojiFile.current) return;
    try {
      const fd = new FormData();
      fd.append("shortcode", shortcode.trim());
      fd.append("image", emojiFile.current);
      await uploadEmoji(fd);
      setShortcode("");
      emojiFile.current = null;
      // Refresh the shared emoji cache too, so post cards and the picker pick
      // up the new mapping without a reload.
      setEmojis(await refreshEmojis());
      toast.success("Emoji uploaded");
    } catch (err) {
      toastError(err);
    }
  };

  const handleDeleteEmoji = async (id: string) => {
    try {
      await deleteEmoji(id);
      setEmojis(await refreshEmojis());
      toast.success("Emoji deleted");
    } catch (err) {
      toastError(err);
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card>
        <CardHeader><CardTitle>Change Username</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleUsername} className="space-y-3">
            <Field id="new-username" label={`Current: ${user.username}`}>
              <Input id="new-username" placeholder="New username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} required />
            </Field>
            <Button type="submit" size="sm">Update</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Change Password</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handlePassword} className="space-y-3">
            <Field id="current-password" label="Current Password">
              <Input id="current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            </Field>
            <Field id="new-password" label="New Password">
              <Input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={4} />
            </Field>
            <Button type="submit" size="sm">Update</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Custom Emojis</CardTitle></CardHeader>
        <CardContent stack="md">
          {emojis.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {emojis.map((emoji) => (
                <div key={emoji.id} className="flex items-center gap-2 rounded-md border p-2">
                  <img src={emoji.url} alt={emoji.shortcode} className="h-8 w-8" />
                  <span className="text-sm">:{emoji.shortcode}:</span>
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteEmoji(emoji.id)}>✕</Button>
                </div>
              ))}
            </div>
          )}
          <Separator />
          <form onSubmit={handleUploadEmoji} className="space-y-3">
            <Field id="emoji-shortcode" label="Shortcode">
              <Input id="emoji-shortcode" placeholder="e.g. party_parrot" value={shortcode} onChange={(e) => setShortcode(e.target.value)} required />
            </Field>
            <Field id="emoji-image" label="Image">
              <Input id="emoji-image" type="file" accept="image/*" onChange={(e) => { emojiFile.current = e.target.files?.[0] ?? null; }} required />
            </Field>
            <Button type="submit" size="sm">Upload Emoji</Button>
          </form>
        </CardContent>
      </Card>

      <Card tone="destructive">
        <CardHeader><CardTitle tone="destructive">Delete Account</CardTitle></CardHeader>
        <CardContent stack="sm">
          <Field id="delete-password" label="Confirm your password">
            <Input id="delete-password" type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} />
          </Field>
          <ConfirmDialog
            trigger={
              <AlertDialogTrigger
                render={<Button variant="destructive" size="sm" disabled={!deletePassword} />}
              >
                Delete Account
              </AlertDialogTrigger>
            }
            title="Are you sure?"
            description="This will permanently delete your account and all your posts."
            onConfirm={handleDelete}
          />
        </CardContent>
      </Card>
    </div>
  );
}
