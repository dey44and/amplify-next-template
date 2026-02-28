"use client";

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { HeaderUserActions } from "@/components/HeaderUserActions";
import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { getCurrentUser, deleteUser } from "aws-amplify/auth";

const client = generateClient<Schema>();
type Profile = Schema["UserProfile"]["type"];

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("FILE_READ_FAILED"));
    reader.readAsDataURL(file);
  });
}

function imageFromDataUrl(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
    img.src = dataUrl;
  });
}

async function fileToAvatarDataUrl(file: File) {
  const sourceDataUrl = await fileToDataUrl(file);
  const img = await imageFromDataUrl(sourceDataUrl);

  const size = 256;
  const side = Math.min(img.width, img.height);
  const sx = Math.floor((img.width - side) / 2);
  const sy = Math.floor((img.height - side) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("CANVAS_NOT_AVAILABLE");

  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

  return canvas.toDataURL("image/jpeg", 0.84);
}

export default function ProfilePage() {
  const router = useRouter();

  const [existing, setExisting] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processingAvatar, setProcessingAvatar] = useState(false);

  const [form, setForm] = useState({
    avatarUrl: "",
    firstName: "",
    lastName: "",
    county: "",
    age: "",
    highSchool: "",
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);

      // Protect route: if not logged in -> /login
      let userId: string;
      try {
        const u = await getCurrentUser();
        userId = u.userId; // Cognito sub
      } catch {
        router.replace("/login");
        return;
      }

      // Design A: profile id == sub
      const res = await client.models.UserProfile.get({ id: userId });
      if (res.errors?.length) console.error(res.errors);

      const p = res.data ?? null;
      setExisting(p);

      if (p) {
        setForm({
          avatarUrl: p.avatarUrl ?? "",
          firstName: p.firstName ?? "",
          lastName: p.lastName ?? "",
          county: p.county ?? "",
          age: p.age != null ? String(p.age) : "",
          highSchool: p.highSchool ?? "",
        });
      } else {
        setForm({
          avatarUrl: "",
          firstName: "",
          lastName: "",
          county: "",
          age: "",
          highSchool: "",
        });
      }

      setLoading(false);
    })().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, [router]);

  async function handleDeleteAccount() {
    const ok = window.confirm("Ștergi profilul și contul? Acțiunea nu poate fi anulată.");
    if (!ok) return;

    let userId: string;
    try {
      const u = await getCurrentUser();
      userId = u.userId; // Cognito sub
    } catch {
      router.replace("/login");
      return;
    }

    // Design A: delete single profile by id=sub
    const del = await client.models.UserProfile.delete({ id: userId });
    if (del.errors?.length) console.error(del.errors);

    await deleteUser();
    router.replace("/login");
  }

  async function onSave() {
    setSaving(true);
    try {
      let userId: string;
      try {
        const u = await getCurrentUser();
        userId = u.userId; // Cognito sub
      } catch {
        router.replace("/login");
        return;
      }

      const ageStr = form.age.trim();
      let age: number | undefined;

      if (ageStr !== "") {
        const n = Number(ageStr);
        if (!Number.isFinite(n) || !Number.isInteger(n)) {
          alert("Vârsta trebuie să fie un număr întreg.");
          return;
        }
        age = n;
      }

      // Design A: only ONE profile per user; id is the sub.
      const payload = {
        id: userId,
        avatarUrl: form.avatarUrl.trim() ? form.avatarUrl : null,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        county: form.county.trim(),
        highSchool: form.highSchool.trim(),
        ...(age === undefined ? {} : { age }),
      };

      // Upsert
      const existingRes = await client.models.UserProfile.get({ id: userId });
      const res = existingRes.data
        ? await client.models.UserProfile.update(payload)
        : await client.models.UserProfile.create(payload);

      if (res.errors?.length) {
        console.error(res.errors);
        alert("Salvarea profilului a eșuat. Verifică consola pentru detalii.");
        return;
      }

      router.replace("/dashboard");
    } finally {
      setSaving(false);
    }
  }

  async function onAvatarFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    event.target.value = "";

    if (!file.type.startsWith("image/")) {
      alert("Selectează un fișier imagine.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert("Alege o imagine mai mică de 5MB.");
      return;
    }

    setProcessingAvatar(true);
    try {
      const avatarDataUrl = await fileToAvatarDataUrl(file);
      setForm((prev) => ({ ...prev, avatarUrl: avatarDataUrl }));
    } catch (err) {
      console.error(err);
      alert("Procesarea imaginii a eșuat. Încearcă altă imagine.");
    } finally {
      setProcessingAvatar(false);
    }
  }

  const avatarFallback = useMemo(() => {
    const label = `${form.firstName} ${form.lastName}`.trim();
    return (label.slice(0, 1) || "U").toUpperCase();
  }, [form.firstName, form.lastName]);

  return (
    <>
      <SiteHeader rightSlot={<HeaderUserActions />} />

      <PageShell>
        <div className="panel-stack">
          <div className="panel-top-row">
            <div className="page-title-xl">
              {existing ? "Editează profilul" : "Completează-ți profilul"}
            </div>
            <div className="page-subtitle">Aceste informații sunt vizibile doar pentru tine.</div>
          </div>

          <Card>
            {loading ? (
              <p className="small" style={{ margin: 0 }}>
                Se încarcă profilul…
              </p>
            ) : (
              <div style={{ display: "grid", gap: 14, maxWidth: 520 }}>
                <div className="profile-avatar-row">
                  <div className="profile-avatar-preview">
                    {form.avatarUrl ? (
                      <img src={form.avatarUrl} alt="Previzualizare profil" />
                    ) : (
                      <span>{avatarFallback}</span>
                    )}
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    <div className="profile-avatar-actions">
                      <OutlineButton
                        onClick={() => fileInputRef.current?.click()}
                        disabled={saving || processingAvatar}
                      >
                        {processingAvatar ? "Se procesează…" : "Încarcă fotografie"}
                      </OutlineButton>

                      {form.avatarUrl && (
                        <OutlineButton
                          onClick={() => setForm((prev) => ({ ...prev, avatarUrl: "" }))}
                          disabled={saving || processingAvatar}
                        >
                          Elimină
                        </OutlineButton>
                      )}
                    </div>

                    <div className="small">O imagine pătrată arată cel mai bine. O optimizăm automat.</div>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={onAvatarFileChange}
                    disabled={saving || processingAvatar}
                    className="profile-hidden-file"
                  />
                </div>

                {(
                  [
                    ["firstName", "Prenume"],
                    ["lastName", "Nume"],
                    ["county", "Județ"],
                    ["age", "Vârstă"],
                    ["highSchool", "Liceu"],
                  ] as const
                ).map(([k, label]) => (
                  <div key={k} style={{ display: "grid", gap: 6 }}>
                    <label className="field-label">{label}</label>
                    <input
                      value={form[k]}
                      onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                      disabled={saving}
                      className="field-input"
                    />
                  </div>
                ))}

                <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                  <OutlineButton onClick={onSave} disabled={saving}>
                    {saving ? "Se salvează…" : "Salvează"}
                  </OutlineButton>
                  <OutlineButton
                    onClick={() => router.push("/dashboard")}
                    disabled={saving}
                    style={{ borderColor: "rgba(0,0,0,0.08)" }}
                  >
                    Anulează
                  </OutlineButton>
                </div>
              </div>
            )}
          </Card>
        </div>
        <div style={{ marginTop: 6 }}>
          <button onClick={handleDeleteAccount} className="link-muted">
            Șterge contul
          </button>
        </div>
      </PageShell>
    </>
  );
}
