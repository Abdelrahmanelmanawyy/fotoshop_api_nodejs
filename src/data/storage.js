import axios from "axios";
import { getStorage } from "../config/firebase.js";

/**
 * Upload image from URL to Firebase Storage (data boundary).
 * @param {string} imageUrl
 * @param {string} destinationPath
 * @returns {Promise<string>} Public download URL
 */
export async function uploadImageFromUrl(imageUrl, destinationPath) {
  try {
    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
    });

    const buffer = Buffer.from(response.data);
    const contentType = response.headers["content-type"] || "image/jpeg";

    const bucket = getStorage().bucket();
    const file = bucket.file(destinationPath);

    await file.save(buffer, {
      metadata: {
        contentType,
      },
    });

    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${destinationPath}`;

    return publicUrl;
  } catch (err) {
    const msg = err?.message || String(err);
    throw new Error(`Storage upload failed: ${msg}`);
  }
}
