import axios from "axios";
import { getSupabase } from "../config/supabase.js";

const BUCKET = "uploads";

/**
 * Upload image from URL to Supabase Storage.
 * @param {string} imageUrl
 * @param {string} destinationPath  e.g. "original/userId/filename.jpg"
 * @returns {Promise<string>} Public URL
 */
export async function uploadImageFromUrl(imageUrl, destinationPath) {
  const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
  const buffer = Buffer.from(response.data);
  const contentType = response.headers["content-type"] || "image/jpeg";
  return uploadImageFromBuffer(buffer, destinationPath, contentType);
}

/**
 * Upload raw image buffer to Supabase Storage.
 * @param {Buffer} buffer
 * @param {string} destinationPath
 * @param {string} [contentType]
 * @returns {Promise<string>} Public URL
 */
export async function uploadImageFromBuffer(
  buffer,
  destinationPath,
  contentType = "image/jpeg"
) {
  const supabase = getSupabase();

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(destinationPath, buffer, {
      contentType,
      upsert: true,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(destinationPath);
  return data.publicUrl;
}
