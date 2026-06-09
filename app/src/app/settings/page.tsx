"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { updatePassword, updateUsername, deleteAccount, getEmojis, uploadEmoji, deleteEmoji, Emoji } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { toastError } from "@/lib/utils";

export default function SettingsPage() {
  const { user, signOut, refreshUser } = useAuth();
  const router = useRouter();

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
  const [emojiFile, setEmojiFile] = useState<File | null>(null);

  useEffect(() => {
    if (!user) router.push("/auth/signin");
  }, [user, router]);

  useEffect(() => {
    getEmojis().then((r) => setEmojis(r.emojis)).catch(() => {});
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
    if (!shortcode.trim() || !emojiFile) return;
    try {
      const fd = new FormData();
      fd.append("shortcode", shortcode.trim());
      fd.append("image", emojiFile);
      await uploadEmoji(fd);
      setShortcode("");
      setEmojiFile(null);
      const r = await getEmojis();
      setEmojis(r.emojis);
      toast.success("Emoji uploaded");
    } catch (err) {
      toastError(err);
    }
  };

  const handleDeleteEmoji = async (id: string) => {
    try {
      await deleteEmoji(id);
      setEmojis((prev) => prev.filter((e) => e.id !== id));
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
            <div className="space-y-2">
              <Label>Current: {user.username}</Label>
              <Input placeholder="New username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} required />
            </div>
            <Button type="submit" size="sm">Update</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Change Password</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handlePassword} className="space-y-3">
            <div className="space-y-2">
              <Label>Current Password</Label>
              <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>New Password</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={4} />
            </div>
            <Button type="submit" size="sm">Update</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Custom Emojis</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {emojis.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {emojis.map((emoji) => (
                <div key={emoji.id} className="flex items-center gap-2 rounded-md border p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={emoji.url} alt={emoji.shortcode} className="h-8 w-8" />
                  <span className="text-sm">:{emoji.shortcode}:</span>
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteEmoji(emoji.id)}>✕</Button>
                </div>
              ))}
            </div>
          )}
          <Separator />
          <form onSubmit={handleUploadEmoji} className="space-y-3">
            <div className="space-y-2">
              <Label>Shortcode</Label>
              <Input placeholder="e.g. party_parrot" value={shortcode} onChange={(e) => setShortcode(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Image</Label>
              <Input type="file" accept="image/*" onChange={(e) => setEmojiFile(e.target.files?.[0] || null)} required />
            </div>
            <Button type="submit" size="sm">Upload Emoji</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-destructive">
        <CardHeader><CardTitle className="text-destructive">Delete Account</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Confirm your password</Label>
            <Input type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} />
          </div>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="destructive" size="sm" disabled={!deletePassword} />}>
              Delete Account
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>This will permanently delete your account and all your posts.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
