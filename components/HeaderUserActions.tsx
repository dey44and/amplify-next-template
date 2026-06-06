"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { OutlineButton } from "@/components/ui";
import { isAdmin } from "@/lib/isAdmin";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { getCurrentUser, signOut } from "aws-amplify/auth";

const client = generateClient<Schema>();

export function HeaderUserActions() {
  const router = useRouter();

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [fallbackLabel, setFallbackLabel] = useState("U");
  const [showImage, setShowImage] = useState(true);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const user = await getCurrentUser();
        if (cancelled) return;

        const loginId = user.signInDetails?.loginId ?? user.username ?? "Utilizator";
        setFallbackLabel(loginId.slice(0, 1).toUpperCase() || "U");

        const hasAdminAccess = await isAdmin();
        if (cancelled) return;
        setAdmin(hasAdminAccess);

        const profileRes = await client.models.UserProfile.get({ id: user.userId });
        if (cancelled) return;

        setAvatarUrl(profileRes.data?.avatarUrl ?? null);
      } catch {
        if (!cancelled) {
          setAvatarUrl(null);
          setFallbackLabel("U");
          setAdmin(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setShowImage(true);
  }, [avatarUrl]);

  const hasImage = useMemo(() => !!avatarUrl && showImage, [avatarUrl, showImage]);

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <div className="header-user-actions">
      <button
        type="button"
        className="header-avatar-btn"
        onClick={() => router.push("/profile")}
        title="Editează profilul"
        aria-label="Editează profilul"
      >
        {hasImage ? (
          <img
            src={avatarUrl!}
            alt="Fotografie de profil"
            className="header-avatar-img"
            onError={() => setShowImage(false)}
          />
        ) : (
          <span className="header-avatar-fallback">{fallbackLabel}</span>
        )}
      </button>

      {admin ? (
        <OutlineButton className="header-signout-btn" onClick={() => router.push("/admin")}>
          Admin
        </OutlineButton>
      ) : null}

      <OutlineButton className="header-signout-btn" onClick={handleSignOut}>
        Deconectare
      </OutlineButton>
    </div>
  );
}
