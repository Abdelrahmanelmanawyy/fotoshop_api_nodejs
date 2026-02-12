import { getStorage } from "../config/firebase.js";
import axios from "axios";

/**
 * Upload image from URL to Firebase Storage
 * @param {string} imageUrl - URL of the image to download
 * @param {string} destinationPath - Path in storage (e.g. "uploads/edited/userId/orderId_photoId.jpg")
 * @returns {Promise<string>} Public download URL
 */
export async function uploadImageFromUrl(imageUrl, destinationPath) {
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

  // Make file publicly accessible and get URL
  await file.makePublic();
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${destinationPath}`;

  return publicUrl;
}
