import { createClient } from "@/lib/supabase/client";

/**
 * Uploads a product image to the `product-images` bucket.
 *
 * The bucket and its Storage policies already exist in the database schema:
 * the bucket is public for reads, and insert/update/delete are restricted to
 * super_admin. This runs in the browser using the signed-in user's session, so
 * the upload is authorised by RLS — no privileged key is involved.
 *
 * The object path is randomised to avoid collisions and never uses user input,
 * which also prevents path traversal.
 */

export const IMAGE_BUCKET = "product-images";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

export type UploadResult = { ok: true; url: string } | { ok: false; message: string };

export async function uploadProductImage(file: File): Promise<UploadResult> {
  if (file.size === 0) return { ok: false, message: "The selected file is empty." };
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, message: "Image must be 5 MB or smaller." };
  }

  const extension = ALLOWED_TYPES[file.type];
  if (!extension) {
    return { ok: false, message: "Use a JPEG, PNG, WebP or GIF image." };
  }

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Your session has expired. Sign in again." };

  const random = Math.random().toString(36).slice(2, 10);
  const path = `${user.id}/${Date.now()}-${random}.${extension}`;

  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type
  });

  if (error) return { ok: false, message: `Upload failed: ${error.message}` };

  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    return { ok: false, message: "Uploaded, but the image URL could not be read." };
  }

  return { ok: true, url: data.publicUrl };
}
