import { getFirestore } from "../config/firebase.js";

/**
 * Get order document from Firestore
 * Expects collection structure: orders/{orderId} or similar
 * @param {string} orderId - Order ID (e.g. "ORD_1770598001221")
 * @param {string} [collectionName] - Firestore collection name
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
 * Update order document with processed photo output URL
 * @param {string} orderId - Order ID
 * @param {string} photoId - Photo ID (e.g. "PH_1")
 * @param {string} outputUrl - URL of the processed image
 * @param {string} [collectionName] - Firestore collection name
 */
export async function updatePhotoOutput(
  orderId,
  photoId,
  outputUrl,
  collectionName = "orders"
) {
  const db = getFirestore();
  const orderRef = db.collection(collectionName).doc(orderId);

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
}
