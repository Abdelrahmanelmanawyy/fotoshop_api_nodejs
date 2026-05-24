import { getFirestore } from "../config/firebase.js";

/**
 * Get order document from Firestore (data boundary).
 * @param {string} orderId
 * @param {string} [collectionName]
 * @returns {Promise<Object|null>}
 */
export async function getOrder(orderId, collectionName = "orders") {
  const db = getFirestore();
  const doc = await db.collection(collectionName).doc(orderId).get();

  if (!doc.exists) {
    return null;
  }

  return { id: doc.id, ...doc.data() };
}

/**
 * Update order document with processed photo output URL.
 */
export async function updatePhotoOutput(
  orderId,
  photoId,
  outputUrl,
  collectionName = "orders"
) {
  const db = getFirestore();
  const orderRef = db.collection(collectionName).doc(orderId);

  try {
    await db.runTransaction(async (transaction) => {
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        throw new Error(`Order ${orderId} not found`);
      }

      const data = orderDoc.data();
      const photos = data.photos || [];

      const photoIndex = photos.findIndex((p) => p.photo_id === photoId);
      if (photoIndex === -1) {
        throw new Error(`Photo ${photoId} not found in order ${orderId}`);
      }

      photos[photoIndex].output_url = outputUrl;
      photos[photoIndex].output_completed_at = new Date().toISOString();

      transaction.update(orderRef, { photos });
    });
  } catch (err) {
    const msg = err?.message || String(err);
    throw new Error(`Firestore update failed: ${msg}`);
  }
}
